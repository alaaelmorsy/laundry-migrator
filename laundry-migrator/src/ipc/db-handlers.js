'use strict'
const mysql    = require('mysql2/promise')
const connMgr  = require('../db/connection-manager')
const schema   = require('../db/schema-analyzer')
const { buildGroups } = require('../migration/group-builder')

function register(ipcMain) {
  ipcMain.handle('db:test', async (_e, cfg) => {
    return connMgr.testConnection(cfg)
  })

  // جلب قائمة قواعد البيانات المتاحة (بدون database في الاتصال)
  ipcMain.handle('db:list-databases', async (_e, cfg) => {
    let conn
    try {
      conn = await mysql.createConnection({
        host    : cfg.host     || 'localhost',
        port    : cfg.port     || 3306,
        user    : cfg.user     || 'root',
        password: cfg.password || '',
        connectTimeout: 8000
      })
      const [rows] = await conn.execute(
        `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys')
         ORDER BY SCHEMA_NAME`
      )
      return { success: true, databases: rows.map(r => r.SCHEMA_NAME) }
    } catch(err) {
      return { success: false, error: err.message, databases: [] }
    } finally {
      if (conn) await conn.end().catch(() => {})
    }
  })

  ipcMain.handle('db:init-pools', async (_e, { src, tgt }) => {
    connMgr.initPools(src, tgt)
    schema.setDatabases(src.database, tgt.database)
    return { ok: true }
  })

  ipcMain.handle('db:analyze', async () => {
    const { tables, sourceTables, targetTables, skippedTables } = await schema.analyze()
    const groups = buildGroups(tables)
    return { groups, sourceTables, targetTables, skippedTables }
  })
}

module.exports = { register }
