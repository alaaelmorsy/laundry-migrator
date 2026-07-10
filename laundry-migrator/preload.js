const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    testConnection: config => ipcRenderer.invoke('test-connection', config),
    migrateSettings: (source, target) => ipcRenderer.invoke('migrate-settings', source, target),
    migrateServices: (source, target) => ipcRenderer.invoke('migrate-services', source, target),
    migrateProducts: (source, target, folder) => ipcRenderer.invoke('migrate-products', source, target, folder),
    migrateCustomers: (source, target) => ipcRenderer.invoke('migrate-customers', source, target),
    migrateUsers: (source, target) => ipcRenderer.invoke('migrate-users', source, target),
    migrateSubscriptions: (source, target) => ipcRenderer.invoke('migrate-subscriptions', source, target),
    migrateOrders: (source, target) => ipcRenderer.invoke('migrate-orders', source, target),
    migrateExpenses: (source, target) => ipcRenderer.invoke('migrate-expenses', source, target),
    selectImageFolder: () => ipcRenderer.invoke('select-image-folder'),
    selectBackupLocation: () => ipcRenderer.invoke('select-backup-location'),
    createBackup: (target, backupPath) => ipcRenderer.invoke('create-backup', target, backupPath),
    onMigrationProgress: callback => ipcRenderer.on('migration-progress', (_event, progress) => callback(progress))
});
