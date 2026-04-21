const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const Database = require('better-sqlite3');

const ROOT_DIR = process.env.LOTTIE_ZAP_ROOT
    ? path.resolve(process.env.LOTTIE_ZAP_ROOT)
    : process.cwd();
const DATA_DIR = process.env.LOTTIE_ZAP_DATA_DIR
    ? path.resolve(process.env.LOTTIE_ZAP_DATA_DIR)
    : path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.LOTTIE_ZAP_DB
    ? path.resolve(process.env.LOTTIE_ZAP_DB)
    : path.join(DATA_DIR, 'lottiepresets.db');
const DEBUG_DB = process.env.LOTTIE_ZAP_DEBUG_DB === 'true';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS lottie_presets (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        file_sha256 TEXT,
        source_json TEXT,
        was_blob BLOB NOT NULL,
        template_animation_json TEXT,
        template_animation_secondary_json TEXT,
        template_animation_trust_token TEXT,
        template_animation_secondary_trust_token TEXT,
        template_metadata_json TEXT DEFAULT '',
        template_native_secondary_json TEXT DEFAULT '',
        image_slot_applied INTEGER DEFAULT 0,
        created_by TEXT,
        updated_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        usage_count INTEGER DEFAULT 0
    )
`);

function getExistingColumns() {
    return db.prepare('PRAGMA table_info(lottie_presets)').all().map((column) => column.name);
}

function addColumnIfMissing(columnName, sqlDefinition) {
    const columns = getExistingColumns();
    if (!columns.includes(columnName)) {
        db.exec(`ALTER TABLE lottie_presets ADD COLUMN ${sqlDefinition}`);
    }
}

function ensureSchemaCompatibility() {
    addColumnIfMissing('was_blob', 'was_blob BLOB');
    addColumnIfMissing('template_animation_json', 'template_animation_json TEXT');
    addColumnIfMissing('template_animation_secondary_json', 'template_animation_secondary_json TEXT');
    addColumnIfMissing('template_animation_trust_token', 'template_animation_trust_token TEXT');
    addColumnIfMissing('template_animation_secondary_trust_token', 'template_animation_secondary_trust_token TEXT');
    addColumnIfMissing('template_metadata_json', "template_metadata_json TEXT DEFAULT ''");
    addColumnIfMissing('template_native_secondary_json', "template_native_secondary_json TEXT DEFAULT ''");
    addColumnIfMissing('image_slot_applied', 'image_slot_applied INTEGER DEFAULT 0');
    addColumnIfMissing('storage_mode', "storage_mode TEXT DEFAULT 'db'");
}

ensureSchemaCompatibility();

if (DEBUG_DB) {
    console.log('[LOTTIE-ZAP][DB] path:', DB_PATH);
    console.log('[LOTTIE-ZAP][DB] columns:', getExistingColumns().join(', '));
}

function hasColumn(columnName) {
    return getExistingColumns().includes(columnName);
}

function normalizeTitle(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';

    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

function sha256Hex(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hasInjectableImageSlot(animationJson) {
    return Array.isArray(animationJson?.assets) && animationJson.assets.some((asset) => (
        typeof asset?.p === 'string' &&
        (
            asset.p.startsWith('data:image/') ||
            asset.id === 'image_0' ||
            /^image[_-]/i.test(String(asset.id || ''))
        )
    ));
}

function buildImageSlotSecondaryTemplate(name = 'Lottie_ImageSlot') {
    const placeholderPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

    return {
        v: '5.12.1',
        fr: 60,
        ip: 0,
        op: 240,
        w: 540,
        h: 540,
        nm: `${name}_ImageSlot`,
        ddd: 0,
        assets: [
            {
                id: 'image_0',
                w: 540,
                h: 540,
                u: '',
                p: placeholderPng,
                e: 1
            }
        ],
        layers: [
            {
                ddd: 0,
                ind: 1,
                ty: 2,
                nm: 'Layer_Muter',
                refId: 'image_0',
                sr: 1,
                ks: {
                    o: { a: 0, k: 100 },
                    r: {
                        a: 1,
                        k: [
                            { t: 0, s: [0], e: [360] },
                            { t: 240 }
                        ]
                    },
                    p: { a: 0, k: [270, 270, 0] },
                    a: { a: 0, k: [270, 270, 0] },
                    s: {
                        a: 1,
                        k: [
                            { t: 0, s: [80, 80, 100], e: [85, 85, 100] },
                            { t: 60, s: [85, 85, 100], e: [80, 80, 100] },
                            { t: 120, s: [80, 80, 100], e: [85, 85, 100] },
                            { t: 180, s: [85, 85, 100], e: [80, 80, 100] },
                            { t: 240, s: [80, 80, 100] }
                        ]
                    }
                },
                ao: 0,
                ip: 0,
                op: 240,
                st: 0,
                bm: 0
            }
        ]
    };
}

function forceImageSlotSecondaryText(secondaryText, slug) {
    let parsed;
    try {
        parsed = JSON.parse(secondaryText);
    } catch {
        return {
            secondaryText,
            converted: false,
            nativeSecondaryText: null
        };
    }

    if (hasInjectableImageSlot(parsed)) {
        return {
            secondaryText,
            converted: false,
            nativeSecondaryText: null
        };
    }

    return {
        secondaryText: JSON.stringify(buildImageSlotSecondaryTemplate(slug)),
        converted: true,
        nativeSecondaryText: secondaryText
    };
}

function getZipFile(zip, fileName) {
    return zip.file(`animation/${fileName}`) || zip.file(fileName);
}

async function readZipText(zip, fileName, required = true) {
    const file = getZipFile(zip, fileName);
    if (!file) {
        if (required) throw new Error(`Arquivo ausente dentro do .was: animation/${fileName}`);
        return '';
    }
    return file.async('string');
}

async function extractAnimationTemplate(slug, wasBuffer) {
    const zip = await JSZip.loadAsync(wasBuffer);
    const animationJsonText = await readZipText(zip, 'animation.json');
    const secondaryOriginalText = await readZipText(zip, 'animation_secondary.json', false);
    const animationTrustTokenText = await readZipText(zip, 'animation.json.trust_token', false);
    const animationSecondaryTrustTokenText = await readZipText(zip, 'animation_secondary.json.trust_token', false);
    const metadataJsonText = await readZipText(zip, 'animation.json.overridden_metadata', false);
    const imageSlot = secondaryOriginalText
        ? forceImageSlotSecondaryText(secondaryOriginalText, slug)
        : {
            secondaryText: JSON.stringify(buildImageSlotSecondaryTemplate(slug)),
            converted: true,
            nativeSecondaryText: null
        };
    const resolvedAnimationTrustTokenText = animationTrustTokenText || '';
    const resolvedSecondaryTrustTokenText =
        animationSecondaryTrustTokenText ||
        animationTrustTokenText ||
        '';

    return {
        templateFiles: {
            animationJsonText,
            animationSecondaryJsonText: imageSlot.secondaryText,
            animationTrustTokenText: resolvedAnimationTrustTokenText,
            animationSecondaryTrustTokenText: resolvedSecondaryTrustTokenText,
            metadataJsonText
        },
        nativeSecondaryText: imageSlot.nativeSecondaryText,
        imageSlot
    };
}

function templateFilesFromPreset(preset) {
    if (!preset?.template_animation_json || !preset?.template_animation_secondary_json) return null;

    return {
        animationJsonText: preset.template_animation_json,
        animationSecondaryJsonText: preset.template_animation_secondary_json,
        animationTrustTokenText: preset.template_animation_trust_token,
        animationSecondaryTrustTokenText: preset.template_animation_secondary_trust_token,
        metadataJsonText: preset.template_metadata_json || ''
    };
}

function getPreset(identifier) {
    const slug = normalizeTitle(identifier);
    if (!slug) return null;
    return db.prepare('SELECT * FROM lottie_presets WHERE slug = ?').get(slug) || null;
}

function listPresets() {
    return db.prepare(`
        SELECT slug, title, file_size, usage_count, created_by, updated_by, created_at, updated_at
        FROM lottie_presets
        ORDER BY title COLLATE NOCASE ASC
    `).all();
}

async function savePreset({ title, wasBuffer, sourceData = null, actor = null }) {
    if (!Buffer.isBuffer(wasBuffer) || wasBuffer.length === 0) {
        throw new Error('Arquivo .was invalido.');
    }

    const trimmedTitle = String(title || '').trim();
    const slug = normalizeTitle(trimmedTitle);
    if (!slug) throw new Error('Titulo invalido para a Lottie.');

    const now = Date.now();
    const fileSha256 = sha256Hex(wasBuffer);
    const sourceJson = sourceData ? JSON.stringify(sourceData) : null;
    const templateResult = await extractAnimationTemplate(slug, wasBuffer);
    const existing = getPreset(slug);

    const values = [
        trimmedTitle,
        wasBuffer.length,
        fileSha256,
        sourceJson,
        wasBuffer,
        templateResult.templateFiles.animationJsonText,
        templateResult.templateFiles.animationSecondaryJsonText,
        templateResult.templateFiles.animationTrustTokenText,
        templateResult.templateFiles.animationSecondaryTrustTokenText,
        templateResult.templateFiles.metadataJsonText,
        templateResult.nativeSecondaryText || '',
        templateResult.imageSlot.converted ? 1 : 0,
        actor,
        now
    ];

    if (existing) {
        db.prepare(`
            UPDATE lottie_presets
            SET title = ?, file_size = ?, file_sha256 = ?, source_json = ?, was_blob = ?,
                template_animation_json = ?, template_animation_secondary_json = ?,
                template_animation_trust_token = ?, template_animation_secondary_trust_token = ?,
                template_metadata_json = ?, template_native_secondary_json = ?, image_slot_applied = ?,
                updated_by = ?, updated_at = ?
            WHERE slug = ?
        `).run(...values, slug);

        return {
            action: 'updated',
            slug,
            title: trimmedTitle,
            fileSize: wasBuffer.length,
            imageSlot: templateResult.imageSlot
        };
    }

    const insertColumns = [
        'slug',
        'title',
        'file_size',
        'file_sha256',
        'source_json',
        'was_blob',
        'template_animation_json',
        'template_animation_secondary_json',
        'template_animation_trust_token',
        'template_animation_secondary_trust_token',
        'template_metadata_json',
        'template_native_secondary_json',
        'image_slot_applied',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
        'usage_count'
    ];

    const insertValues = [
        slug,
        ...values.slice(0, -2),
        actor,
        actor,
        now,
        now,
        0
    ];

    if (hasColumn('file_path')) {
        insertColumns.splice(2, 0, 'file_path');
        insertValues.splice(2, 0, `db:${slug}.was`);
    }

    if (hasColumn('embedded_image_sha256')) {
        insertColumns.splice(insertColumns.indexOf('source_json'), 0, 'embedded_image_sha256');
        insertValues.splice(insertColumns.indexOf('source_json'), 0, null);
    }

    if (hasColumn('embedded_image_path')) {
        insertColumns.splice(insertColumns.indexOf('source_json'), 0, 'embedded_image_path');
        insertValues.splice(insertColumns.indexOf('source_json'), 0, null);
    }

    if (hasColumn('embedded_image_mime')) {
        insertColumns.splice(insertColumns.indexOf('source_json'), 0, 'embedded_image_mime');
        insertValues.splice(insertColumns.indexOf('source_json'), 0, null);
    }

    if (hasColumn('zip_path')) {
        insertColumns.splice(insertColumns.indexOf('created_by'), 0, 'zip_path');
        insertValues.splice(insertColumns.indexOf('created_by'), 0, null);
    }

    if (hasColumn('template_dir')) {
        insertColumns.splice(insertColumns.indexOf('created_by'), 0, 'template_dir');
        insertValues.splice(insertColumns.indexOf('created_by'), 0, null);
    }

    if (hasColumn('storage_mode')) {
        insertColumns.splice(insertColumns.indexOf('created_by'), 0, 'storage_mode');
        insertValues.splice(insertColumns.indexOf('created_by'), 0, 'db');
    }

    if (DEBUG_DB) {
        console.log('[LOTTIE-ZAP][DB][INSERT]', JSON.stringify({
            slug,
            dbPath: DB_PATH,
            hasFilePathColumn: hasColumn('file_path'),
            insertColumns
        }, null, 2));
    }

    db.prepare(`
        INSERT INTO lottie_presets (${insertColumns.join(', ')})
        VALUES (${insertColumns.map(() => '?').join(', ')})
    `).run(...insertValues);

    return {
        action: 'created',
        slug,
        title: trimmedTitle,
        fileSize: wasBuffer.length,
        imageSlot: templateResult.imageSlot
    };
}

function deletePreset(identifier) {
    const preset = getPreset(identifier);
    if (!preset) return { success: false, reason: 'not_found' };
    db.prepare('DELETE FROM lottie_presets WHERE slug = ?').run(preset.slug);
    return { success: true, preset };
}

function incrementUsage(identifier) {
    const slug = normalizeTitle(identifier);
    if (!slug) return;
    db.prepare('UPDATE lottie_presets SET usage_count = usage_count + 1, updated_at = ? WHERE slug = ?')
        .run(Date.now(), slug);
}

function parseSourceJson(sourceJson) {
    if (!sourceJson) return null;
    try {
        return JSON.parse(sourceJson);
    } catch {
        return null;
    }
}

function readPresetBuffer(identifier) {
    const preset = getPreset(identifier);
    if (!preset) return null;

    const buffer = Buffer.isBuffer(preset.was_blob)
        ? preset.was_blob
        : Buffer.from(preset.was_blob || []);

    return {
        preset,
        sourceData: parseSourceJson(preset.source_json),
        templateFiles: templateFilesFromPreset(preset),
        buffer
    };
}

module.exports = {
    DB_PATH,
    normalizeTitle,
    getPreset,
    listPresets,
    savePreset,
    deletePreset,
    incrementUsage,
    readPresetBuffer
};
