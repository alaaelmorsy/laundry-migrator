const dbManager = require('./db');
const { migrateSettings } = require('./settings');
const { migrateServices } = require('./services');
const { migrateProducts } = require('./products');
const { migrateCustomers } = require('./customers');
const { migrateUsers } = require('./users');
const { migrateSubscriptions } = require('./subscriptions');
const { migrateOrders } = require('./orders');
const { migrateExpenses } = require('./expenses');
const { createDatabaseBackup } = require('./backup');

// A verified backup of the TARGET database is mandatory before any step is
// allowed to write to it. The flag is per target (host:port/database) and per
// process session — switching targets requires a fresh backup.
let backedUpTargetKey = null;

function targetKey(config) {
    return `${config.host}:${config.port || 3306}/${config.database}`;
}

function requireBackup(migrationFn) {
    return async (sourceConfig, targetConfig, ...rest) => {
        if (backedUpTargetKey !== targetKey(targetConfig)) {
            return {
                success: false,
                error: 'يجب إنشاء نسخة احتياطية من قاعدة الهدف قبل بدء أي خطوة نقل — استخدم زر النسخ الاحتياطي أولاً'
            };
        }
        return migrationFn(sourceConfig, targetConfig, ...rest);
    };
}

async function testConnection(config) {
    return await dbManager.testConnection(config);
}

async function createBackupAndUnlock(targetConfig, backupPath, progressCallback) {
    const result = await createDatabaseBackup(targetConfig, backupPath, progressCallback);
    if (result.success) {
        backedUpTargetKey = targetKey(targetConfig);
    }
    return result;
}

module.exports = {
    testConnection,
    migrateSettings: requireBackup(migrateSettings),
    migrateServices: requireBackup(migrateServices),
    migrateProducts: requireBackup(migrateProducts),
    migrateCustomers: requireBackup(migrateCustomers),
    migrateUsers: requireBackup(migrateUsers),
    migrateSubscriptions: requireBackup(migrateSubscriptions),
    migrateOrders: requireBackup(migrateOrders),
    migrateExpenses: requireBackup(migrateExpenses),
    createDatabaseBackup: createBackupAndUnlock
};
