const sharp = require('sharp');
const { relayLottieSticker } = require('../lottieSticker');
const {
    buildLottieStickerBufferFromImage,
    extractEmbeddedImageFromLottieBuffer,
    rebuildLottieStickerBuffer,
    sendGeneratedLottieSticker,
    DEFAULT_AUTO_MAX_SIZE,
    LOTTIE_MAX_CANVAS_SIZE
} = require('../lottieStickerBuilder');
const {
    listPresets,
    readPresetBuffer,
    incrementUsage
} = require('../database/lottiePresetDB');

function randomEmoji() {
    const emojis = ['😀', '😎', '🥳', '🤖', '💥', '🔥', '✨', '💫', '🎉', '😺'];
    return [emojis[Math.floor(Math.random() * emojis.length)]];
}

function resolveModeToken(value) {
    const token = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (['original', 'orig', 'nativo', 'nativa', 'base', 'salva', 'saved'].includes(token)) return 'native';
    if (['animacao', 'animation', 'template', 'trocar', 'imagem', 'image', 'img'].includes(token)) return 'template';
    return null;
}

function parseInlineOverrides(tokens = []) {
    const raw = tokens.join(' ').trim();
    if (!raw) return {};
    const parts = raw.split('/').map((item) => item.trim()).filter(Boolean);
    return {
        pack: parts[0]?.slice(0, 64),
        publisher: parts[1]?.slice(0, 64)
    };
}

function parseOptions(args = []) {
    const tokens = Array.isArray(args) ? [...args] : [];
    const options = {
        maxWidth: DEFAULT_AUTO_MAX_SIZE,
        maxHeight: DEFAULT_AUTO_MAX_SIZE,
        presetName: null,
        outputMode: 'auto',
        metadataTokens: []
    };

    const consumeSize = () => {
        if (/^\d+x\d+$/i.test(tokens[0] || '')) {
            const [w, h] = tokens.shift().toLowerCase().split('x').map(Number);
            options.maxWidth = w;
            options.maxHeight = h;
            return true;
        }
        if (/^\d+$/.test(tokens[0] || '') && /^\d+$/.test(tokens[1] || '')) {
            options.maxWidth = Number(tokens.shift());
            options.maxHeight = Number(tokens.shift());
            return true;
        }
        if (/^\d+$/.test(tokens[0] || '')) {
            options.maxWidth = Number(tokens.shift());
            options.maxHeight = options.maxWidth;
            return true;
        }
        return false;
    };

    const first = String(tokens[0] || '').trim();
    const modeFirst = resolveModeToken(first);
    if (modeFirst) {
        options.outputMode = modeFirst;
        tokens.shift();
    }

    consumeSize();

    const possiblePreset = String(tokens[0] || '').trim();
    if (possiblePreset && readPresetBuffer(possiblePreset)) {
        options.presetName = tokens.shift();
    }

    consumeSize();

    const modeAfterPreset = resolveModeToken(tokens[0]);
    if (modeAfterPreset) {
        options.outputMode = modeAfterPreset;
        tokens.shift();
    }

    consumeSize();

    options.metadataTokens = tokens;
    return options;
}

function formatPresetList(prefix) {
    const presets = listPresets();
    if (!presets.length) {
        return [
            '*LOTTI*',
            '',
            'Nenhuma Lottie salva no banco ainda.',
            '',
            `Salve uma base respondendo uma Lottie com:`,
            `${prefix}addstickerlottier nome`
        ].join('\n');
    }

    const lines = presets.map((item, index) => {
        const sizeKb = (Number(item.file_size || 0) / 1024).toFixed(1);
        return `${index + 1}. ${item.title} - ${item.slug} (${sizeKb} KB)`;
    });

    return [
        '*LOTTI*',
        '',
        ...lines,
        '',
        `Enviar original: ${prefix}lotti <slug> original`,
        `Trocar imagem: responda uma imagem com ${prefix}lotti <slug> animacao`,
        `Criar com primeira base salva: responda imagem com ${prefix}lotti`
    ].join('\n');
}

function getMedia(messageData = {}) {
    return messageData.decryptedMedia || null;
}

