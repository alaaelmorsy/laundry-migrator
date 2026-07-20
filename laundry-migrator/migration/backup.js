const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');

async function findMysqldump() {
    const possiblePaths = [
        'C:\\Program Files\\MySQL\\MySQL Server 9.0\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.3\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.2\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.1\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 5.6\\bin\\mysqldump.exe',
        'C:\\Program Files (x86)\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
        'C:\\Program Files (x86)\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe',
        'C:\\xampp\\mysql\\bin\\mysqldump.exe',
        'C:\\wamp\\bin\\mysql\\mysql8.0.27\\bin\\mysqldump.exe',
        'C:\\wamp64\\bin\\mysql\\mysql8.0.27\\bin\\mysqldump.exe',
        'C:\\laragon\\bin\\mysql\\mysql-8.0.30-winx64\\bin\\mysqldump.exe',
        'mysqldump'
    ];

    for (const mysqldumpPath of possiblePaths) {
        if (mysqldumpPath !== 'mysqldump' && !existsSync(mysqldumpPath)) {
            continue;
        }

        try {
            await new Promise((resolve, reject) => {
                exec(`"${mysqldumpPath}" --version`, { timeout: 3000 }, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            return mysqldumpPath;
        } catch (err) {
            continue;
        }
    }
    return null;
}

async function createDatabaseBackup(config, backupPath, progressCallback) {
    try {
        progressCallback({ step: 'backup', percentage: 0, message: 'بدء عملية النسخ الاحتياطي...', type: 'info' });

        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const timestamp = `${day}-${month}-${year}_${hours}${minutes}`;
        const filename = `${config.database}_${timestamp}.dump`;
        const fullPath = path.join(backupPath, filename);

        progressCallback({ step: 'backup', percentage: 10, message: 'جاري البحث عن mysqldump...', type: 'info' });

        const mysqldumpPath = await findMysqldump();

        if (!mysqldumpPath) {
            throw new Error('لم يتم العثور على mysqldump. يرجى التأكد من تثبيت MySQL بشكل صحيح.');
        }

        progressCallback({ step: 'backup', percentage: 20, message: 'جاري تصدير قاعدة البيانات...', type: 'info' });

        // execFile with an args array: no shell, so the password never appears in
        // a process command line and special characters in config values can't
        // break or inject into the command. MYSQL_PWD keeps it out of argv too.
        // --single-transaction gives a consistent InnoDB snapshot; routines/
        // triggers/events make the dump actually restorable as a full database.
        const dumpArgs = [
            '-h', config.host,
            '-P', String(config.port || 3306),
            '-u', config.user,
            '--single-transaction',
            '--routines', '--triggers', '--events',
            '--databases', config.database,
            `--result-file=${fullPath}`
        ];

        await new Promise((resolve, reject) => {
            execFile(mysqldumpPath, dumpArgs, {
                maxBuffer: 1024 * 1024 * 50,
                env: { ...process.env, MYSQL_PWD: config.password || '' }
            }, (error) => {
                if (error) {
                    reject(new Error(`فشل تصدير قاعدة البيانات: ${error.message}`));
                    return;
                }
                resolve();
            });
        });

        progressCallback({ step: 'backup', percentage: 85, message: 'جاري التحقق من الملف...', type: 'info' });

        const stats = await fs.stat(fullPath);
        if (stats.size === 0) {
            throw new Error('الملف المُنشأ فارغ');
        }

        progressCallback({
            step: 'backup',
            percentage: 100,
            message: `✓ تم حفظ النسخة الاحتياطية بنجاح:\n${fullPath}`,
            type: 'success'
        });

        return { success: true, path: fullPath, filename };

    } catch (error) {
        progressCallback({
            step: 'backup',
            percentage: 0,
            message: `خطأ: ${error.message}`,
            type: 'error'
        });
        return { success: false, error: error.message };
    }
}

module.exports = { createDatabaseBackup };
