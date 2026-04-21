const {
    extractEmbeddedImageFromLottieBuffer
} = require('../lottieStickerBuilder');
const {
    extractLottieSource
} = require('../lottieSticker');
const {
    savePreset,
    listPresets,
    deletePreset
} = require('../database/lottiePresetDB');

function isLottieMedia(media) {
    return !!(
        media?.buffer &&
        (
            media?.isLottie ||
            /application\/was/i.test(media?.mimetype || '') ||
            (media?.type === 'sticker' && /application\/was/i.test(media?.mimetype || ''))
        )
    );
}

function formatPresetList(prefix) {
    const presets = listPresets();
    if (!presets.length) {
        return [
            '*STICKER LOTTIER*',
            '',
            'Nenhuma Lottie salva ainda.',
            '',
            `Use ${prefix}addstickerlottier <titulo> respondendo uma Lottie.`
        ].join('\n');
    }

    const lines = presets.map((item, index) => {
        const sizeKb = (Number(item.file_size || 0) / 1024).toFixed(1);
        return `${index + 1}. ${item.title} (${item.slug}) - ${sizeKb} KB`;
    });

    return `*STICKER LOTTIER*\n\n${lines.join('\n')}`;
}

async function execute(sock, messageData, args = []) {
    const { from, quoteThis, prefix = '/', participantLid } = messageData;
    const action = String(args[0] || '').toLowerCase();

    if (!args.length || ['list', 'lista', 'help', 'ajuda'].includes(action)) {
        return sock.sendMessage(from, {
            text: `${formatPresetList(prefix)}\n\nExemplo:\n${prefix}addstickerlottier choro`
        }, { quoted: quoteThis });
    }

    if (['del', 'delete', 'remover', 'remove'].includes(action)) {
        const target = args.slice(1).join(' ').trim();
        const result = deletePreset(target);
        return sock.sendMessage(from, {
            text: result.success
                ? `Lottie removida: ${result.preset.title} (${result.preset.slug})`
                : 'Lottie nao encontrada.'
        }, { quoted: quoteThis });
    }

    const title = args.join(' ').trim();
    const media = messageData.decryptedMedia || null;

    if (!isLottieMedia(media)) {
        return sock.sendMessage(from, {
            text: `Responda uma figurinha Lottie (.was) e use:\n${prefix}addstickerlottier ${title}`
        }, { quoted: quoteThis });
    }

    try {
        try {
            await extractEmbeddedImageFromLottieBuffer(media.buffer);
        } catch {
            // The preset can still be saved as native/original. The DB will create a template slot if needed.
        }

        const source = extractLottieSource(messageData.quotedMessage || messageData.message || messageData);
        const result = await savePreset({
            title,
            wasBuffer: media.buffer,
            sourceData: source?.sticker || null,
            actor: participantLid || 'owner'
        });

        return sock.sendMessage(from, {
            text: [
                `*LOTTIE ${result.action === 'created' ? 'SALVA' : 'ATUALIZADA'}*`,
                '',
                `Titulo: ${result.title}`,
                `Slug: ${result.slug}`,
                `Banco: SQLite`,
                `Tamanho: ${(Number(result.fileSize || 0) / 1024).toFixed(1)} KB`,
                `Image slot: ${result.imageSlot?.converted ? 'criado' : 'ja existia'}`,
                '',
                `Uso: ${prefix}lotti ${result.slug} original`,
                `Trocar imagem: responda imagem com ${prefix}lotti ${result.slug} animacao`
            ].join('\n')
        }, { quoted: quoteThis });
    } catch (error) {
        return sock.sendMessage(from, {
            text: `Nao consegui salvar a Lottie. ${error.message}`
        }, { quoted: quoteThis });
    }
}

module.exports = {
    name: 'addstickerlottier',
    description: 'Salva/atualiza uma base Lottie no banco SQLite.',
    aliases: ['setstickerlottier', 'addlottier', 'setlottier'],
    execute
};
