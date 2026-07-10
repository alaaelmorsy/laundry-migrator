const dbManager = require('./db');

function buildPackageCatalog(defaultValues) {
    const packageNames = [
        'الباقة البرونزية',
        'الباقة الفضية',
        'الباقة الذهبية',
        'الباقة الماسية',
        'الباقة البلاتينية',
        'باقة كبار الشخصيات'
    ];

    if (!defaultValues.length) {
        return [{ paid: 0, credit: 0, name: 'باقة أساسية' }];
    }

    return defaultValues.map((val, index) => ({
        paid: parseFloat(val.partnership_paid_value) || 0,
        credit: parseFloat(val.partnership_purchasing_value) || 0,
        name: packageNames[index] || `باقة مخصصة ${index + 1}`
    }));
}

function toNumOrDefault(val, fallback) {
    if (val === null || val === undefined || val === '') return fallback;
    const n = parseFloat(val);
    return Number.isNaN(n) ? fallback : n;
}

function pickClosestPackage(packages, paid) {
    let closestPkg = packages[0];
    let minDiff = Math.abs(paid - closestPkg.paid);

    for (let index = 1; index < packages.length; index++) {
        const diff = Math.abs(paid - packages[index].paid);
        if (diff < minDiff) {
            minDiff = diff;
            closestPkg = packages[index];
        }
    }

    return closestPkg;
}

