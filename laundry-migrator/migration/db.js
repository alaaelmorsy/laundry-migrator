const mysql = require('mysql2/promise');

// Every table a migration step writes to. Verified on connect so a wrong or
// outdated target schema stops the migration before the first write, instead
// of failing halfway through with half-migrated data.
const REQUIRED_TARGET_TABLES = [
    'app_settings', 'laundry_services', 'products', 'product_price_lines',
    'customers', 'users', 'customer_subscriptions', 'prepaid_packages',
    'subscription_periods', 'subscription_invoices', 'subscription_receipts',
    'subscription_ledger', 'orders', 'order_items', 'invoice_payments', 'expenses'
];

class DatabaseManager {
    constructor() {
        this.sourceConnection = null;
        this.targetConnection = null;
    }

    async connect(sourceConfig, targetConfig) {
        try {
            const sourceHost = sourceConfig.host === 'localhost' ? '127.0.0.1' : sourceConfig.host;
            const targetHost = targetConfig.host === 'localhost' ? '127.0.0.1' : targetConfig.host;

            if (sourceHost === targetHost &&
                (sourceConfig.port || 3306) === (targetConfig.port || 3306) &&
                sourceConfig.database === targetConfig.database) {
                return { success: false, error: 'قاعدة المصدر وقاعدة الهدف هما نفس القاعدة — يجب اختيار قاعدتين مختلفتين' };
            }

            this.sourceConnection = await mysql.createConnection({
                host: sourceHost,
                user: sourceConfig.user,
                password: sourceConfig.password,
                database: sourceConfig.database,
                charset: 'utf8mb4',
                connectTimeout: 30000,
                port: sourceConfig.port || 3306,
                multipleStatements: false,
                dateStrings: false
            });

            this.targetConnection = await mysql.createConnection({
                host: targetHost,
                user: targetConfig.user,
                password: targetConfig.password,
                database: targetConfig.database,
                charset: 'utf8mb4',
                connectTimeout: 30000,
                port: targetConfig.port || 3306,
                multipleStatements: false,
                dateStrings: false
            });

            await this.sourceConnection.query(`USE \`${sourceConfig.database}\``);
            await this.targetConnection.query(`USE \`${targetConfig.database}\``);

            await this.targetConnection.query('SET autocommit=0');
            // foreign_key_checks stays ON: a broken reference must fail the batch
            // (and roll back) instead of silently persisting orphan rows.
            // Strict mode makes bad legacy data fail loudly instead of being
            // silently truncated/zeroed; ALLOW_INVALID_DATES keeps odd-but-formed
            // legacy dates importable. unique_checks stays ON so InnoDB never
            // skips secondary unique-index verification during bulk inserts.
            await this.targetConnection.query("SET sql_mode='STRICT_TRANS_TABLES,ALLOW_INVALID_DATES,NO_ENGINE_SUBSTITUTION'");
            await this.targetConnection.query("SET time_zone='+03:00'");

            const [tableRows] = await this.targetConnection.query('SHOW TABLES');
            const existingTables = new Set(tableRows.map(r => Object.values(r)[0]));
            const missingTables = REQUIRED_TARGET_TABLES.filter(t => !existingTables.has(t));
            if (missingTables.length > 0) {
                await this.disconnect();
                return {
                    success: false,
                    error: `مخطط قاعدة الهدف غير مكتمل — جداول مفقودة: ${missingTables.join('، ')}. تأكد أن قاعدة الهدف أُنشئت بمخطط التطبيق الجديد قبل النقل`
                };
            }

            return { success: true };
        } catch (error) {
            await this.disconnect();
            return { success: false, error: error.message };
        }
    }

