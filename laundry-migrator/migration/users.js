const bcrypt = require('bcryptjs');
const dbManager = require('./db');

// The new app stores bcrypt hashes in users.password (sample data: $2b$...).
// Legacy passwords are usually plaintext; writing them unhashed would either
// break login or leak the secret. Passwords that are already some hash digest
// (bcrypt/md5/sha) can't be recovered — they migrate as-is with a warning so
// the operator knows those accounts need a password reset.
function isAlreadyHashed(password) {
    return /^\$2[aby]\$/.test(password) ||          // bcrypt
           /^[a-f0-9]{32}$/i.test(password) ||       // md5
           /^[a-f0-9]{40}$/i.test(password) ||       // sha1
           /^[a-f0-9]{64}$/i.test(password);         // sha256
}

async function migrateUsers(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();
        const targetConn = dbManager.getTargetConnection();

        progressCallback({ step: 'users', percentage: 0, message: 'جاري قراءة بيانات المستخدمين...', type: 'info' });

        const [users] = await sourceConn.execute(
            `SELECT username, password, fullname, is_admin_user FROM io_users ORDER BY username`
        );

        const total = users.length;
        if (total === 0) {
            progressCallback({ step: 'users', percentage: 100, message: 'لا يوجد مستخدمين للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        progressCallback({ step: 'users', percentage: 20, message: `تم العثور على ${total} مستخدم، جاري النقل...`, type: 'info' });

        await dbManager.beginTransaction();

        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        const needsReset = [];

        for (const user of users) {
            const legacyPassword = user.password || '';
            let passwordHash;
            let passwordPlain = null;

            if (!legacyPassword) {
                // No usable password — a random hash locks the account until reset.
                passwordHash = bcrypt.hashSync(`reset-required-${Date.now()}-${Math.random()}`, 10);
                needsReset.push(user.username);
            } else if (isAlreadyHashed(legacyPassword)) {
                passwordHash = legacyPassword;
                if (!/^\$2[aby]\$/.test(legacyPassword)) {
                    needsReset.push(user.username);
                }
            } else {
                passwordHash = bcrypt.hashSync(legacyPassword, 10);
                passwordPlain = legacyPassword;
            }

            const [result] = await targetConn.execute(
                `INSERT INTO users (username, password, password_plain, full_name, role, is_active)
                 VALUES (?, ?, ?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    full_name = VALUES(full_name),
                    role = VALUES(role),
                    is_active = VALUES(is_active)`,
                [
                    user.username,
                    passwordHash,
                    passwordPlain,
                    user.fullname || user.username,
                    user.is_admin_user ? 'admin' : 'cashier'
                ]
            );

            // mysql2 affectedRows: 1 = inserted, 2 = existing row updated,
            // 0 = existing row identical — count reality, not attempts.
            if (result.affectedRows === 1) inserted++;
            else if (result.affectedRows === 2) updated++;
            else unchanged++;
        }

        await dbManager.commit();

        if (needsReset.length > 0) {
            progressCallback({
                step: 'users',
                percentage: 95,
                message: `تحذير: ${needsReset.length} مستخدم بكلمة مرور غير قابلة للتحويل (${needsReset.join('، ')}) — يجب إعادة تعيين كلمات مرورهم في النظام الجديد`,
                type: 'warning'
            });
        }

        progressCallback({
            step: 'users',
            percentage: 100,
            message: `✓ المستخدمون: ${inserted} جديد، ${updated} محدث، ${unchanged} بدون تغيير`,
            type: 'success'
        });

        return { success: true, migrated: inserted + updated, inserted, updated, unchanged, needsReset };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'users',
            percentage: 0,
            message: `خطأ: ${error.message}`,
            type: 'error'
        });
        return { success: false, error: error.message };
    } finally {
        if (connected) {
            try { await dbManager.disconnect(); } catch (e) {}
        }
    }
}

module.exports = { migrateUsers };
