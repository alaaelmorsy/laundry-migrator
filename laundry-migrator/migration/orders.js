const dbManager = require('./db');

function mapPaymentMethod(methodId) {
    const map = { 1: 'cash', 2: 'card', 3: 'credit', 4: 'bank_transfer', 5: 'subscription' };
    return map[methodId] || 'cash';
}

function normalizePaymentBreakdown(bill, total, paymentMethod) {
    let paidCash = parseFloat(bill.paid_cash) || 0;
    let paidCard = parseFloat(bill.paid_card) || 0;
    const depositValue = parseFloat(bill.deposit_value) || 0;
    const subscriptionConsumed = parseFloat(bill.current_part_value) || 0;

    let paidAmount = 0;
    if (bill.bill_is_paid) {
        paidAmount = total;
    } else if (paidCash + paidCard > 0) {
        paidAmount = paidCash + paidCard;
    } else {
        paidAmount = depositValue;
    }

    if (paidAmount > 0 && paidCash === 0 && paidCard === 0) {
        if (paymentMethod === 'card') paidCard = paidAmount;
        else if (paymentMethod === 'cash') paidCash = paidAmount;
        else paidCash = paidAmount;
    }

    if (paidCash + paidCard > 0) {
        paidAmount = paidCash + paidCard;
    }

    const settledTotal = paidAmount + subscriptionConsumed;
    const remainingAmount = Math.max(0, total - settledTotal);
    const paymentStatus = remainingAmount <= 0 ? 'paid' : (settledTotal > 0 ? 'partial' : 'unpaid');

    return {
        paidCash,
        paidCard,
        paidAmount,
        remainingAmount,
        paymentStatus,
        subscriptionConsumed,
        depositValue
    };
}

function buildSubscriptionPeriodLookup(periods) {
    const byCustomer = new Map();

    for (const period of periods) {
        if (!byCustomer.has(period.customer_id)) {
            byCustomer.set(period.customer_id, []);
        }
        byCustomer.get(period.customer_id).push(period);
    }

    for (const customerPeriods of byCustomer.values()) {
        customerPeriods.sort((a, b) => new Date(a.period_from) - new Date(b.period_from));
    }

    return byCustomer;
}

function findMatchingPeriod(periodLookup, customerId, billDate) {
    if (!customerId || !periodLookup.has(customerId) || !billDate) return null;

    const when = new Date(billDate);
    const periods = periodLookup.get(customerId);

    return periods.find(period => {
        const from = new Date(period.period_from);
        const to = period.period_to ? new Date(period.period_to) : null;
        return when >= from && (!to || when <= to);
    }) || null;
}

