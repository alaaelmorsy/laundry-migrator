'use strict'
const { getConfigs } = require('../db/connection-manager')
const { definitionById } = require('./specialized-registry')

const MIGRATORS = {
  settings: require('../../migration/settings').migrateSettings,
  services: require('../../migration/services').migrateServices,
  products: require('../../migration/products').migrateProducts,
  customers: require('../../migration/customers').migrateCustomers,
  users: require('../../migration/users').migrateUsers,
  subscriptions: require('../../migration/subscriptions').migrateSubscriptions,
  orders: require('../../migration/orders').migrateOrders,
  expenses: require('../../migration/expenses').migrateExpenses
}

function statsFromLegacy(migrationResult) {
  const inserted = [
    migrationResult.migrated,
    migrationResult.itemsMigrated,
    migrationResult.paymentsMigrated,
    migrationResult.customPricesMigrated,
    migrationResult.invoicesMigrated,
    migrationResult.receiptsMigrated,
    migrationResult.ledgerEntriesMigrated
  ].reduce((sum, count) => sum + (Number(count) || 0), 0)
  const skipped = Object.entries(migrationResult)
    .filter(([key]) => key.toLowerCase().startsWith('skipped'))
    .reduce((sum, [, count]) => sum + (Number(count) || 0), 0)
  return { attempted: inserted + skipped, inserted, skipped, failed: 0, rolledBack: 0 }
}

async function executeSpecialized(request, emitProgress) {
  const definition = definitionById(request.migrationId)
  if (!definition) throw new Error(`مسار الترحيل غير معروف: ${request.migrationId}`)
  const migrate = MIGRATORS[definition.id]
  const { sourceConfig, targetConfig } = getConfigs()
  const startedAt = Date.now()
  const progress = legacyProgress => emitProgress({ definition, legacyProgress })
  const args = definition.id === 'products'
    ? [sourceConfig, targetConfig, request.options?.imageFolder || '', progress]
    : [sourceConfig, targetConfig, progress]
  const migrationResult = await migrate(...args)
  if (!migrationResult.success) throw new Error(migrationResult.error || `فشل ترحيل ${definition.labelAr}`)
  return { ...statsFromLegacy(migrationResult), durationMs: Date.now() - startedAt }
}

module.exports = { executeSpecialized }
