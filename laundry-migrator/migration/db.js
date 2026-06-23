const mysql = require('mysql2/promise');

class DatabaseManager {
    constructor() {
        this.sourceConnection = null;
        this.targetConnection = null;
    }

    async connect(sourceConfig, targetConfig) {
        try {
            const sourceHost = sourceConfig.host === 'localhost' ? '127.0.0.1' : sourceConfig.host;
            const targetHost = targetConfig.host === 'localhost' ? '127.0.0.1' : targetConfig.host;

            this.sourceConnection = await mysql.createConnection({
                host: sourceHost,
                user: sourceConfig.user,
                password: sourceConfig.password,
                database: sourceConfig.database,
                charset: 'utf8mb4',
                connectTimeout: 30000,
                port: sourceConfig.port || 3306,
                multipleStatements: true,
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
                multipleStatements: true,
                dateStrings: false
            });

            await this.sourceConnection.query(`USE \`${sourceConfig.database}\``);
            await this.targetConnection.query(`USE \`${targetConfig.database}\``);

            await this.targetConnection.query('SET autocommit=0');
            await this.targetConnection.query('SET unique_checks=0');
            await this.targetConnection.query('SET foreign_key_checks=0');
            await this.targetConnection.query("SET sql_mode=''");
            await this.targetConnection.query("SET time_zone='+03:00'");

            try {
                await this.targetConnection.query('SET SESSION sql_log_bin=0');
            } catch (e) {}

            try {
                await this.targetConnection.query('SET GLOBAL innodb_flush_log_at_trx_commit=2');
            } catch (e) {}

            try {
                await this.targetConnection.query('SET GLOBAL max_allowed_packet=1073741824');
            } catch (e) {}

            return { success: true };
        } catch (error) {
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

    async batchInsert(tableName, columns, rows, onDuplicateUpdate = null) {
        if (!rows || rows.length === 0) return 0;

        const BATCH_SIZE = 2000;
        let totalInserted = 0;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);

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

            await this.targetConnection.execute(query, values);
            totalInserted += batch.length;
        }

        return totalInserted;
    }
}

module.exports = new DatabaseManager();
