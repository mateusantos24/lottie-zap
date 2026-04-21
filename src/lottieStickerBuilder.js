const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');
const sharp = require('sharp');

const LOTTIE_CANVAS_SIZE = 540;
const LOTTIE_MAX_CANVAS_SIZE = 1920;
const DEFAULT_AUTO_MAX_SIZE = 420;

function normalizeTemplateFiles(templateFiles = null) {
    if (!templateFiles) return null;

    const normalized = {
        animationJsonText: templateFiles.animationJsonText,
        animationSecondaryJsonText: templateFiles.animationSecondaryJsonText,
        animationTrustTokenText: templateFiles.animationTrustTokenText,
        animationSecondaryTrustTokenText: templateFiles.animationSecondaryTrustTokenText
    };

    const missing = Object.entries(normalized)
        .filter(([, value]) => typeof value !== 'string' || value.length === 0)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(`Template Lottie incompleto: ${missing.join(', ')}`);
    }

    return {
        ...normalized,
        metadataJsonText: typeof templateFiles.metadataJsonText === 'string'
            ? templateFiles.metadataJsonText
            : ''
    };
}

function findInjectableImageAsset(animationJson) {
    if (!Array.isArray(animationJson?.assets)) return null;

    return animationJson.assets.find((asset) => (
        typeof asset?.p === 'string' &&
        (
            asset.p.startsWith('data:image/') ||
            asset.id === 'image_0' ||
            /^image[_-]/i.test(String(asset.id || ''))
        )
    )) || null;
}

function setStaticVectorValue(prop, values) {
    if (!prop || typeof prop !== 'object') return;
    if (prop.a === 0 && Array.isArray(prop.k)) prop.k = values;
}

function fitImageLayerToCanvas(animationJson, assetId, canvasWidth, canvasHeight) {
    animationJson.w = canvasWidth;
    animationJson.h = canvasHeight;

    if (!Array.isArray(animationJson.layers)) return;

    const center = [canvasWidth / 2, canvasHeight / 2, 0];
    for (const layer of animationJson.layers) {
        if (layer?.ty !== 2 || layer.refId !== assetId) continue;
        setStaticVectorValue(layer.ks?.p, center);
        setStaticVectorValue(layer.ks?.a, center);
    }
}

function normalizeImageMime(imageMime) {
    const mime = String(imageMime || '').trim().toLowerCase();
    if (mime.startsWith('image/')) return mime;
    return 'image/png';
}

function parseDataUriImage(dataUri) {
    const text = String(dataUri || '').trim();
    const match = text.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return null;

    return {
        mime: normalizeImageMime(match[1]),
        buffer: Buffer.from(match[2], 'base64')
    };
}

function normalizeEmojis(emojis) {
    if (Array.isArray(emojis)) {
        const items = emojis.map((emoji) => String(emoji || '').trim()).filter(Boolean);
        return items.length > 0 ? items : ['😀'];
    }

    const text = String(emojis || '').trim();
    return text ? [text] : ['😀'];
}

function clampSize(value, fallback, max = LOTTIE_MAX_CANVAS_SIZE) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(64, Math.min(max, Math.round(parsed)));
}

