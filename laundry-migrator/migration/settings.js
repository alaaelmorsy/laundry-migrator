const fs = require('fs');
const path = require('path');
const dbManager = require('./db');

function toBool(value) {
    return Number(value) === 1;
}

function toStringOrNull(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    return String(value);
}

function toTimeString(hour) {
    const numericHour = Number(hour);
    if (!Number.isInteger(numericHour) || numericHour < 0 || numericHour > 23) {
        return null;
    }

    return `${String(numericHour).padStart(2, '0')}:00`;
}

function detectMimeByExtension(fileName) {
    const extension = path.extname(fileName || '').toLowerCase();

    if (extension === '.png') return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.bmp') return 'image/bmp';
    if (extension === '.svg') return 'image/svg+xml';

    return 'application/octet-stream';
}

function resolveLogoFromFile(sourceConfig, fileName) {
    if (!fileName) {
        return { data: null, mime: null, path: null };
    }

    const trimmedName = String(fileName).trim();
    if (!trimmedName) {
        return { data: null, mime: null, path: null };
    }

    const candidatePaths = [
        trimmedName,
        path.resolve(process.cwd(), trimmedName),
        path.resolve(process.cwd(), 'logos', trimmedName),
        path.resolve(process.cwd(), 'images', trimmedName),
        path.resolve(process.cwd(), 'uploads', trimmedName),
        path.resolve(process.cwd(), 'uploads', 'logos', trimmedName),
        path.resolve(process.cwd(), 'assets', trimmedName),
        path.resolve(process.cwd(), 'assets', 'logos', trimmedName)
    ];

    if (sourceConfig && sourceConfig.database) {
        candidatePaths.push(
            path.resolve(process.cwd(), sourceConfig.database, trimmedName),
            path.resolve(process.cwd(), sourceConfig.database, 'logos', trimmedName),
            path.resolve(process.cwd(), sourceConfig.database, 'uploads', trimmedName),
            path.resolve(process.cwd(), sourceConfig.database, 'uploads', 'logos', trimmedName)
        );
    }

    for (const candidate of candidatePaths) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return {
                    data: fs.readFileSync(candidate),
                    mime: detectMimeByExtension(candidate),
                    path: candidate
                };
            }
        } catch (error) {}
    }

    return { data: null, mime: null, path: null };
}

