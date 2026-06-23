const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const controller = require('./migration/controller');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1200,
        minHeight: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        show: false,
        title: 'نظام نقل بيانات المغسلة'
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());
}

function sendProgress(progress) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('migration-progress', progress);
    }
}

function registerHandlers() {
    ipcMain.handle('test-connection', async (_event, config) => {
        return controller.testConnection(config);
    });

    ipcMain.handle('migrate-settings', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateSettings(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-services', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateServices(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-products', async (_event, sourceConfig, targetConfig, imageFolder) => {
        return controller.migrateProducts(sourceConfig, targetConfig, imageFolder, sendProgress);
    });

    ipcMain.handle('migrate-customers', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateCustomers(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-users', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateUsers(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-subscriptions', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateSubscriptions(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-orders', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateOrders(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('migrate-expenses', async (_event, sourceConfig, targetConfig) => {
        return controller.migrateExpenses(sourceConfig, targetConfig, sendProgress);
    });

    ipcMain.handle('select-image-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });

        return {
            canceled: result.canceled,
            path: result.canceled || !result.filePaths.length ? '' : result.filePaths[0]
        };
    });

    ipcMain.handle('select-backup-location', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory']
        });

        return {
            canceled: result.canceled,
            path: result.canceled || !result.filePaths.length ? '' : result.filePaths[0]
        };
    });

    ipcMain.handle('create-backup', async (_event, targetConfig, backupPath) => {
        return controller.createDatabaseBackup(targetConfig, backupPath, sendProgress);
    });
}

app.whenReady().then(() => {
    createWindow();
    registerHandlers();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
