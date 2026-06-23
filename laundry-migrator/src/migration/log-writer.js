'use strict'
const fs   = require('fs')
const path = require('path')

class LogWriter {
  constructor(logsDir, sessionId) {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
    this.filePath = path.join(logsDir, `migration-${sessionId}.log`)
    this.stream   = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' })
    this.stream.write(`=== بدء جلسة النقل: ${new Date().toISOString()} ===\n`)
  }

  write(entry) {
    const line = `[${entry.timestamp}] ${entry.level.padEnd(5)} | ${(entry.table || '—').padEnd(20)} | ID=${entry.rowId ?? '—'} | ${entry.message}\n`
    this.stream.write(line)
  }

  close() {
    return new Promise(resolve => {
      this.stream.write(`=== انتهاء الجلسة: ${new Date().toISOString()} ===\n`)
      this.stream.end(resolve)
    })
  }
}

module.exports = { LogWriter }
