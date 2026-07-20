'use strict'
const { getSource } = require('../db/connection-manager')
const { getSourceDb } = require('../db/schema-analyzer')

/**
 * يحمّل جميع قيم المفتاح الفريد من المصدر مسبقاً،
 * ثم يصفي الصفوف المكررة أثناء النقل — O(1) لكل صف.
 */
class DedupFilter {
  constructor(tableName, keyColumns) {
    if (!keyColumns || keyColumns.length === 0)
      throw new Error(`DedupFilter: لا توجد أعمدة مفتاح فريد للجدول ${tableName}`)
    this.tableName  = tableName
    this.keyColumns = keyColumns
    this.seen       = new Set()
  }

  async initialize() {
    const src   = getSource()
    const srcDB = getSourceDb()
    const cols  = this.keyColumns.map(c => `\`${c}\``).join(', ')

    const [rows] = await src.execute(
      `SELECT ${cols} FROM \`${srcDB}\`.\`${this.tableName}\``
    )

    for (const row of rows) {
      const key = this.keyColumns.map(c => row[c]).join('|')
      this.seen.add(key)
    }

    // نعيد بناء الـ Set بحيث يتتبع التكرار الداخلي
    this.seen.clear()
  }

  filter(rows) {
    const pass    = []
    const skipped = []
    for (const row of rows) {
      const key = this.keyColumns.map(c => row[c]).join('|')
      if (this.seen.has(key)) {
        skipped.push(row)
      } else {
        this.seen.add(key)
        pass.push(row)
      }
    }
    return { pass, skipped }
  }
}

module.exports = { DedupFilter }