async function prepareEmbeddedImage({ imageBuffer, maxWidth = DEFAULT_AUTO_MAX_SIZE, maxHeight = DEFAULT_AUTO_MAX_SIZE }) {
    const width = clampSize(maxWidth, DEFAULT_AUTO_MAX_SIZE);
    const height = clampSize(maxHeight, DEFAULT_AUTO_MAX_SIZE);
    const canvasWidth = Math.max(LOTTIE_CANVAS_SIZE, width);
    const canvasHeight = Math.max(LOTTIE_CANVAS_SIZE, height);

    const image = sharp(imageBuffer, { animated: false, failOn: 'none' }).rotate();
    const fittedBuffer = await image
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    const composed = sharp({
        create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).composite([{ input: fittedBuffer, gravity: 'center' }]);

    return {
        buffer: await composed.png().toBuffer(),
        mime: 'image/png',
        width,
        height,
        canvasWidth,
        canvasHeight
    };
}

function buildOverriddenMetadata({ packName, publisher, packId, accessibilityText, emojis }) {
    const randomId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return {
        'sticker-pack-id': packId || `lottie-zap-${randomId}`,
        'sticker-pack-name': packName || 'Lottie Zap',
        'sticker-pack-publisher': publisher || '',
        'accessibility-text': accessibilityText || 'Animated sticker generated with lottie-zap.',
        emojis: normalizeEmojis(emojis),
        'is-from-user-created-pack': 1
    };
}

async function buildLottieStickerBufferFromImage({
    imageBuffer,
    imageMime,
    maxWidth,
    maxHeight,
    packName,
    publisher,
    packId,
    accessibilityText,
    emojis,
    templateFiles,
    templateName = null
}) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        throw new Error('Imagem invalida para criar figurinha Lottie.');
    }

    const templateSources = normalizeTemplateFiles(templateFiles);
    if (!templateSources) {
        throw new Error('Template Lottie nao informado. Salve uma Lottie primeiro com /addstickerlottier.');
    }

    const preparedImage = await prepareEmbeddedImage({ imageBuffer, imageMime, maxWidth, maxHeight });
    const imageBase64 = `data:${normalizeImageMime(preparedImage.mime)};base64,${preparedImage.buffer.toString('base64')}`;
    const animationSecondaryJson = JSON.parse(templateSources.animationSecondaryJsonText);

    const injectableAsset = findInjectableImageAsset(animationSecondaryJson);
    if (!injectableAsset) {
        throw new Error(`Template ${templateName || 'default'} nao possui slot de imagem.`);
    }

    injectableAsset.p = imageBase64;
    injectableAsset.u = '';
    injectableAsset.w = preparedImage.canvasWidth;
    injectableAsset.h = preparedImage.canvasHeight;
    fitImageLayerToCanvas(animationSecondaryJson, injectableAsset.id, preparedImage.canvasWidth, preparedImage.canvasHeight);

    const zip = new JSZip();
    zip.file('animation/animation.json', templateSources.animationJsonText);
    zip.file('animation/animation_secondary.json', JSON.stringify(animationSecondaryJson));
    zip.file(
        'animation/animation.json.overridden_metadata',
        JSON.stringify(buildOverriddenMetadata({ packName, publisher, packId, accessibilityText, emojis }))
    );
    zip.file('animation/animation.json.trust_token', templateSources.animationTrustTokenText);
    zip.file('animation/animation_secondary.json.trust_token', templateSources.animationSecondaryTrustTokenText);

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function rebuildLottieStickerBuffer({ wasBuffer, packName, publisher, packId, accessibilityText, emojis }) {
    if (!Buffer.isBuffer(wasBuffer) || wasBuffer.length === 0) {
        throw new Error('Sticker Lottie invalido.');
    }

    const zip = await JSZip.loadAsync(wasBuffer);
    const metadataFile = zip.file('animation/animation.json.overridden_metadata');
    let currentMetadata = {};

    if (metadataFile) {
        try {
            currentMetadata = JSON.parse(await metadataFile.async('string'));
        } catch {
            currentMetadata = {};
        }
    }

    zip.file(
        'animation/animation.json.overridden_metadata',
        JSON.stringify({
            ...currentMetadata,
            ...buildOverriddenMetadata({
                packName: packName ?? currentMetadata['sticker-pack-name'],
                publisher: publisher ?? currentMetadata['sticker-pack-publisher'],
                packId: packId ?? currentMetadata['sticker-pack-id'],
                accessibilityText: accessibilityText ?? currentMetadata['accessibility-text'],
                emojis: emojis ?? currentMetadata.emojis
            })
        })
    );

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function extractEmbeddedImageFromLottieBuffer(wasBuffer) {
    if (!Buffer.isBuffer(wasBuffer) || wasBuffer.length === 0) {
        throw new Error('Sticker Lottie invalido.');
    }

    const zip = await JSZip.loadAsync(wasBuffer);
    const secondaryFile = zip.file('animation/animation_secondary.json') || zip.file('animation_secondary.json');
    if (!secondaryFile) throw new Error('Nao encontrei animation_secondary.json dentro da Lottie.');

    let parsed;
    try {
        parsed = JSON.parse(await secondaryFile.async('string'));
    } catch {
        throw new Error('Nao consegui ler o JSON interno da Lottie.');
    }

    const asset = Array.isArray(parsed?.assets)
        ? parsed.assets.find((item) => typeof item?.p === 'string' && item.p.startsWith('data:image/'))
        : null;

    if (!asset?.p) throw new Error('Essa Lottie nao possui imagem embutida em base64.');

    const decoded = parseDataUriImage(asset.p);
    if (!decoded?.buffer) throw new Error('Nao consegui extrair a imagem da Lottie.');
    return decoded;
}

async function sendGeneratedLottieSticker(sock, jid, lottieStickerBuffer, quoted, baileys, options = {}) {
    const premium = Number.isFinite(Number(options.premium))
        ? Math.max(0, Math.min(2, Math.round(Number(options.premium))))
        : 0;

    if (!sock?.relayMessage || typeof sock.waUploadToServer !== 'function') {
        throw new Error('Socket nao suporta envio de figurinha Lottie.');
    }
    if (!baileys?.prepareWAMessageMedia || !baileys?.generateWAMessageFromContent) {
        throw new Error('Baileys com prepareWAMessageMedia/generateWAMessageFromContent e obrigatorio.');
    }

    const prepared = await baileys.prepareWAMessageMedia(
        {
            sticker: lottieStickerBuffer,
            mimetype: 'application/was',
            isAnimated: true,
            isLottie: true
        },
        {
            upload: sock.waUploadToServer,
            mediaTypeOverride: 'sticker'
        }
    );

    const waMessage = baileys.generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32).toString('base64')
            },
            lottieStickerMessage: {
                message: {
                    stickerMessage: {
                        ...prepared.stickerMessage,
                        mimetype: 'application/was',
                        isAnimated: true,
                        isLottie: true,
                        isAvatar: false,
                        isAiSticker: false,
                        premium,
                        stickerSentTs: Date.now().toString()
                    }
                }
            }
        },
        { userJid: sock.user?.id, quoted }
    );

    await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
}

module.exports = {
    buildLottieStickerBufferFromImage,
    extractEmbeddedImageFromLottieBuffer,
    rebuildLottieStickerBuffer,
    sendGeneratedLottieSticker,
    DEFAULT_AUTO_MAX_SIZE,
    LOTTIE_CANVAS_SIZE,
    LOTTIE_MAX_CANVAS_SIZE
};
