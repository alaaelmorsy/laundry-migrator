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

async function testConnection(config) {
    return await dbManager.testConnection(config);
}

module.exports = {
    testConnection,
    migrateSettings,
    migrateServices,
    migrateProducts,
    migrateCustomers,
    migrateUsers,
    migrateSubscriptions,
    migrateOrders,
    migrateExpenses,
    createDatabaseBackup
};
