'use strict'
const path   = require('path')
const { app } = require('electron')
const { randomUUID } = require('crypto')
const { migrateTable } = require('../db/batch-executor')
const { LogWriter }   = require('../migration/log-writer')
const { executeSpecialized } = require('../migration/specialized-executor')

let abortController = null
let logWriter       = null
let sessionId       = ''

function register(ipcMain, getWin) {

  ipcMain.handle('migration:start-specialized', async (_event, request) => {
    if (!sessionId) {
      sessionId = randomUUID()
      logWriter = new LogWriter(path.join(app.getPath('userData'), 'logs'), sessionId)
    }
    const win = getWin()
    const emitProgress = ({ definition, legacyProgress }) => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: legacyProgress.type === 'error' ? 'ERROR' : legacyProgress.type === 'warning' ? 'WARN' : 'INFO',
        table: definition.sourceTable,
        rowId: '—',
        message: legacyProgress.message
      }
      logWriter.write(entry)
      win.webContents.send('migration:log', entry)
      win.webContents.send('migration:progress', {
        table: definition.labelAr,
        processedRows: legacyProgress.percentage || 0,
        totalRows: 100,
        inserted: 0,
        skipped: 0,
        failed: entry.level === 'ERROR' ? 1 : 0,
        rolledBack: 0,
        rowsPerSecond: 0,
        estimatedRemainingMs: 0
      })
    }

    try {
      const stats = await executeSpecialized(request, emitProgress)
      win.webContents.send('migration:group-done', {
        groupId: request.migrationId,
        status: 'completed',
        stats: { ...stats, rowsPerSecond: stats.durationMs ? Math.round(stats.inserted * 1000 / stats.durationMs) : 0 }
      })
      return { ok: true, sessionId, logFilePath: logWriter.filePath }
    } catch (error) {
      const entry = { timestamp: new Date().toISOString(), level: 'ERROR', table: request.migrationId, rowId: '—', message: error.message }
      logWriter.write(entry)
      win.webContents.send('migration:log', entry)
      win.webContents.send('migration:group-done', {
        groupId: request.migrationId,
        status: 'failed',
        stats: { attempted: 0, inserted: 0, skipped: 0, failed: 1, rolledBack: 0, durationMs: 0, rowsPerSecond: 0 }
      })
      throw error
    }
  })

  // نقل مجموعة (الطريقة القديمة — جداول بنفس الاسم)
  ipcMain.handle('migration:start', async (_e, group) => {
    if (!sessionId) {
      sessionId = randomUUID()
      const logsDir = path.join(app.getPath('userData'), 'logs')
      logWriter = new LogWriter(logsDir, sessionId)
    }

    abortController = new AbortController()
    const signal = abortController.signal
    const win    = getWin()

    let totalInserted = 0, totalSkipped = 0, totalFailed = 0, totalRolledBack = 0, totalDuration = 0

    for (const tableName of (group.tables || [])) {
      if (signal.aborted) break

      win.webContents.send('migration:log', {
        timestamp: new Date().toISOString(), level: 'INFO',
        table: tableName, rowId: '—',
        message: 'بدأ نقل الجدول'
      })

      const filterFn = rows => ({ pass: rows, skipped: [] })

      try {
        const stats = await migrateTable(
          tableName, tableName, [],
          filterFn,
          data  => win.webContents.send('migration:progress', data),
          entry => { logWriter.write(entry); win.webContents.send('migration:log', entry) },
          signal
        )
        totalInserted += stats.inserted
        totalSkipped  += stats.skipped
        totalFailed   += stats.failed
        totalRolledBack += stats.rolledBack || 0
        totalDuration += stats.durationMs
      } catch(err) {
        const entry = {
          timestamp: new Date().toISOString(), level: 'ERROR',
          table: tableName, rowId: '—',
          message: 'خطأ فادح: ' + err.message
        }
        logWriter.write(entry)
        win.webContents.send('migration:log', entry)
      }
    }

    const status = totalFailed === 0 ? 'completed' : 'partial'
    win.webContents.send('migration:group-done', {
      groupId: group.id,
      status,
      stats: { inserted: totalInserted, skipped: totalSkipped, failed: totalFailed, rolledBack: totalRolledBack,
               durationMs: totalDuration,
               rowsPerSecond: totalDuration > 0 ? Math.round((totalInserted / totalDuration) * 1000) : 0 }
    })

    return { ok: true, sessionId, logFilePath: logWriter ? logWriter.filePath : '' }
  })

  // نقل جدول واحد بربط يدوي (sourceTable → targetTable مع colMap)
  ipcMain.handle('migration:start-mapped', async (_e, { mappingId, sourceTable, targetTable, colMap }) => {
    if (!sessionId) {
      sessionId = randomUUID()
      const logsDir = path.join(app.getPath('userData'), 'logs')
      logWriter = new LogWriter(logsDir, sessionId)
    }

    abortController = new AbortController()
    const signal = abortController.signal
    const win    = getWin()

    win.webContents.send('migration:log', {
      timestamp: new Date().toISOString(), level: 'INFO',
      table: `${sourceTable}→${targetTable}`, rowId: '—',
      message: `بدأ النقل — ${colMap.length} عمود مشترك`
    })

    const filterFn = rows => ({ pass: rows, skipped: [] })

    try {
      const stats = await migrateTable(
        sourceTable, targetTable, colMap,
        filterFn,
        data  => win.webContents.send('migration:progress', data),
        entry => { logWriter.write(entry); win.webContents.send('migration:log', entry) },
        signal
      )

      const status = stats.failed === 0 ? 'completed' : 'partial'
      win.webContents.send('migration:group-done', {
        groupId: mappingId,
        status,
        stats: { ...stats,
                 rowsPerSecond: stats.durationMs > 0
                   ? Math.round((stats.inserted / stats.durationMs) * 1000) : 0 }
      })

      return { ok: true, sessionId, logFilePath: logWriter ? logWriter.filePath : '' }
    } catch(err) {
      win.webContents.send('migration:log', {
        timestamp: new Date().toISOString(), level: 'ERROR',
        table: `${sourceTable}→${targetTable}`, rowId: '—',
        message: 'خطأ فادح: ' + err.message
      })
      win.webContents.send('migration:group-done', {
        groupId: mappingId,
        status: 'failed',
        stats: { inserted: 0, skipped: 0, failed: 1, durationMs: 0, rowsPerSecond: 0 }
      })
      throw err
    }
  })

  ipcMain.handle('migration:cancel', () => {
    abortController?.abort()
    return { cancelled: true }
  })
}

module.exports = { register }
