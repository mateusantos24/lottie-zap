const {
    default: makeWASocket,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const lottiCommand = require('./commands/lotti');
const addStickerLottierCommand = require('./commands/addstickerlottier');

const DEFAULT_PREFIX = '/';
const SESSION_DIR = process.env.LOTTIE_ZAP_SESSION || 'auth';
const APP_NAME = 'Megumin Lottie Zap';
const APP_VERSION = 'beta-1';

function withTimeout(promise, ms, fallback) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function unwrapMessage(node) {
    let current = node;
    while (current?.message) current = current.message;
    while (current?.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    while (current?.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    while (current?.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    while (current?.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    while (current?.imageWithCaptionMessage?.message) current = current.imageWithCaptionMessage.message;
    while (current?.videoWithCaptionMessage?.message) current = current.videoWithCaptionMessage.message;
    return current || {};
}

function extractTextFromContent(content = {}) {
    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        ''
    );
}

function getContextInfo(content = {}) {
    return (
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        content.audioMessage?.contextInfo ||
        content.stickerMessage?.contextInfo ||
        content.lottieStickerMessage?.message?.stickerMessage?.contextInfo ||
        null
    );
}

function findMedia(content = {}) {
    const lottieSticker = content.lottieStickerMessage?.message?.stickerMessage || null;
    if (lottieSticker) return { mediaNode: lottieSticker, nodeKey: 'lottieStickerMessage', type: 'sticker' };
    if (content.stickerMessage) return { mediaNode: content.stickerMessage, nodeKey: 'stickerMessage', type: 'sticker' };
    if (content.imageMessage) return { mediaNode: content.imageMessage, nodeKey: 'imageMessage', type: 'image' };
    if (content.videoMessage) return { mediaNode: content.videoMessage, nodeKey: 'videoMessage', type: 'video' };
    if (content.documentMessage) return { mediaNode: content.documentMessage, nodeKey: 'documentMessage', type: 'document' };
    if (content.audioMessage) return { mediaNode: content.audioMessage, nodeKey: 'audioMessage', type: 'audio' };
    return null;
}

function buildMediaContainer(key, mediaInfo) {
    if (mediaInfo.nodeKey === 'lottieStickerMessage') {
        return {
            key,
            message: {
                lottieStickerMessage: {
                    message: {
                        stickerMessage: mediaInfo.mediaNode
                    }
                }
            }
        };
    }

    return {
        key,
        message: {
            [mediaInfo.nodeKey]: mediaInfo.mediaNode
        }
    };
}

async function downloadMedia(sock, container) {
    const buffer = await downloadMediaMessage(
        container,
        'buffer',
        {},
        {
            reuploadRequest: sock.updateMediaMessage
                ? sock.updateMediaMessage.bind(sock)
                : undefined
        }
    );
    return Buffer.isBuffer(buffer) ? buffer : null;
}

async function extractCurrentMedia(sock, message, content) {
    const mediaInfo = findMedia(content);
    if (!mediaInfo) return null;

    const container = buildMediaContainer(message.key, mediaInfo);
    const buffer = await downloadMedia(sock, container).catch(() => null);
    if (!buffer) return null;

    return {
        buffer,
        type: mediaInfo.type,
        mimetype: mediaInfo.mediaNode.mimetype || '',
        isLottie: Boolean(mediaInfo.mediaNode.isLottie || /application\/was/i.test(mediaInfo.mediaNode.mimetype || '')),
        fileName: mediaInfo.mediaNode.fileName || null
    };
}

async function extractQuotedMedia(sock, message, content) {
    const contextInfo = getContextInfo(content);
    if (!contextInfo?.quotedMessage) return null;

    const quotedContent = unwrapMessage(contextInfo.quotedMessage);
    const mediaInfo = findMedia(quotedContent);
    if (!mediaInfo) return null;

    const quotedKeyBase = {
        remoteJid: message.key.remoteJid,
        id: contextInfo.stanzaId || contextInfo.quotedStanzaId,
        fromMe: false
    };

    if (contextInfo.participant) quotedKeyBase.participant = contextInfo.participant;
    if (!quotedKeyBase.id) return null;

    const candidates = [
        quotedKeyBase,
        { ...quotedKeyBase, fromMe: true }
    ];

    for (const key of candidates) {
        const container = buildMediaContainer(key, mediaInfo);
        const buffer = await downloadMedia(sock, container).catch(() => null);
        if (buffer) {
            return {
                buffer,
                type: mediaInfo.type,
                mimetype: mediaInfo.mediaNode.mimetype || '',
                isLottie: Boolean(mediaInfo.mediaNode.isLottie || /application\/was/i.test(mediaInfo.mediaNode.mimetype || '')),
                fileName: mediaInfo.mediaNode.fileName || null
            };
        }
    }

    return null;
}

async function buildMessageData(sock, message, baileys) {
    const content = unwrapMessage(message.message || {});
    const contextInfo = getContextInfo(content);
    const decryptedMedia =
        await extractCurrentMedia(sock, message, content) ||
        await extractQuotedMedia(sock, message, content);

    return {
        from: message.key.remoteJid,
        sender: message.key.participant || message.key.remoteJid,
        participantLid: message.key.participant || message.key.remoteJid,
        pushName: message.pushName || '',
        quoteThis: message,
        message,
        quotedMessage: contextInfo?.quotedMessage || null,
        prefix: process.env.LOTTIE_ZAP_PREFIX || DEFAULT_PREFIX,
        decryptedMedia,
        baileys
    };
}

function createCommandMap() {
    const map = new Map();
    for (const command of [lottiCommand, addStickerLottierCommand]) {
        map.set(command.name, command);
        for (const alias of command.aliases || []) {
            map.set(alias, command);
        }
    }
    return map;
}

async function handleMessage(sock, message, baileys, commands) {
    if (!message?.message || message.key?.remoteJid === 'status@broadcast') return;
    if (message.key?.fromMe && process.env.LOTTIE_ZAP_SELF !== 'true') return;

    const content = unwrapMessage(message.message);
    const text = extractTextFromContent(content).trim();
    const prefix = process.env.LOTTIE_ZAP_PREFIX || DEFAULT_PREFIX;
    if (!text.startsWith(prefix)) return;

    const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
    const commandName = String(rawCommand || '').toLowerCase();
    const command = commands.get(commandName);
    if (!command) return;

    const messageData = await buildMessageData(sock, message, baileys);
    await command.execute(sock, messageData, args, { baileys });
}

async function startBot() {
    const baileys = require('@whiskeysockets/baileys');
    console.log('[LOTTIE-ZAP] Carregando sessao:', SESSION_DIR);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    console.log('[LOTTIE-ZAP] Buscando versao do Baileys...');
    const { version } = await withTimeout(
        fetchLatestBaileysVersion().catch(() => ({ version: undefined })),
        5000,
        { version: undefined }
    );
    const commands = createCommandMap();

    console.log('[LOTTIE-ZAP] Criando socket. Aguarde o QR code se ainda nao houver sessao.');
    const sock = makeWASocket({
        auth: state,
        version,
        browser: [APP_NAME, 'Chrome', APP_VERSION],
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('[LOTTIE-ZAP] Escaneie o QR code abaixo.');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') console.log('[LOTTIE-ZAP] Bot conectado.');
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[LOTTIE-ZAP] Conexao fechada. Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(() => {
                    startBot().catch((error) => console.error('[LOTTIE-ZAP] Reconnect falhou:', error));
                }, 3000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const message of messages || []) {
            try {
                await handleMessage(sock, message, baileys, commands);
            } catch (error) {
                console.error('[LOTTIE-ZAP] Erro no comando:', error);
                const jid = message?.key?.remoteJid;
                if (jid) {
                    await sock.sendMessage(jid, {
                        text: `Erro no comando Lottie: ${error.message || error}`
                    }, { quoted: message }).catch(() => null);
                }
            }
        }
    });

    console.log('[LOTTIE-ZAP] Bot iniciado. Prefixo:', process.env.LOTTIE_ZAP_PREFIX || DEFAULT_PREFIX);
    return sock;
}

module.exports = {
    startBot
};
