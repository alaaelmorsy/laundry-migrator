'use strict'
const mysql = require('mysql2/promise')

let sourcePool = null
let targetPool = null

async function testConnection(cfg) {
  let conn
  try {
    conn = await mysql.createConnection({
      host    : cfg.host     || 'localhost',
      port    : cfg.port     || 3306,
      user    : cfg.user     || 'root',
      password: cfg.password || '',
      database: cfg.database,
      connectTimeout: 8000
    })
    const [[row]] = await conn.execute('SELECT VERSION() as v')
    return { success: true, version: row.v }
  } catch(err) {
    return { success: false, error: err.message }
  } finally {
    if (conn) await conn.end().catch(() => {})
  }
}

function initPools(src, tgt) {
  if (sourcePool) sourcePool.end().catch(() => {})
  if (targetPool) targetPool.end().catch(() => {})

  const poolOpts = cfg => ({
    host             : cfg.host     || 'localhost',
    port             : cfg.port     || 3306,
    user             : cfg.user     || 'root',
    password         : cfg.password || '',
    database         : cfg.database,
    connectionLimit  : 10,
    waitForConnections: true,
    queueLimit       : 0,
    multipleStatements: false
  })

  sourcePool = mysql.createPool(poolOpts(src))
  targetPool = mysql.createPool(poolOpts(tgt))
}

function getSource() { return sourcePool }
function getTarget() { return targetPool }

async function closePools() {
  await Promise.all([
    sourcePool ? sourcePool.end().catch(() => {}) : Promise.resolve(),
    targetPool ? targetPool.end().catch(() => {}) : Promise.resolve()
  ])
  sourcePool = null
  targetPool = null
}

module.exports = { testConnection, initPools, getSource, getTarget, closePools }