async function mediaToImageSource(media) {
    if (!media?.buffer || !Buffer.isBuffer(media.buffer)) {
        throw new Error('Responda uma imagem, figurinha ou Lottie.');
    }

    if (media.isLottie || /application\/was/i.test(media.mimetype || '')) {
        const extracted = await extractEmbeddedImageFromLottieBuffer(media.buffer);
        return {
            imageBuffer: extracted.buffer,
            imageMime: extracted.mime
        };
    }

    if (media.type === 'image' || /^image\//i.test(media.mimetype || '') || media.type === 'sticker' || /image\/webp/i.test(media.mimetype || '')) {
        return {
            imageBuffer: await sharp(media.buffer, { animated: false, failOn: 'none' }).png().toBuffer(),
            imageMime: 'image/png'
        };
    }

    throw new Error('Tipo de midia nao suportado. Use imagem, WebP ou Lottie.');
}

async function sendSavedOriginal(sock, jid, quoted, resolved, baileys, finalSettings) {
    if (resolved.sourceData) {
        await relayLottieSticker(sock, jid, resolved.sourceData, baileys, quoted);
        incrementUsage(resolved.preset.slug);
        return;
    }

    const rebuilt = await rebuildLottieStickerBuffer({
        wasBuffer: resolved.buffer,
        packName: finalSettings.pack,
        publisher: finalSettings.publisher,
        packId: finalSettings.id,
        emojis: finalSettings.emojis,
        accessibilityText: `Figurinha Lottie ${resolved.preset.title}`
    });

    await sendGeneratedLottieSticker(sock, jid, rebuilt, quoted, baileys);
    incrementUsage(resolved.preset.slug);
}

async function execute(sock, messageData, args = [], options = {}) {
    const { from, quoteThis, prefix = '/', pushName } = messageData;
    const baileys = options.baileys || messageData.baileys;

    if (!baileys) {
        throw new Error('Passe o objeto do Baileys em options.baileys ou messageData.baileys.');
    }

    const wantsHelp = !args.length || ['help', 'ajuda', '?', 'list', 'lista'].includes(String(args[0] || '').toLowerCase());
    if (wantsHelp) {
        return sock.sendMessage(from, { text: formatPresetList(prefix) }, { quoted: quoteThis });
    }

    const parsed = parseOptions(args);
    const presets = listPresets();
    const resolved = parsed.presetName
        ? readPresetBuffer(parsed.presetName)
        : (presets[0] ? readPresetBuffer(presets[0].slug) : null);

    if (!resolved) {
        return sock.sendMessage(from, {
            text: `Nenhuma Lottie base encontrada. Responda uma Lottie e use ${prefix}addstickerlottier nome.`
        }, { quoted: quoteThis });
    }

    const inline = parseInlineOverrides(parsed.metadataTokens);
    const finalSettings = {
        pack: inline.pack ?? options.packName ?? 'Lottie Zap',
        publisher: inline.publisher ?? options.publisher ?? '',
        id: options.packId ?? 'com.lottie-zap.stickers',
        emojis: options.emojis ?? randomEmoji()
    };

    try {
        const media = getMedia(messageData);
        const shouldSendOriginal = parsed.outputMode === 'native' || (!media?.buffer && parsed.presetName);

        if (shouldSendOriginal) {
            await sendSavedOriginal(sock, from, quoteThis, resolved, baileys, finalSettings);
            return;
        }

        if (!media?.buffer && parsed.outputMode === 'template') {
            return sock.sendMessage(from, {
                text: `Modo animacao escolhido. Responda uma imagem e use ${prefix}lotti ${resolved.preset.slug} animacao.`
            }, { quoted: quoteThis });
        }

        const source = await mediaToImageSource(media);
        const lottieStickerBuffer = await buildLottieStickerBufferFromImage({
            imageBuffer: source.imageBuffer,
            imageMime: source.imageMime,
            maxWidth: parsed.maxWidth,
            maxHeight: parsed.maxHeight,
            packName: finalSettings.pack,
            publisher: finalSettings.publisher,
            packId: finalSettings.id,
            emojis: finalSettings.emojis,
            accessibilityText: `Figurinha animada criada para ${pushName || 'usuario'}`,
            templateFiles: resolved.templateFiles,
            templateName: resolved.preset.title
        });

        await sendGeneratedLottieSticker(sock, from, lottieStickerBuffer, quoteThis, baileys);
        incrementUsage(resolved.preset.slug);
    } catch (error) {
        return sock.sendMessage(from, {
            text: `Nao consegui criar a figurinha Lottie. ${error.message}`
        }, { quoted: quoteThis });
    }
}

module.exports = {
    name: 'lotti',
    description: 'Cria figurinha animada Lottie a partir de uma imagem usando bases salvas no banco.',
    aliases: ['lottie', 'figlottie', 'lottier'],
    execute,
    LOTTIE_MAX_CANVAS_SIZE
};
