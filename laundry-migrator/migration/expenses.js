const dbManager = require('./db');

async function migrateExpenses(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();

        progressCallback({ step: 'expenses', percentage: 0, message: 'جاري قراءة المصروفات...', type: 'info' });

        const [purchases] = await sourceConn.execute(
            `SELECT purchase_id, purchase_date, purchase_value, purchase_name, is_vat_added, vat_value
             FROM burchases
             ORDER BY purchase_id`
        );

        const total = purchases.length;
        if (total === 0) {
            progressCallback({ step: 'expenses', percentage: 100, message: 'لا توجد مصروفات للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        progressCallback({ step: 'expenses', percentage: 20, message: `تم العثور على ${total} مصروف، جاري النقل...`, type: 'info' });

        await dbManager.beginTransaction();

        const rows = purchases.map(p => {
            const amount = parseFloat(p.purchase_value) || 0;
            const isTaxable = p.is_vat_added ? 1 : 0;
            const taxRate = isTaxable ? 15.00 : 0;
            const taxAmount = parseFloat(p.vat_value) || 0;
            const totalAmount = amount + taxAmount;
            const expenseDate = p.purchase_date
                ? new Date(p.purchase_date).toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0];

            return [
                p.purchase_id,
                p.purchase_name || `مصروف ${p.purchase_id}`,
                'عام',
                amount,
                isTaxable,
                taxRate,
                taxAmount,
                totalAmount,
                expenseDate
            ];
        });

        const migrated = await dbManager.batchInsert(
            'expenses',
            ['id', 'title', 'category', 'amount', 'is_taxable', 'tax_rate', 'tax_amount', 'total_amount', 'expense_date'],
            rows,
            'title = VALUES(title), amount = VALUES(amount), total_amount = VALUES(total_amount)'
        );

        await dbManager.commit();

        progressCallback({
            step: 'expenses',
            percentage: 100,
            message: `✓ تم نقل ${migrated} مصروف بنجاح`,
            type: 'success'
        });

        return { success: true, migrated };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'expenses',
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

module.exports = { migrateExpenses };
