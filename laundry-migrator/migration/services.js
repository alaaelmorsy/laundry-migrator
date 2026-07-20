const dbManager = require('./db');

async function migrateServices(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();

        progressCallback({ step: 'services', percentage: 0, message: 'جاري قراءة خدمات الغسيل...', type: 'info' });

        // Check which columns exist in io_operations
        let hasLocation = false;
        try {
            const [cols] = await sourceConn.execute(`SHOW COLUMNS FROM io_operations LIKE 'operation_location'`);
            hasLocation = cols.length > 0;
        } catch (e) {}

        const selectCols = hasLocation
            ? 'operation_id, operation_name, operation_name_en, operation_location'
            : 'operation_id, operation_name, operation_name_en';

        const [operations] = await sourceConn.execute(
            `SELECT ${selectCols} FROM io_operations ORDER BY operation_id`
        );

        const total = operations.length;
        if (total === 0) {
            progressCallback({ step: 'services', percentage: 100, message: 'لا توجد خدمات للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        progressCallback({ step: 'services', percentage: 20, message: `تم العثور على ${total} خدمة، جاري النقل...`, type: 'info' });

        await dbManager.beginTransaction();

        const rows = operations.map((op, index) => [
            op.operation_id,
            op.operation_name || `خدمة ${op.operation_id}`,
            op.operation_name_en || '',
            (hasLocation ? (op.operation_location ?? index) : index),
            1
        ]);

        const counters = await dbManager.batchInsert(
            'laundry_services',
            ['id', 'name_ar', 'name_en', 'sort_order', 'is_active'],
            rows,
            'name_ar = VALUES(name_ar), name_en = VALUES(name_en), sort_order = VALUES(sort_order), is_active = VALUES(is_active)'
        );

        await dbManager.commit();

        const migrated = counters.inserted + counters.updated;
        progressCallback({
            step: 'services',
            percentage: 100,
            message: `✓ الخدمات: ${counters.inserted} جديدة، ${counters.updated} محدثة، ${counters.unchanged} بدون تغيير`,
            type: 'success'
        });

        return { success: true, migrated, ...counters };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'services',
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

module.exports = { migrateServices };
