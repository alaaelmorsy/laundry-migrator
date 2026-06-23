const dbManager = require('./db');

async function migrateUsers(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();

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

        const rows = users.map(u => [
            u.username,
            u.password || '',
            u.password || null,
            u.fullname || u.username,
            u.is_admin_user ? 'admin' : 'cashier',
            1
        ]);

        const migrated = await dbManager.batchInsert(
            'users',
            ['username', 'password', 'password_plain', 'full_name', 'role', 'is_active'],
            rows,
            'full_name = VALUES(full_name), role = VALUES(role), is_active = VALUES(is_active)'
        );

        await dbManager.commit();

        progressCallback({
            step: 'users',
            percentage: 100,
            message: `✓ تم نقل ${migrated} مستخدم بنجاح`,
            type: 'success'
        });

        return { success: true, migrated };

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
