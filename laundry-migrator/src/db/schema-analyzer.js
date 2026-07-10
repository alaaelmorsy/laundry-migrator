'use strict'
const { getSource, getTarget } = require('./connection-manager')
const { definitionsFor } = require('../migration/specialized-registry')

let _sourceDb = ''
let _targetDb = ''

function setDatabases(src, tgt) { _sourceDb = src; _targetDb = tgt }
function getSourceDb() { return _sourceDb }
function getTargetDb() { return _targetDb }

async function analyze() {
  const src = getSource()
  const tgt = getTarget()

  // جداول المصدر مع عدد الصفوف الحقيقي
  const [srcTablesRaw] = await src.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [_sourceDb]
  )

  // جداول الهدف
  const [tgtTablesRows] = await tgt.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [_targetDb]
  )
  const tgtTableNames = tgtTablesRows.map(r => r.TABLE_NAME)
  const tgtSet        = new Set(tgtTableNames)

  const sourceTables  = []
  const skippedTables = []

  for (const row of srcTablesRaw) {
    const name = row.TABLE_NAME

    const [[countRow]] = await src.execute(
      `SELECT COUNT(*) as cnt FROM \`${_sourceDb}\`.\`${name}\``
    )
    const rowCount = Number(countRow.cnt)

    const [colRows] = await src.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [_sourceDb, name]
    )

    const [fkRows] = await src.execute(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [_sourceDb, name]
    )

    sourceTables.push({
      name,
      rowCount,
      columns     : colRows.map(r => ({ name: r.COLUMN_NAME, type: r.DATA_TYPE, key: r.COLUMN_KEY })),
      primaryKeys : colRows.filter(r => r.COLUMN_KEY === 'PRI').map(r => r.COLUMN_NAME),
      foreignKeys : fkRows.map(r => ({
        column    : r.COLUMN_NAME,
        refTable  : r.REFERENCED_TABLE_NAME,
        refColumn : r.REFERENCED_COLUMN_NAME
      })),
      dateColumns : colRows.filter(r => ['date','datetime','timestamp'].includes(r.DATA_TYPE)).map(r => r.COLUMN_NAME),
      existsInTarget: tgtSet.has(name)
    })

    if (!tgtSet.has(name)) skippedTables.push(name)
  }

  // نجلب أعمدة كل جدول هدف أيضاً (للربط اليدوي)
  const targetTables = []
  for (const name of tgtTableNames) {
    const [colRows] = await tgt.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [_targetDb, name]
    )
    targetTables.push({
      name,
      columns: colRows.map(r => ({ name: r.COLUMN_NAME, type: r.DATA_TYPE, key: r.COLUMN_KEY }))
    })
  }

  // نبني مجموعات فقط للجداول ذات التطابق المباشر
  const matchedTables = sourceTables.filter(t => t.existsInTarget)
  const tables        = matchedTables   // للتوافق مع buildGroups

  const migrationDefinitions = definitionsFor(
    sourceTables.map(table => table.name),
    targetTables.map(table => table.name)
  )
  const specializedBySource = new Map(migrationDefinitions.map(definition => [definition.sourceTable, definition]))

  for (const table of sourceTables) {
    const definition = specializedBySource.get(table.name)
    if (definition) {
      Object.assign(table, {
        migrationId: definition.id,
        labelAr: definition.labelAr,
        migrationMode: definition.mode,
        targetHint: definition.targetTables[0],
        requiresImages: Boolean(definition.requiresImages),
        requiresChildWrites: Boolean(definition.requiresChildWrites),
        requiresDedup: Boolean(definition.requiresDedup),
        requiresLatestOnly: Boolean(definition.requiresLatestOnly)
      })
    } else if (table.existsInTarget) {
      table.migrationMode = 'direct-copy'
      table.targetHint = table.name
    } else {
      table.migrationMode = 'skipped'
    }
  }

  return { tables, sourceTables, targetTables, skippedTables, migrationDefinitions }
}

async function analyzeTargetColumns(tableName) {
  const tgt = getTarget()
  const [cols] = await tgt.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [_targetDb, tableName]
  )
  return cols.map(r => ({ name: r.COLUMN_NAME, type: r.DATA_TYPE, key: r.COLUMN_KEY }))
}

module.exports = { analyze, analyzeTargetColumns, setDatabases, getSourceDb, getTargetDb }