async function migrateOrders(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();
        const targetConn = dbManager.getTargetConnection();

        progressCallback({ step: 'orders', percentage: 0, message: 'جارٍ قراءة الفواتير...', type: 'info' });

        const [bills] = await sourceConn.execute(
            `SELECT bill_no, username, cust_id, bill_sum, bill_discount, bill_total,
                    bill_date, bill_is_paid, bill_comment, bill_paid_date,
                    bill_extra, payment_method, deposit_value, deposit_remain_value,
                    is_deleted, bill_cleaned_date, bill_delivery_date, bill_notes,
                    vat_part_value, offer_value, paid_cash, paid_card, bill_general_discount,
                    is_urgent, bill_is_partnership, current_part_value
             FROM bills
             WHERE is_deleted = 0
             ORDER BY bill_no`
        );

        const total = bills.length;
        if (total === 0) {
            progressCallback({ step: 'orders', percentage: 100, message: 'لا توجد فواتير للنقل', type: 'info' });
            return { success: true, migrated: 0, itemsMigrated: 0, paymentsMigrated: 0 };
        }

        progressCallback({ step: 'orders', percentage: 5, message: `تم العثور على ${total} فاتورة، جارٍ قراءة بنود الفواتير...`, type: 'info' });

        const [billItems] = await sourceConn.execute(
            `SELECT bct.bill_no, bct.io_types_operation_id, bct.type_count, bct.type_total_cost,
                    ito.type_id, ito.operation_id
             FROM bill_closes_types bct
             LEFT JOIN io_types_operation ito ON bct.io_types_operation_id = ito.io_types_operation_id
             ORDER BY bct.bill_no`
        );

        const [subscriptionPeriods] = await targetConn.execute(`
            SELECT sp.id, sp.period_from, sp.period_to, cs.customer_id
            FROM subscription_periods sp
            INNER JOIN customer_subscriptions cs ON cs.id = sp.customer_subscription_id
        `);
        const subscriptionPeriodLookup = buildSubscriptionPeriodLookup(subscriptionPeriods);

        const itemsByBill = {};
        for (const item of billItems) {
            if (!itemsByBill[item.bill_no]) itemsByBill[item.bill_no] = [];
            itemsByBill[item.bill_no].push(item);
        }

        progressCallback({ step: 'orders', percentage: 15, message: `جارٍ نقل ${total} فاتورة...`, type: 'info' });

        await dbManager.beginTransaction();

        const BATCH_SIZE = 500;
        let migratedOrders = 0;
        let migratedItems = 0;
        let paymentsMigrated = 0;

        for (let i = 0; i < bills.length; i += BATCH_SIZE) {
            const batch = bills.slice(i, i + BATCH_SIZE);
            const normalizedOrders = [];

            for (const bill of batch) {
                const subtotal = parseFloat(bill.bill_sum) || 0;
                const discountAmount = parseFloat(bill.bill_discount) || 0;
                const vatAmount = parseFloat(bill.vat_part_value) || 0;
                const totalAmount = parseFloat(bill.bill_total) || subtotal - discountAmount;
                const paymentMethod = mapPaymentMethod(bill.payment_method);
                const billDate = bill.bill_date || new Date();
                const matchedPeriod = findMatchingPeriod(subscriptionPeriodLookup, bill.cust_id || null, billDate);

                const payment = normalizePaymentBreakdown(bill, totalAmount, paymentMethod);
                const isSubscriptionSettlement = payment.subscriptionConsumed > 0
                    || Boolean(bill.bill_is_partnership)
                    || paymentMethod === 'subscription';

                normalizedOrders.push({
                    bill,
                    billDate,
                    paymentMethod,
                    matchedPeriod,
                    isSubscriptionSettlement,
                    subtotal,
                    discountAmount,
                    vatAmount,
                    totalAmount,
                    payment
                });
            }

            const orderRows = normalizedOrders.map(order => ([
                order.bill.bill_no,
                String(order.bill.bill_no),
                order.bill.bill_no,
                order.bill.cust_id || null,
                order.subtotal,
                order.discountAmount,
                15.00,
                order.vatAmount,
                order.totalAmount,
                order.payment.paidAmount,
                order.payment.remainingAmount,
                order.payment.paidCash,
                order.payment.paidCard,
                order.paymentMethod,
                order.bill.bill_notes || order.bill.bill_comment || null,
                order.bill.username || null,
                order.billDate,
                order.payment.paymentStatus,
                order.bill.bill_paid_date || null,
                order.payment.paymentStatus === 'paid' ? (order.bill.bill_paid_date || order.billDate) : null,
                order.bill.bill_cleaned_date || null,
                order.bill.bill_delivery_date || null,
                parseFloat(order.bill.bill_extra) || 0,
                order.isSubscriptionSettlement ? 'subscription' : 'migration',
                order.bill.bill_no,
                order.isSubscriptionSettlement ? (order.payment.paidAmount === 0 && order.payment.subscriptionConsumed > 0 ? 'subscription_renewal' : 'pos') : 'pos',
                order.matchedPeriod ? order.matchedPeriod.id : null,
                order.payment.paidAmount === 0 && order.payment.subscriptionConsumed > 0 ? 1 : 0,
                order.payment.subscriptionConsumed,
                order.isSubscriptionSettlement ? (order.matchedPeriod ? order.matchedPeriod.id : null) : null,
                parseFloat(order.bill.bill_general_discount) || 0
            ]));

            const orderPlaceholders = orderRows.map(() =>
                '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).join(', ');

            await targetConn.execute(
                `INSERT INTO orders (
                    id, order_number, invoice_seq, customer_id, subtotal, discount_amount, vat_rate,
                    vat_amount, total_amount, paid_amount, remaining_amount,
                    paid_cash, paid_card, payment_method, notes, created_by,
                    created_at, payment_status, paid_at, fully_paid_at, cleaning_date,
                    delivery_date, extra_amount, source, source_ref_id, order_type,
                    subscription_period_id, is_consumption_only, consumption_amount,
                    settled_by_subscription_period_id, customer_discount_amount
                ) VALUES ${orderPlaceholders}
                ON DUPLICATE KEY UPDATE
                    order_number = VALUES(order_number),
                    invoice_seq = VALUES(invoice_seq),
                    customer_id = VALUES(customer_id),
                    subtotal = VALUES(subtotal),
                    discount_amount = VALUES(discount_amount),
                    vat_amount = VALUES(vat_amount),
                    total_amount = VALUES(total_amount),
                    paid_amount = VALUES(paid_amount),
                    remaining_amount = VALUES(remaining_amount),
                    paid_cash = VALUES(paid_cash),
                    paid_card = VALUES(paid_card),
                    payment_method = VALUES(payment_method),
                    notes = VALUES(notes),
                    created_by = VALUES(created_by),
                    created_at = VALUES(created_at),
                    payment_status = VALUES(payment_status),
                    paid_at = VALUES(paid_at),
                    fully_paid_at = VALUES(fully_paid_at),
                    cleaning_date = VALUES(cleaning_date),
                    delivery_date = VALUES(delivery_date),
                    extra_amount = VALUES(extra_amount),
                    source = VALUES(source),
                    source_ref_id = VALUES(source_ref_id),
                    order_type = VALUES(order_type),
                    subscription_period_id = VALUES(subscription_period_id),
                    is_consumption_only = VALUES(is_consumption_only),
                    consumption_amount = VALUES(consumption_amount),
                    settled_by_subscription_period_id = VALUES(settled_by_subscription_period_id),
                    customer_discount_amount = VALUES(customer_discount_amount)`,
                orderRows.flatMap(row => row)
            );

            migratedOrders += batch.length;

            const itemRows = [];
            const paymentRows = [];
            const orderIds = normalizedOrders.map(order => order.bill.bill_no);

            for (const order of normalizedOrders) {
                const items = itemsByBill[order.bill.bill_no] || [];
                for (const item of items) {
                    const qty = parseInt(item.type_count) || 1;
                    const lineTotal = parseFloat(item.type_total_cost) || 0;
                    const unitPrice = qty > 0 ? lineTotal / qty : 0;

                    itemRows.push([
                        order.bill.bill_no,
                        item.type_id || null,
                        item.operation_id || null,
                        qty,
                        unitPrice,
                        lineTotal
                    ]);
                }

                const paymentDate = order.bill.bill_paid_date || order.billDate;
                const paymentNotes = order.bill.bill_notes || order.bill.bill_comment || 'Migrated payment';

                if (order.payment.paidCash > 0) {
                    paymentRows.push([
                        order.bill.bill_no,
                        order.payment.paidCash,
                        'cash',
                        order.payment.paidCash,
                        0,
                        paymentDate,
                        order.bill.username || 'migration',
                        paymentNotes
                    ]);
                }

                if (order.payment.paidCard > 0) {
                    paymentRows.push([
                        order.bill.bill_no,
                        order.payment.paidCard,
                        'card',
                        0,
                        order.payment.paidCard,
                        paymentDate,
                        order.bill.username || 'migration',
                        paymentNotes
                    ]);
                }

                if (order.payment.paidCash === 0 && order.payment.paidCard === 0 && order.payment.paidAmount > 0) {
                    paymentRows.push([
                        order.bill.bill_no,
                        order.payment.paidAmount,
                        order.paymentMethod === 'subscription' ? 'cash' : order.paymentMethod,
                        order.paymentMethod === 'card' ? 0 : order.payment.paidAmount,
                        order.paymentMethod === 'card' ? order.payment.paidAmount : 0,
                        paymentDate,
                        order.bill.username || 'migration',
                        paymentNotes
                    ]);
                }
            }

            if (itemRows.length > 0) {
                const itemPlaceholders = itemRows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
                await targetConn.execute(
                    `INSERT INTO order_items (order_id, product_id, laundry_service_id, quantity, unit_price, line_total)
                     VALUES ${itemPlaceholders}
                     ON DUPLICATE KEY UPDATE
                        quantity = VALUES(quantity),
                        unit_price = VALUES(unit_price),
                        line_total = VALUES(line_total)`,
                    itemRows.flatMap(row => row)
                );
                migratedItems += itemRows.length;
            }

            if (paymentRows.length > 0) {
                const deletePaymentPlaceholders = orderIds.map(() => '?').join(', ');
                await targetConn.execute(
                    `DELETE FROM invoice_payments WHERE order_id IN (${deletePaymentPlaceholders})`,
                    orderIds
                );
                const paymentPlaceholders = paymentRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                await targetConn.execute(
                    `INSERT INTO invoice_payments
                        (order_id, payment_amount, payment_method, cash_amount, card_amount, payment_date, created_by, notes)
                     VALUES ${paymentPlaceholders}`,
                    paymentRows.flatMap(row => row)
                );
                paymentsMigrated += paymentRows.length;
            }

            const percentage = 15 + Math.round((migratedOrders / total) * 80);
            progressCallback({
                step: 'orders',
                percentage,
                message: `تم نقل ${migratedOrders}/${total} فاتورة (${migratedItems} بند، ${paymentsMigrated} حركة دفع)...`,
                type: 'info'
            });
        }

        await dbManager.commit();

        progressCallback({
            step: 'orders',
            percentage: 100,
            message: `تم نقل ${migratedOrders} فاتورة و${migratedItems} بند و${paymentsMigrated} حركة دفع بنجاح`,
            type: 'success'
        });

        return { success: true, migrated: migratedOrders, itemsMigrated: migratedItems, paymentsMigrated };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'orders',
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

module.exports = { migrateOrders };