    async testConnection(config) {
        try {
            if (!config.database || config.database.trim() === '') {
                return { success: false, error: 'يرجى إدخال اسم قاعدة البيانات' };
            }

            const host = config.host === 'localhost' ? '127.0.0.1' : config.host;

            const connection = await mysql.createConnection({
                host: host,
                user: config.user,
                password: config.password,
                database: config.database,
                charset: 'utf8mb4',
                connectTimeout: 10000,
                port: config.port || 3306
            });

            await connection.query(`USE \`${config.database}\``);
            await connection.end();

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async disconnect() {
        try {
            if (this.sourceConnection) {
                try { await this.sourceConnection.end(); } catch (e) {}
                this.sourceConnection = null;
            }
            if (this.targetConnection) {
                try { await this.targetConnection.end(); } catch (e) {}
                this.targetConnection = null;
            }
        } catch (error) {
            console.error('Error in disconnect:', error.message);
        }
    }

    getSourceConnection() { return this.sourceConnection; }
    getTargetConnection() { return this.targetConnection; }

    async beginTransaction() {
        if (this.targetConnection) {
            await this.targetConnection.query('START TRANSACTION');
        }
    }

    async commit() {
        if (this.targetConnection) {
            await this.targetConnection.query('COMMIT');
        }
    }

    async rollback() {
        if (this.targetConnection) {
            try { await this.targetConnection.query('ROLLBACK'); } catch (e) {}
        }
    }

    // Returns real counters, not attempt counts. MySQL reports per statement:
    //   info "Records: n Duplicates: d"  → inserted = n - d
    //   affectedRows = inserted + 2 × (duplicates actually changed)
    // so: updated = (affectedRows - inserted) / 2, unchanged = d - updated.
    async batchInsert(tableName, columns, rows, onDuplicateUpdate = null) {
        const counters = { attempted: rows ? rows.length : 0, inserted: 0, updated: 0, unchanged: 0 };
        if (!rows || rows.length === 0) return counters;

        // Batches are limited by BYTES, not only row count: BLOB-heavy rows
        // (product images) can exceed the server's max_allowed_packet, which
        // this tool no longer raises globally. 80% of the session limit leaves
        // headroom for SQL text and protocol overhead.
        const MAX_ROWS = 2000;
        const [[packetRow]] = await this.targetConnection.query('SELECT @@max_allowed_packet AS max_packet');
        const byteLimit = Math.floor(Number(packetRow.max_packet) * 0.8);
        const rowBytes = row => row.reduce((sum, value) => {
            if (Buffer.isBuffer(value)) return sum + value.length;
            if (typeof value === 'string') return sum + Buffer.byteLength(value);
            return sum + 16;
        }, 0);

        const batches = [];
        let currentBatch = [];
        let currentBytes = 0;
        for (const row of rows) {
            const size = rowBytes(row);
            if (currentBatch.length > 0 && (currentBatch.length >= MAX_ROWS || currentBytes + size > byteLimit)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBytes = 0;
            }
            currentBatch.push(row);
            currentBytes += size;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        for (const batch of batches) {
            const placeholders = batch.map(() =>
                `(${columns.map(() => '?').join(', ')})`
            ).join(', ');

            const values = batch.flatMap(row => row);

            let query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders}`;

            if (onDuplicateUpdate) {
                query += ` ON DUPLICATE KEY UPDATE ${onDuplicateUpdate}`;
            } else {
                query += ` ON DUPLICATE KEY UPDATE ${columns[0]} = VALUES(${columns[0]})`;
            }

            const [result] = await this.targetConnection.execute(query, values);

            const duplicatesMatch = /Duplicates:\s*(\d+)/.exec(result.info || '');
            const duplicates = duplicatesMatch ? Number(duplicatesMatch[1]) : 0;
            const inserted = batch.length - duplicates;
            const updated = Math.max(0, Math.round((result.affectedRows - inserted) / 2));

            counters.inserted += inserted;
            counters.updated += updated;
            counters.unchanged += Math.max(0, duplicates - updated);
        }

        return counters;
    }
}

module.exports = new DatabaseManager();