async function migrateSettings(sourceConfig, targetConfig, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();
        const targetConn = dbManager.getTargetConnection();

        progressCallback({ step: 'settings', percentage: 0, message: 'جاري قراءة إعدادات المغسلة...', type: 'info' });

        const [rows] = await sourceConn.execute('SELECT * FROM laundry_info LIMIT 1');

        if (!rows || rows.length === 0) {
            progressCallback({ step: 'settings', percentage: 100, message: 'لا توجد إعدادات للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        const [[{ infoCount }]] = await sourceConn.execute('SELECT COUNT(*) AS infoCount FROM laundry_info');
        if (Number(infoCount) > 1) {
            progressCallback({ step: 'settings', percentage: 5,
                message: `تحذير: جدول laundry_info يحتوي ${infoCount} سجل — سيتم استخدام أول سجل، راجع النتيجة يدويًا`,
                type: 'warning' });
        }

        const src = rows[0];

        progressCallback({ step: 'settings', percentage: 40, message: 'جاري كتابة الإعدادات...', type: 'info' });

        // An explicit 0% VAT in the source is a deliberate setting (e.g. not VAT
        // registered) and must survive the migration; only a missing/invalid
        // value falls back to the KSA default of 15%.
        const parsedVat = parseFloat(src.value_added_tax);
        const vatRate = Number.isFinite(parsedVat) && parsedVat >= 0 ? parsedVat : 15.00;
        const priceDisplayMode = toBool(src.is_tax_included) ? 'inclusive' : 'exclusive';
        const invoicePaperType = toBool(src.designed_a4) ? 'a4' : 'thermal';
        // The legacy schema has no auto-print flag — printing_bills_no is the
        // COPY COUNT, not an on/off switch. Deriving behavior flags from it
        // turned "2 copies" into "print automatically". Default to off; the
        // copy count itself migrates into print_copies below.
        const autoPrintInvoice = 0;
        const dayResetHour = Number.isInteger(Number(src.closure_hour)) ? Number(src.closure_hour) : null;
        const dayResetTime = toTimeString(src.closure_hour);

        let logoBlob = src.logo_image_data || null;
        let logoMime = src.logo_image_type || null;
        let logoResolvedFromPath = null;

        if (!logoBlob && src.logo_image_name) {
            const resolvedLogo = resolveLogoFromFile(sourceConfig, src.logo_image_name);
            logoBlob = resolvedLogo.data;
            logoMime = logoMime || resolvedLogo.mime;
            logoResolvedFromPath = resolvedLogo.path;
        }

        await dbManager.beginTransaction();

        // UPDATE ... WHERE id = 1 silently does nothing on an empty table —
        // guarantee the settings row exists so the write below always lands.
        await targetConn.execute('INSERT IGNORE INTO app_settings (id) VALUES (1)');

        await targetConn.execute(
            `UPDATE app_settings SET
                laundry_name_ar = ?,
                laundry_name_en = ?,
                location_ar = ?,
                location_en = ?,
                invoice_notes = ?,
                phone = ?,
                email = ?,
                logo_blob = ?,
                logo_mime = ?,
                vat_number = ?,
                commercial_register = ?,
                building_number = ?,
                additional_number = ?,
                district_ar = ?,
                postal_code = ?,
                city_ar = ?,
                vat_rate = ?,
                price_display_mode = ?,
                invoice_paper_type = ?,
                logo_width = ?,
                logo_height = ?,
                print_copies = ?,
                auto_print_invoice = ?,
                require_customer_phone = ?,
                show_barcode_in_invoice = ?,
                show_email_in_invoice = ?,
                whatsapp_send_on_print = ?,
                whatsapp_send_on_clean = ?,
                whatsapp_send_on_deliver = ?,
                whatsapp_send_on_pay = ?,
                whatsapp_invoice_message = ?,
                report_email_from = ?,
                report_email_app_password_enc = ?,
                loyalty_enabled = ?,
                loyalty_points_per_sar = ?,
                support_expiry_date = ?,
                day_reset_hour = ?,
                day_reset_time = ?,
                active_theme = ?
             WHERE id = 1`,
            [
                src.laundry_name || null,
                src.laundry_name_en || null,
                src.laundry_location || null,
                src.laundry_location_en || null,
                src.bill_tips || null,
                src.owner_mobile || null,
                src.owner_email || null,
                logoBlob,
                logoMime,
                src.vat_Number || null,
                src.commercial_num || null,
                toStringOrNull(src.build_number),
                toStringOrNull(src.additional_number),
                src.subdivision || null,
                toStringOrNull(src.zip),
                src.city || null,
                vatRate,
                priceDisplayMode,
                invoicePaperType,
                src.logo_width || 180,
                src.logo_height || 70,
                src.printing_bills_no || 1,
                autoPrintInvoice,
                toBool(src.mandatory_mobile) ? 1 : 0,
                toBool(src.show_barcode) ? 1 : 0,
                toBool(src.show_mail) ? 1 : 0,
                // The legacy schema has no per-event WhatsApp flags for
                // print/pay (printing_bills_no is a copy count and
                // is_allowed_whatsup is a general permission, not an event).
                // Fabricating them from unrelated fields caused surprise
                // messages to customers — they start off and the operator
                // enables them deliberately in the new app.
                0,
                toBool(src.send_SMS_when_cleaned) ? 1 : 0,
                toBool(src.send_SMS_when_delivered) ? 1 : 0,
                0,
                // bill_tips is the invoice footer note (already migrated to
                // invoice_notes above) — it is NOT a WhatsApp message template.
                null,
                src.owmer_email_from || null,
                // The target column expects a value encrypted by the NEW app;
                // copying the legacy plaintext would leak the secret and break
                // decryption. The operator re-enters it once in the new app.
                null,
                toBool(src.points_option) ? 1 : 0,
                src.point_for_purchase || 1,
                src.cust_support_end || null,
                dayResetHour,
                dayResetTime,
                src.theme || 'default'
            ]
        );

        await dbManager.commit();

        progressCallback({
            step: 'settings',
            percentage: 100,
            message: logoResolvedFromPath
                ? '✓ تم نقل إعدادات المغسلة بنجاح وتم جلب الشعار من الملف'
                : '✓ تم نقل إعدادات المغسلة بنجاح',
            type: 'success'
        });

        return { success: true, migrated: 1 };
    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'settings',
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

module.exports = { migrateSettings };
