'use strict'
const { dialog } = require('electron')
const fs = require('fs')

function register(ipcMain, store) {
  ipcMain.handle('config:load', () => ({
    src: store.get('src', { host: 'localhost', port: 3306, user: 'root', database: '' }),
    tgt: store.get('tgt', { host: 'localhost', port: 3306, user: 'root', database: '' })
  }))

  // نحفظ فقط بيانات الاتصال — بدون كلمة المرور إطلاقاً
  ipcMain.handle('config:save', (_e, { src, tgt }) => {
    store.set('src', { host: src.host, port: src.port, user: src.user, database: src.database })
    store.set('tgt', { host: tgt.host, port: tgt.port, user: tgt.user, database: tgt.database })
    return { saved: true }
  })

  ipcMain.handle('log:export', async (_e, logFilePath) => {
    if (!logFilePath || !fs.existsSync(logFilePath))
      return { saved: false, error: 'ملف السجل غير موجود' }

    const { filePath, canceled } = await dialog.showSaveDialog({
      title      : 'حفظ ملف السجل',
      defaultPath: `migration-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
      filters    : [{ name: 'Log Files', extensions: ['log', 'txt'] }]
    })
    if (canceled || !filePath) return { saved: false }
    fs.copyFileSync(logFilePath, filePath)
    return { saved: true, filePath }
  })
}

module.exports = { register }
