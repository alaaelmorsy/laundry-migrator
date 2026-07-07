const dbManager = require('./db');

async function migrateCustomers(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();
        const targetConn = dbManager.getTargetConnection();

        progressCallback({ step: 'customers', percentage: 0, message: 'جاري قراءة بيانات العملاء...', type: 'info' });

        // Fast column check using SHOW COLUMNS (much faster than INFORMATION_SCHEMA)
        const [colRows] = await sourceConn.execute(`SHOW COLUMNS FROM io_customers`);
        const sourceColumns = colRows.map(c => c.Field || c.field || Object.values(c)[0]);
        const columns = sourceColumns.map(c => String(c).toLowerCase());
        const getSourceColumn = name => sourceColumns.find(c => String(c).toLowerCase() === name);
        const quoteIdentifier = name => `\`${String(name).replace(/`/g, '``')}\``;
        const formatSelectField = field => {
            const source = quoteIdentifier(field.name);
            return field.alias ? `${source} AS ${quoteIdentifier(field.alias)}` : source;
        };

        const customerCodeColumn = getSourceColumn('cust-id') || getSourceColumn('cust_id');
        if (!customerCodeColumn) {
            throw new Error('لم يتم العثور على عمود كود العميل في المصدر: cust-id أو cust_id');
        }

        const selectFields = [
            { name: 'cust_id' },
            { name: customerCodeColumn, alias: 'customer_code_source' },
            { name: 'cust_name' },
            { name: 'cust_mobile' },
            { name: 'cust_vat_num' },
            { name: 'cust_points' },
            { name: 'cust_general_discount' },
            { name: 'cust_is_blacklist' }
        ];
        if (columns.includes('address'))           selectFields.push({ name: 'address' });
        if (columns.includes('customer_city'))     selectFields.push({ name: 'customer_city' });
        if (columns.includes('cust_remark'))       selectFields.push({ name: 'cust_remark' });
        if (columns.includes('discount_type'))     selectFields.push({ name: 'discount_type' });
        if (columns.includes('discount_end_date')) selectFields.push({ name: 'discount_end_date' });

        // Read all customers at once
        const [customers] = await sourceConn.execute(
            `SELECT ${selectFields.map(formatSelectField).join(', ')} FROM io_customers ORDER BY ${quoteIdentifier('cust_id')}`
        );

        const total = customers.length;
        if (total === 0) {
            progressCallback({ step: 'customers', percentage: 100, message: 'لا يوجد عملاء للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        progressCallback({ step: 'customers', percentage: 10, message: `تم العثور على ${total} عميل، جاري تحضير الجدول...`, type: 'info' });

        // Truncate target table first for maximum INSERT speed
        await targetConn.query('START TRANSACTION');
        await targetConn.query('DELETE FROM customers');
        await targetConn.query('COMMIT');

        // --- Filter: skip no-phone & duplicate phones, log each case ---
        const rows = [];
        const seenPhones = new Set();
        let skippedNoPhone    = 0;
        let skippedDuplicate  = 0;
        const skippedLog      = [];   // collect messages to send to UI

        for (const c of customers) {
            const phone = c.cust_mobile ? c.cust_mobile.trim().toLowerCase() : '';
            const name  = c.cust_name || phone;

            // 1. Skip if no phone
            if (!phone) {
                skippedNoPhone++;
                skippedLog.push(`⚠ تخطي (بدون جوال): ${name} [ID: ${c.cust_id}]`);
                continue;
            }

            // 2. Skip if duplicate phone
            if (seenPhones.has(phone)) {
                skippedDuplicate++;
                skippedLog.push(`⚠ تخطي (جوال مكرر ${phone}): ${name} [ID: ${c.cust_id}]`);
                continue;
            }

            seenPhones.add(phone);

            const loyaltyPoints = Math.round(parseFloat(c.cust_points) || 0);
            const discountValue = (c.cust_general_discount && c.cust_general_discount > 0) ? c.cust_general_discount : null;
            const discountType  = discountValue ? 'percentage' : null;
            const isActive      = c.cust_is_blacklist ? 0 : 1;

            rows.push([
                c.cust_id,
                c.customer_code_source == null ? null : String(c.customer_code_source),
                name,
                phone,   // already normalized to lowercase
                c.cust_vat_num || null,
                c.address || '',
                c.customer_city || '',
                c.cust_remark || null,
                isActive,
                loyaltyPoints,
                discountType,
                discountValue,
                c.discount_end_date || null
            ]);
        }

        // Send skip log to UI (batch to avoid flooding)
        if (skippedNoPhone > 0 || skippedDuplicate > 0) {
            progressCallback({ step: 'customers', percentage: 15,
                message: `تحذير: سيتم تخطي ${skippedNoPhone} عميل بدون جوال و${skippedDuplicate} عميل بجوال مكرر`, type: 'warning' });
            // Log individual skipped entries (max 50 to avoid flooding)
            const logSample = skippedLog.slice(0, 50);
            for (const msg of logSample) {
                progressCallback({ step: 'customers', percentage: 15, message: msg, type: 'warning' });
            }
            if (skippedLog.length > 50) {
                progressCallback({ step: 'customers', percentage: 15,
                    message: `... و${skippedLog.length - 50} حالة أخرى (غير معروضة لتجنب الفيضان)`, type: 'warning' });
            }
        }

        const filteredTotal = rows.length;
        progressCallback({ step: 'customers', percentage: 18,
            message: `جاري نقل ${filteredTotal} عميل (تم تخطي ${skippedNoPhone + skippedDuplicate})...`, type: 'info' });

        // MySQL limit: 65535 max placeholders per prepared statement
        // 13 columns per row → max safe batch = 65535 ÷ 13 = 5041 rows
        const BATCH_SIZE = 5000;
        const fullBatchPlaceholder = Array(BATCH_SIZE).fill('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ');

        const INSERT_SQL = `
            INSERT INTO customers (
                id, customer_code, customer_name, phone, tax_number, address, city,
                notes, is_active, loyalty_points, discount_type, discount_value,
                discount_expiry, created_at
            ) VALUES {PLACEHOLDERS}`;

        let migrated = 0;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);

            const placeholders = (batch.length === BATCH_SIZE)
                ? fullBatchPlaceholder
                : Array(batch.length).fill('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ');

            await targetConn.query('START TRANSACTION');
            await targetConn.execute(
                INSERT_SQL.replace('{PLACEHOLDERS}', placeholders),
                batch.flatMap(row => row)
            );
            await targetConn.query('COMMIT');

            migrated += batch.length;

            const percentage = 18 + Math.round((migrated / filteredTotal) * 77);
            progressCallback({
                step: 'customers',
                percentage,
                message: `تم معالجة ${migrated}/${filteredTotal} عميل...`,
                type: 'info'
            });
        }

        progressCallback({
            step: 'customers',
            percentage: 100,
            message: `✓ تم نقل ${migrated} عميل | تخطي ${skippedNoPhone} (بدون جوال) | تخطي ${skippedDuplicate} (جوال مكرر)`,
            type: 'success'
        });

        // --- نقل تخصيص الأسعار (customize_type_costs → customer_custom_prices) ---
        let customPrices = { migrated: 0, skipped: 0 };
        try {
            customPrices = await migrateCustomPrices(sourceConn, targetConn, rows, progressCallback);
        } catch (e) {
            progressCallback({ step: 'customers', percentage: 100,
                message: `تحذير: فشل نقل تخصيص الأسعار: ${e.message}`, type: 'warning' });
        }

        return { success: true, migrated, skippedNoPhone, skippedDuplicate,
                 customPricesMigrated: customPrices.migrated, customPricesSkipped: customPrices.skipped };

    } catch (error) {
        progressCallback({
            step: 'customers',
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

// نقل تخصيص الأسعار الخاصة بالعملاء من الجدول القديم customize_type_costs
// إلى جدول النظام الجديد customer_custom_prices
async function migrateCustomPrices(sourceConn, targetConn, migratedCustomerRows, progressCallback) {
    // تأكد من وجود الجدول في المصدر
    const [tables] = await sourceConn.execute("SHOW TABLES LIKE 'customize_type_costs'");
    if (tables.length === 0) {
        return { migrated: 0, skipped: 0 };
    }

    progressCallback({ step: 'customers', percentage: 100,
        message: 'جاري قراءة تخصيص الأسعار...', type: 'info' });

    // ربط كل سطر تسعير بالمنتج والخدمة عبر io_types_operation
    const [priceRows] = await sourceConn.execute(`
        SELECT ctc.cust_id, ctc.type_cost,
               ito.type_id, ito.operation_id
        FROM customize_type_costs ctc
        JOIN io_types_operation ito ON ito.io_types_operation_id = ctc.io_types_operation_id
        WHERE ctc.cust_id IS NOT NULL
          AND ctc.type_cost IS NOT NULL
          AND ito.operation_id IS NOT NULL
    `);

    if (priceRows.length === 0) {
        progressCallback({ step: 'customers', percentage: 100,
            message: 'لا يوجد تخصيص أسعار للنقل', type: 'info' });
        return { migrated: 0, skipped: 0 };
    }

    // استبعاد الأسعار الخاصة بعملاء تم تخطيهم (بدون جوال / جوال مكرر)
    const migratedIds = new Set(migratedCustomerRows.map(r => r[0]));
    const valid = [];
    let skipped = 0;
    for (const p of priceRows) {
        if (migratedIds.has(p.cust_id)) {
            valid.push([p.cust_id, p.type_id, p.operation_id, p.type_cost]);
        } else {
            skipped++;
        }
    }

    if (valid.length === 0) {
        progressCallback({ step: 'customers', percentage: 100,
            message: `تخطي جميع تخصيصات الأسعار (${skipped}) لأن عملاءها لم يتم نقلهم`, type: 'warning' });
        return { migrated: 0, skipped };
    }

    // 4 أعمدة لكل صف → دفعات آمنة ضمن حد 65535 placeholder
    const BATCH_SIZE = 5000;
    let inserted = 0;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE);
        const placeholders = Array(batch.length).fill('(?, ?, ?, ?)').join(', ');
        await targetConn.query('START TRANSACTION');
        await targetConn.execute(
            `INSERT INTO customer_custom_prices (customer_id, product_id, laundry_service_id, custom_price)
             VALUES ${placeholders}
             ON DUPLICATE KEY UPDATE custom_price = VALUES(custom_price)`,
            batch.flatMap(r => r)
        );
        await targetConn.query('COMMIT');
        inserted += batch.length;
    }

    progressCallback({ step: 'customers', percentage: 100,
        message: `✓ تم نقل ${inserted} تخصيص سعر` + (skipped > 0 ? ` | تخطي ${skipped} (عملاء غير منقولين)` : ''),
        type: 'success' });

    return { migrated: inserted, skipped };
}

module.exports = { migrateCustomers };
