const dbManager = require('./db');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

async function migrateProducts(sourceConfig, targetConfig, imageFolder, progressCallback) {
    let connected = false;

    try {
        const connectResult = await dbManager.connect(sourceConfig, targetConfig);
        if (!connectResult.success) {
            return { success: false, error: connectResult.error };
        }
        connected = true;

        const sourceConn = dbManager.getSourceConnection();

        progressCallback({ step: 'products', percentage: 0, message: 'جاري قراءة أنواع الملابس...', type: 'info' });

        // Dynamically check which optional columns exist in io_types
        let hasDeleted = false, hasTypeLocation = false, hasTypeIcon = false;
        try {
            const [allCols] = await sourceConn.execute(`SHOW COLUMNS FROM io_types`);
            const colNames = allCols.map(c => c.Field || c.field || Object.values(c)[0]);
            hasDeleted      = colNames.includes('deleted');
            hasTypeLocation = colNames.includes('type_location');
            hasTypeIcon     = colNames.includes('type_icon');
        } catch (e) {}

        const typeCols = ['type_id', 'type_name', 'type_name_en'];
        if (hasTypeIcon)     typeCols.push('type_icon');
        if (hasTypeLocation) typeCols.push('type_location');
        if (hasDeleted)      typeCols.push('deleted');

        const [types] = await sourceConn.execute(
            `SELECT ${typeCols.join(', ')} FROM io_types ORDER BY type_id`
        );

        let typeImages = [];
        try {
            const [tables] = await sourceConn.execute("SHOW TABLES LIKE 'type_images'");
            if (tables.length > 0) {
                const [images] = await sourceConn.execute('SELECT type_id, image_data, image_type FROM type_images');
                typeImages = images;
            }
        } catch (e) {
            // Silently ignore
        }

        let typePrices = [];
        try {
            const [prices] = await sourceConn.execute('SELECT type_id, operation_id, type_default_cost_for_cust FROM io_types_operation');
            typePrices = prices;
        } catch (e) {
            console.log('io_types_operation not found or error', e.message);
        }

        const total = types.length;
        if (total === 0) {
            progressCallback({ step: 'products', percentage: 100, message: 'لا توجد منتجات للنقل', type: 'info' });
            return { success: true, migrated: 0 };
        }

        progressCallback({ step: 'products', percentage: 20, message: `تم العثور على ${total} نوع ملابس، جاري النقل...`, type: 'info' });

        await dbManager.beginTransaction();

        // Read all available files in the image folder
        let availableImages = [];
        // Build lookup maps: exact NFC -> real_filename, lowercase NFC -> real_filename
        let availableImagesMapExact = {}; // NFC(filename) -> real_filename
        let availableImagesMapLower = {}; // NFC(filename).toLowerCase() -> real_filename
        if (imageFolder && fs.existsSync(imageFolder)) {
            try {
                availableImages = fs.readdirSync(imageFolder).filter(f => {
                    try {
                        return fs.statSync(path.join(imageFolder, f)).isFile();
                    } catch (e) { return false; }
                });
                // Build NFC-normalized maps for robust Arabic filename matching
                availableImages.forEach(f => {
                    const nfc = f.normalize('NFC');
                    availableImagesMapExact[nfc] = f;
                    availableImagesMapLower[nfc.toLowerCase()] = f;
                });
            } catch (e) {
                console.log('Could not read image folder', e.message);
            }
        }

        // Helper: Unicode NFC normalize + trim
        const nfc = (s) => (s ? s.normalize('NFC').trim() : '');

        // Helper function to normalize Arabic text for better matching
        const normalizeArabic = (text) => {
            if (!text) return '';
            return nfc(text)
                       .replace(/[أإآا]/g, 'ا')
                       .replace(/ة/g, 'ه')
                       .replace(/ى/g, 'ي')
                       .replace(/\s+/g, ' ')
                       .trim();
        };

        // Helper: resolve MIME from extension
        const getMime = (filename) => {
            const ext = path.extname(filename).toLowerCase();
            if (ext === '.png') return 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
            if (ext === '.gif') return 'image/gif';
            if (ext === '.svg') return 'image/svg+xml';
            if (ext === '.webp') return 'image/webp';
            return 'application/octet-stream';
        };

        const rows = [];
        let imagesFound = 0, imagesMissing = 0;
        for (let index = 0; index < types.length; index++) {
            const t = types[index];
            let imageData = null;
            let imageMime = null;
            
            // Try to load from folder first
            if (imageFolder && availableImages.length > 0) {
                try {
                    let targetFilename = null;
                    const rawIcon = t.type_icon ? t.type_icon.trim() : null;

                    // Extract just the basename from type_icon (handles full paths like C:\images\shirt.png)
                    // Apply NFC normalization to handle Arabic Unicode encoding differences
                    const iconBasename = rawIcon ? nfc(path.basename(rawIcon)) : null;

                    // 1. Exact NFC match by basename of type_icon
                    if (iconBasename && availableImagesMapExact[iconBasename]) {
                        targetFilename = availableImagesMapExact[iconBasename];
                    }
                    // 2. Case-insensitive NFC match by basename of type_icon
                    else if (iconBasename) {
                        const lcIcon = iconBasename.toLowerCase();
                        if (availableImagesMapLower[lcIcon]) {
                            targetFilename = availableImagesMapLower[lcIcon];
                        }
                    }

                    // 3. Try matching by type_name (Arabic) against file basename (without extension)
                    if (!targetFilename && t.type_name) {
                        const normalizedName = normalizeArabic(t.type_name.trim());
                        const match = availableImages.find(f => {
                            const nameWithoutExt = normalizeArabic(path.parse(f).name);
                            return nameWithoutExt === normalizedName;
                        });
                        if (match) targetFilename = match;
                    }

                    // 4. Try matching by type_name_en
                    if (!targetFilename && t.type_name_en) {
                        const lcNameEn = t.type_name_en.trim().toLowerCase();
                        const match = availableImages.find(f => {
                            return path.parse(f).name.trim().toLowerCase() === lcNameEn;
                        });
                        if (match) targetFilename = match;
                    }

                    // 5. Partial/substring match for Arabic name as last resort —
                    // accepted ONLY when exactly one file matches; an ambiguous
                    // match would silently attach the wrong product image.
                    if (!targetFilename && t.type_name) {
                        const normalizedName = normalizeArabic(t.type_name.trim());
                        if (normalizedName.length >= 4) {
                            const matches = availableImages.filter(f => {
                                const nameWithoutExt = normalizeArabic(path.parse(f).name);
                                if (nameWithoutExt.length < 4) return false;
                                return normalizedName.includes(nameWithoutExt) || nameWithoutExt.includes(normalizedName);
                            });
                            if (matches.length === 1) {
                                targetFilename = matches[0];
                            } else if (matches.length > 1) {
                                console.log(`[products] ⚠ تجاهل مطابقة غامضة (${matches.length} ملفات) للمنتج: "${t.type_name}"`);
                            }
                        }
                    }

                    if (targetFilename) {
                        const imgPath = path.join(imageFolder, targetFilename);
                        if (fs.existsSync(imgPath)) {
                            imageData = zlib.gzipSync(fs.readFileSync(imgPath), { level: 9 });
                            imageMime = getMime(targetFilename);
                            imagesFound++;
                            console.log(`[products] ✓ صورة وُجدت: "${targetFilename}" للمنتج: "${t.type_name}" (type_icon: "${rawIcon}")`);
                        } else {
                            console.log(`[products] ✗ الملف غير موجود في المجلد: "${targetFilename}" للمنتج: "${t.type_name}"`);
                        }
                    } else {
                        console.log(`[products] ✗ لم تُوجد صورة للمنتج: "${t.type_name}" (type_icon: "${rawIcon}")`);
                    }
                } catch (err) {
                    console.log('Error reading image from folder:', err.message);
                }
            }

            // Fallback to database type_images if folder not provided or file not found
            if (!imageData) {
                const img = typeImages.find(i => i.type_id === t.type_id);
                if (img) {
                    const raw = img.image_data;
                    // gzip-compress if not already compressed
                    const first2 = raw && raw.length >= 2 ? raw[0].toString(16).padStart(2,'0') + raw[1].toString(16).padStart(2,'0') : '';
                    imageData = (first2 === '1f8b') ? raw : zlib.gzipSync(raw, { level: 9 });
                    imageMime = img.image_type;
                    imagesFound++;
                    console.log(`[products] ✓ صورة من قاعدة البيانات: "${t.type_name}"`);
                }
            }

            // Count "missing" exactly once per product, after BOTH sources were
            // tried — counting inside the folder branch alone reported success
            // when no folder was selected and the DB had no image either.
            if (!imageData) {
                imagesMissing++;
            }

            rows.push([
                t.type_id,
                t.type_name || `منتج ${t.type_id}`,
                t.type_name_en || null,
                (hasDeleted ? (t.deleted ? 0 : 1) : 1),
                (hasTypeLocation ? (t.type_location ?? index) : index),
                imageData,
                imageMime
            ]);
        }

        const productCounters = await dbManager.batchInsert(
            'products',
            ['id', 'name_ar', 'name_en', 'is_active', 'sort_order', 'image_blob', 'image_mime'],
            rows,
            'name_ar = VALUES(name_ar), name_en = VALUES(name_en), is_active = VALUES(is_active), sort_order = VALUES(sort_order), image_blob = VALUES(image_blob), image_mime = VALUES(image_mime)'
        );
        const migrated = productCounters.inserted + productCounters.updated;

        if (typePrices.length > 0) {
            progressCallback({ step: 'products', percentage: 60, message: 'جاري نقل الأسعار...', type: 'info' });
            // Legacy io_types_operation contains orphan rows (NULL type_id, or a
            // type_id pointing at a deleted io_types row). Before strict sql_mode
            // these were silently inserted as product_id = 0; now they must be
            // excluded to only price products that actually migrated.
            const migratedTypeIds = new Set(types.map(t => t.type_id));
            const validPrices = typePrices.filter(p =>
                p.operation_id != null && p.type_id != null && migratedTypeIds.has(p.type_id)
            );
            const skippedPrices = typePrices.length - validPrices.length;
            if (skippedPrices > 0) {
                progressCallback({
                    step: 'products',
                    percentage: 60,
                    message: `تم تجاهل ${skippedPrices} سطر سعر يتيم (بدون منتج أو خدمة مرتبطة)`,
                    type: 'warning'
                });
            }
            const priceRows = validPrices.map(p => [
                p.type_id,
                p.operation_id,
                p.type_default_cost_for_cust || 0
            ]);

            await dbManager.batchInsert(
                'product_price_lines',
                ['product_id', 'laundry_service_id', 'price'],
                priceRows,
                'price = VALUES(price)'
            );
        }

        await dbManager.commit();

        const imageSummary = (imagesFound === 0 && imagesMissing === 0)
            ? 'لا توجد صور للنقل'
            : (imagesMissing === 0
                ? `جميع الصور (${imagesFound}) تم نقلها بنجاح`
                : `صور: ${imagesFound} نُقلت ✓ — ${imagesMissing} لم تُوجد ✗`);

        progressCallback({
            step: 'products',
            percentage: 100,
            message: `✓ تم نقل ${migrated} نوع ملابس — ${imageSummary}`,
            type: imagesMissing === 0 ? 'success' : 'warning'
        });

        if (imagesMissing > 0) {
            progressCallback({
                step: 'products',
                percentage: 100,
                message: `تحقق من Console لمعرفة أسماء المنتجات التي لم تُوجد صورها`,
                type: 'warning'
            });
        }

        return { success: true, migrated, imagesFound, imagesMissing };

    } catch (error) {
        try { await dbManager.rollback(); } catch (e) {}
        progressCallback({
            step: 'products',
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

module.exports = { migrateProducts };
