'use strict'
const { getSource, getTarget } = require('./connection-manager')
const { getSourceDb: srcDb, getTargetDb: tgtDb } = require('./schema-analyzer')

const BATCH = 2000

/**
 * ينقل جدولاً من المصدر إلى الهدف دفعةً دفعة.
 * @param {string}   sourceTable  اسم الجدول في المصدر
 * @param {string}   targetTable  اسم الجدول في الهدف (قد يختلف)
 * @param {string[]} colMap       الأعمدة المشتركة التي سيتم نقلها
 * @param {Function} filterFn
 * @param {Function} onProgress
 * @param {Function} onLog
 * @param {AbortSignal} signal
 */
async function migrateTable(sourceTable, targetTable, colMap, filterFn, onProgress, onLog, signal) {
  const src   = getSource()
  const tgt   = getTarget()
  const srcDB = srcDb()
  const tgtDB = tgtDb()

  // إجمالي الصفوف في المصدر
  const [[{ cnt }]] = await src.execute(
    `SELECT COUNT(*) AS cnt FROM \`${srcDB}\`.\`${sourceTable}\``
  )
  const totalRows = Number(cnt)

  // الأعمدة التي سنجلبها (فقط المشتركة أو كلها إذا لم يُحدَّد)
  const selectCols = colMap && colMap.length > 0
    ? colMap.map(c => `\`${c}\``).join(', ')
    : '*'

  let inserted = 0, skipped = 0, failed = 0, rolledBack = 0
  let offset   = 0
  const startMs = Date.now()

  while (!signal.aborted) {
    const [rows] = await src.execute(
      `SELECT ${selectCols} FROM \`${srcDB}\`.\`${sourceTable}\` LIMIT ${BATCH} OFFSET ${offset}`
    )
    if (rows.length === 0) break

    const { pass, skipped: sk } = filterFn(rows)
    skipped += sk.length

    for (const row of sk) {
      onLog({
        timestamp: new Date().toISOString(),
        level    : 'SKIP',
        table    : sourceTable,
        rowId    : row.id ?? offset,
        message  : 'متخطى — تكرار أو اشتراك قديم'
      })
    }

    if (pass.length > 0) {
      const conn = await tgt.getConnection()
      let batchInserted = 0
      let batchSkipped = 0
      let batchFailed = 0
      try {
        await conn.execute('SET foreign_key_checks = 0')
        await conn.execute('SET unique_checks = 0')
        await conn.beginTransaction()

        const cols   = Object.keys(pass[0])
        const colSQL = cols.map(c => `\`${c}\``).join(', ')

        for (const row of pass) {
          try {
            const vals = cols.map(c => row[c] ?? null)
            const ph   = cols.map(() => '?').join(', ')
            const [result] = await conn.execute(
              `INSERT IGNORE INTO \`${tgtDB}\`.\`${targetTable}\` (${colSQL}) VALUES (${ph})`,
              vals
            )
            if (result && result.affectedRows > 0) batchInserted++
            else batchSkipped++
          } catch(err) {
            batchFailed++
            onLog({
              timestamp: new Date().toISOString(),
              level    : 'ERROR',
              table    : `${sourceTable}→${targetTable}`,
              rowId    : row.id ?? '?',
              message  : err.message,
              errorCode: err.code
            })
          }
        }

        await conn.commit()
        inserted += batchInserted
        skipped  += batchSkipped
        failed   += batchFailed
      } catch(fatalErr) {
        await conn.rollback()
        rolledBack += batchInserted
        failed += batchFailed + Math.max(0, pass.length - batchInserted - batchSkipped - batchFailed)
        onLog({
          timestamp: new Date().toISOString(),
          level    : 'ERROR',
          table    : `${sourceTable}→${targetTable}`,
          rowId    : '—',
          message  : 'خطأ فادح في الدفعة: ' + fatalErr.message
        })
      } finally {
        await conn.execute('SET foreign_key_checks = 1').catch(() => {})
        await conn.execute('SET unique_checks = 1').catch(() => {})
        conn.release()
      }
    }

    offset += rows.length
    const elapsedSec = (Date.now() - startMs) / 1000
    const rps        = elapsedSec > 0 ? Math.round(offset / elapsedSec) : 0
    const remaining  = totalRows - offset
    const etaMs      = rps > 0 ? Math.round((remaining / rps) * 1000) : 0

    onProgress({
      table            : `${sourceTable} → ${targetTable}`,
      processedRows    : offset,
      totalRows,
      inserted,
      skipped,
      failed,
      rolledBack,
      rowsPerSecond    : rps,
      estimatedRemainingMs: etaMs
    })
  }

  return { inserted, skipped, failed, rolledBack, durationMs: Date.now() - startMs }
}

module.exports = { migrateTable }
