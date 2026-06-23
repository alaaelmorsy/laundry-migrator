const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    testConnection: (config) => ipcRenderer.invoke('test-connection', config),
    migrateSettings: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-settings', sourceConfig, targetConfig),
    migrateServices: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-services', sourceConfig, targetConfig),
    migrateProducts: (sourceConfig, targetConfig, imageFolder) => ipcRenderer.invoke('migrate-products', sourceConfig, targetConfig, imageFolder),
    migrateCustomers: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-customers', sourceConfig, targetConfig),
    migrateUsers: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-users', sourceConfig, targetConfig),
    migrateSubscriptions: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-subscriptions', sourceConfig, targetConfig),
    migrateOrders: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-orders', sourceConfig, targetConfig),
    migrateExpenses: (sourceConfig, targetConfig) => ipcRenderer.invoke('migrate-expenses', sourceConfig, targetConfig),
    selectImageFolder: () => ipcRenderer.invoke('select-image-folder'),
    selectBackupLocation: () => ipcRenderer.invoke('select-backup-location'),
    createBackup: (targetConfig, backupPath) => ipcRenderer.invoke('create-backup', targetConfig, backupPath),
    onMigrationProgress: (callback) => ipcRenderer.on('migration-progress', (_event, progress) => callback(progress))
});
