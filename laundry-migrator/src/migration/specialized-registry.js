'use strict'

const DEFINITIONS = [
  { id: 'settings', labelAr: 'الإعدادات', sourceTable: 'laundry_info', targetTables: ['app_settings'], dependsOn: [] },
  { id: 'services', labelAr: 'الخدمات', sourceTable: 'io_operations', targetTables: ['laundry_services'], dependsOn: [] },
  { id: 'products', labelAr: 'المنتجات', sourceTable: 'io_types', targetTables: ['products', 'product_price_lines'], dependsOn: ['services'], requiresImages: true, requiresChildWrites: true },
  { id: 'customers', labelAr: 'العملاء', sourceTable: 'io_customers', targetTables: ['customers'], optionalTargetTables: ['customer_custom_prices'], dependsOn: ['products'], requiresDedup: true, requiresChildWrites: true },
  { id: 'users', labelAr: 'المستخدمون', sourceTable: 'io_users', targetTables: ['users'], dependsOn: [] },
  { id: 'subscriptions', labelAr: 'الاشتراكات', sourceTable: 'io_customer_partnership', targetTables: ['prepaid_packages', 'customer_subscriptions', 'subscription_periods', 'subscription_invoices', 'subscription_receipts', 'subscription_ledger'], dependsOn: ['customers'], requiresLatestOnly: true, requiresChildWrites: true },
  { id: 'orders', labelAr: 'الطلبات', sourceTable: 'bills', targetTables: ['orders', 'order_items', 'invoice_payments'], dependsOn: ['customers', 'products', 'subscriptions'], requiresChildWrites: true },
  { id: 'expenses', labelAr: 'المصروفات', sourceTable: 'burchases', targetTables: ['expenses'], dependsOn: [] }
]

function definitionsFor(sourceTableNames, targetTableNames) {
  const sourceSet = new Set(sourceTableNames)
  const targetSet = new Set(targetTableNames)
  return DEFINITIONS.filter(definition => sourceSet.has(definition.sourceTable)).map(definition => ({
    ...definition,
    mode: definition.targetTables.every(table => targetSet.has(table)) ? 'specialized' : 'unsupported'
  }))
}

function definitionById(id) {
  return DEFINITIONS.find(definition => definition.id === id)
}

module.exports = { definitionsFor, definitionById }