async function migrateSubscriptions(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();
        const targetConn = dbManager.getTargetConnection();

        progressCallback({ step: 'subscriptions', percentage: 0, message: 'جارٍ قراءة الاشتراكات...', type: 'info' });

        // Keep exactly one latest subscription row per customer, with ID tie-breaking.
        const [latestSubs] = await sourceConn.execute(`
            SELECT icp.*
            FROM io_customer_partnership icp
            INNER JOIN (
                SELECT cust_id, MAX(cust_partnership_date) AS max_date
                FROM io_customer_partnership
                GROUP BY cust_id
            ) latest
                ON icp.cust_id = latest.cust_id
               AND icp.cust_partnership_date = latest.max_date
            INNER JOIN (
                SELECT cust_id, cust_partnership_date, MAX(cust_partnership_id) AS max_id
                FROM io_customer_partnership
                GROUP BY cust_id, cust_partnership_date
            ) tie_breaker
                ON icp.cust_id = tie_breaker.cust_id
               AND icp.cust_partnership_date = tie_breaker.cust_partnership_date
               AND icp.cust_partnership_id = tie_breaker.max_id
            ORDER BY icp.cust_id
        `);

        progressCallback({ step: 'subscriptions', percentage: 10, message: `تم العثور على ${latestSubs.length} اشتراك (أحدث اشتراك لكل عميل)...`, type: 'info' });

        const [customValues] = await sourceConn.execute(`
            SELECT customer_id, partnership_paid_value, partnership_purchasing_value
            FROM customize_partnership_values
        `);
        const customMap = {};
        for (const cv of customValues) {
            customMap[cv.customer_id] = cv;
        }

        const [defaultValues] = await sourceConn.execute(`
            SELECT partnership_paid_value, partnership_purchasing_value
            FROM default_partnership_values
            ORDER BY partnership_paid_value ASC
        `);

        const packages = buildPackageCatalog(defaultValues);
        const defaultPaid = packages[0].paid;
        const defaultCredit = packages[0].credit;

        progressCallback({ step: 'subscriptions', percentage: 20, message: 'جارٍ إنشاء الباقات الأساسية...', type: 'info' });

        await dbManager.beginTransaction();

        // Customer migration cannot infer the real subscription number. Rebuild
        // this field only from cust_partnership_no to avoid carrying customer IDs
        // into the target's unique subscription_number column.
        await targetConn.execute('UPDATE customers SET subscription_number = NULL');

        let packageSeq = 1;
        for (const pkg of packages) {
            const [insertResult] = await targetConn.execute(
                `INSERT INTO prepaid_packages (name_ar, prepaid_price, service_credit_value, duration_days, is_active, sort_order)
                 VALUES (?, ?, ?, 30, 1, ?)
                 ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
                [pkg.name, pkg.paid, pkg.credit, packageSeq++]
            );
            pkg.id = insertResult.insertId;
        }

        await dbManager.commit();

        progressCallback({ step: 'subscriptions', percentage: 40, message: `تم إنشاء ${packages.length} باقة، جارٍ نقل الاشتراكات...`, type: 'info' });

        await dbManager.beginTransaction();

        const [custPartnershipNos] = await sourceConn.execute(
            `SELECT cust_id, cust_partnership_no FROM io_customers WHERE cust_partnership_no IS NOT NULL`
        );
        const partnershipNoMap = {};
        for (const customer of custPartnershipNos) {
            partnershipNoMap[customer.cust_id] = customer.cust_partnership_no;
        }

        // Union of customers with a partnership record AND customers who only
        // carry a subscription number (cust_partnership_no) but never had a
        // matching io_customer_partnership row — both must be migrated.
        const subMap = {};
        for (const sub of latestSubs) {
            subMap[sub.cust_id] = sub;
        }
        // Customers skipped during customer migration (e.g. no phone) don't exist
        // in the target — creating subscriptions for them would violate the FK.
        const [targetCustomerRows] = await targetConn.execute(`SELECT id FROM customers`);
        const targetCustomerIds = new Set(targetCustomerRows.map(r => r.id));

        const allCustIds = Array.from(new Set([
            ...latestSubs.map(s => s.cust_id),
            ...Object.keys(partnershipNoMap).map(id => parseInt(id, 10))
        ])).filter(id => {
            if (targetCustomerIds.has(id)) return true;
            progressCallback({
                step: 'subscriptions',
                percentage: 40,
                message: `تحذير: تخطي اشتراك العميل ${id} لأن العميل غير منقول (بدون جوال أو مكرر)`,
                type: 'warning'
            });
            return false;
        });

        const total = allCustIds.length;
        if (total === 0) {
            await dbManager.commit();
            progressCallback({ step: 'subscriptions', percentage: 100, message: 'لا توجد اشتراكات للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        let migrated = 0;
        let invoicesMigrated = 0;
        let receiptsMigrated = 0;
        let ledgerEntriesMigrated = 0;
        let invoiceSeq = 1;
        const BATCH_SIZE = 500;
        const subscriptionOwners = new Map();

        for (let i = 0; i < allCustIds.length; i += BATCH_SIZE) {
            const batch = allCustIds.slice(i, i + BATCH_SIZE);

            for (const custId of batch) {
                // Customers with only a subscription number (no io_customer_partnership
                // row) still need to be migrated, with a zero balance.
                const sub = subMap[custId] || {
                    cust_id: custId,
                    cust_partnership_paid_value: 0,
                    cust_partnership_value: 0,
                    cust_partnership_date: null,
                    partship_end_date: null,
                    cust_partnership_id: null
                };
                const custom = customMap[custId];
                const paid = custom
                    ? toNumOrDefault(custom.partnership_paid_value, defaultPaid)
                    : toNumOrDefault(sub.cust_partnership_paid_value, defaultPaid);
                const credit = custom
                    ? toNumOrDefault(custom.partnership_purchasing_value, defaultCredit)
                    : toNumOrDefault(sub.cust_partnership_value, defaultCredit);

                const closestPkg = pickClosestPackage(packages, paid);
                const packageId = closestPkg.id;

                const endDate = sub.partship_end_date || null;
                const startDate = sub.cust_partnership_date || new Date();
                const partnershipNo = partnershipNoMap[custId];
                const legacyRef = partnershipNo ? String(partnershipNo) : null;
                let subRef = legacyRef || `SUB-${String(custId).padStart(6, '0')}`;
                const existingOwner = subscriptionOwners.get(subRef);
                if (existingOwner && existingOwner !== custId) {
                    subRef = `SUB-${String(custId).padStart(6, '0')}`;
                    progressCallback({
                        step: 'subscriptions',
                        percentage: 40,
                        message: `تحذير: رقم الاشتراك ${legacyRef} مكرر، تم استخدام ${subRef} للعميل ${custId}`,
                        type: 'warning'
                    });
                }
                subscriptionOwners.set(subRef, custId);

                await targetConn.execute(
                    `INSERT INTO customer_subscriptions (customer_id, subscription_ref, current_package_id, end_date)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        customer_id = VALUES(customer_id),
                        current_package_id = VALUES(current_package_id),
                        end_date = VALUES(end_date)`,
                    [custId, subRef, packageId, endDate]
                );

                const [existingSub] = await targetConn.execute(
                    `SELECT id FROM customer_subscriptions WHERE subscription_ref = ? LIMIT 1`,
                    [subRef]
                );
                const actualSubId = existingSub.length > 0 ? existingSub[0].id : null;

                if (actualSubId && packageId) {
                    await targetConn.execute(
                        `INSERT INTO subscription_periods
                            (customer_subscription_id, package_id, period_from, period_to, prepaid_price_paid,
                             credit_value_granted, credit_remaining, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            prepaid_price_paid = VALUES(prepaid_price_paid),
                            credit_value_granted = VALUES(credit_value_granted),
                            credit_remaining = VALUES(credit_remaining),
                            status = VALUES(status)`,
                        [
                            actualSubId,
                            packageId,
                            startDate,
                            endDate,
                            paid,
                            credit,
                            credit,
                            endDate && new Date(endDate) < new Date() ? 'expired' : 'active'
                        ]
                    );

                    const [periodRows] = await targetConn.execute(
                        `SELECT id FROM subscription_periods
                         WHERE customer_subscription_id = ? AND package_id = ? AND period_from = ?
                         ORDER BY id DESC LIMIT 1`,
                        [actualSubId, packageId, startDate]
                    );
                    const actualPeriodId = periodRows.length > 0 ? periodRows[0].id : null;

                    if (actualPeriodId) {
                        const paymentMethod = 'cash';
                        const paidCash = paid;
                        const paidCard = 0;
                        const netAmount = paid > 0 ? Number((paid / 1.15).toFixed(2)) : 0;
                        const vatAmount = Number((paid - netAmount).toFixed(2));

                        await targetConn.execute(
                            `DELETE FROM subscription_invoices WHERE period_id = ?`,
                            [actualPeriodId]
                        );
                        await targetConn.execute(
                            `DELETE FROM subscription_ledger WHERE subscription_period_id = ?`,
                            [actualPeriodId]
                        );
                        await targetConn.execute(
                            `DELETE FROM subscription_receipts WHERE subscription_id = ? AND customer_id = ? AND created_at = ?`,
                            [actualSubId, custId, startDate]
                        );

                        await targetConn.execute(
                            `INSERT INTO subscription_invoices
                                (invoice_seq, subscription_id, period_id, customer_id, package_id, package_name_ar,
                                 invoice_type, payment_method, paid_cash, paid_card, prepaid_price,
                                 vat_rate, net_amount, vat_amount, total_amount, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 15.00, ?, ?, ?, ?)`,
                            [
                                invoiceSeq++,
                                actualSubId,
                                actualPeriodId,
                                custId,
                                packageId,
                                closestPkg.name,
                                paymentMethod,
                                paidCash,
                                paidCard,
                                paid,
                                netAmount,
                                vatAmount,
                                paid,
                                startDate
                            ]
                        );
                        invoicesMigrated++;

                        if (paid > 0) {
                            await targetConn.execute(
                                `INSERT INTO subscription_receipts
                                    (subscription_id, customer_id, amount, payment_method, created_at)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [actualSubId, custId, paid, paymentMethod, startDate]
                            );
                            receiptsMigrated++;
                        }

                        await targetConn.execute(
                            `INSERT INTO subscription_ledger
                                (subscription_period_id, entry_type, amount, balance_after, ref_type, ref_id, notes, created_at)
                             VALUES (?, 'purchase', ?, ?, 'migration', ?, ?, ?)`,
                            [
                                actualPeriodId,
                                credit,
                                credit,
                                sub.cust_partnership_id,
                                `تفعيل باقة "${closestPkg.name}" — منقول من البيانات القديمة`,
                                startDate
                            ]
                        );
                        ledgerEntriesMigrated++;
                    }
                }

                if (subRef) {
                    await targetConn.execute(
                        `UPDATE customers SET subscription_number = ? WHERE id = ?`,
                        [subRef, custId]
                    );
                }

                migrated++;
            }

            const percentage = 40 + Math.round((migrated / total) * 55);
            progressCallback({
                step: 'subscriptions',
                percentage,
                message: `تم نقل ${migrated}/${total} اشتراك...`,
                type: 'info'
            });
        }

        await dbManager.commit();

        progressCallback({
            step: 'subscriptions',
            percentage: 100,
            message: `تم نقل ${migrated} اشتراك + ${invoicesMigrated} فاتورة اشتراك + ${receiptsMigrated} إيصال + ${ledgerEntriesMigrated} حركة رصيد`,
            type: 'success'
        });

        return { success: true, migrated, invoicesMigrated, receiptsMigrated, ledgerEntriesMigrated };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'subscriptions',
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

module.exports = { migrateSubscriptions };
