const dbManager = require('./db');

// Format as LOCAL calendar date — toISOString() converts to UTC and can shift
// an expense near midnight to the previous/next day.
function toLocalDateString(value) {
    const date = value ? new Date(value) : new Date();
    const safeDate = isNaN(date.getTime()) ? new Date() : date;
    const year = safeDate.getFullYear();
    const month = String(safeDate.getMonth() + 1).padStart(2, '0');
    const day = String(safeDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

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

        // Round to 2dp before insert: the target DECIMAL(…,2) columns round
        // anyway, and un-rounded values make every re-run look like an update.
        const round2 = value => Math.round((parseFloat(value) || 0) * 100) / 100;
        const rows = purchases.map(p => {
            const amount = round2(p.purchase_value);
            const isTaxable = p.is_vat_added ? 1 : 0;
            const taxRate = isTaxable ? 15.00 : 0;
            const taxAmount = round2(p.vat_value);
            const totalAmount = round2(amount + taxAmount);
            const expenseDate = toLocalDateString(p.purchase_date);

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

        // Re-runs must refresh EVERY source-owned column — updating only a
        // subset leaves stale tax/date/category values from the previous run.
        const counters = await dbManager.batchInsert(
            'expenses',
            ['id', 'title', 'category', 'amount', 'is_taxable', 'tax_rate', 'tax_amount', 'total_amount', 'expense_date'],
            rows,
            'title = VALUES(title), category = VALUES(category), amount = VALUES(amount), ' +
            'is_taxable = VALUES(is_taxable), tax_rate = VALUES(tax_rate), tax_amount = VALUES(tax_amount), ' +
            'total_amount = VALUES(total_amount), expense_date = VALUES(expense_date)'
        );

        await dbManager.commit();

        const migrated = counters.inserted + counters.updated;
        progressCallback({
            step: 'expenses',
            percentage: 100,
            message: `✓ المصروفات: ${counters.inserted} جديد، ${counters.updated} محدث، ${counters.unchanged} بدون تغيير`,
            type: 'success'
        });

        return { success: true, migrated, ...counters };

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
