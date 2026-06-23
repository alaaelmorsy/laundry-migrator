'use strict'
const { getSource } = require('../db/connection-manager')
const { getSourceDb } = require('../db/schema-analyzer')

/**
 * يحتفظ فقط بأحدث اشتراك لكل عميل (MAX date، ثم MAX id للتعادل).
 */
class LatestSubscriptionFilter {
  constructor(tableName, dateField, customerIdField = 'customer_id') {
    this.tableName        = tableName
    this.dateField        = dateField
    this.customerIdField  = customerIdField
    this.latestIds        = new Set()  // set of row IDs to keep
  }

  async initialize() {
    const src   = getSource()
    const srcDB = getSourceDb()
    const df    = this.dateField
    const cf    = this.customerIdField

    // MAX(date) per customer, then MAX(id) for tie-breaking
    const [rows] = await src.execute(
      `SELECT MAX(id) AS keep_id
       FROM \`${srcDB}\`.\`${this.tableName}\`
       WHERE (\`${cf}\`, \`${df}\`) IN (
         SELECT \`${cf}\`, MAX(\`${df}\`) FROM \`${srcDB}\`.\`${this.tableName}\`
         GROUP BY \`${cf}\`
       )
       GROUP BY \`${cf}\``
    )

    for (const row of rows) this.latestIds.add(row.keep_id)
  }

  filter(rows) {
    const pass    = []
    const skipped = []
    for (const row of rows) {
      if (this.latestIds.has(row.id)) pass.push(row)
      else skipped.push(row)
    }
    return { pass, skipped }
  }
}

module.exports = { LatestSubscriptionFilter }
