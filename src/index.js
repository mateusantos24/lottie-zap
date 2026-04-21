const {
    buildLottieContent,
    extractLottieSource,
    relayLottieSticker
} = require('./lottieSticker');
const {
    buildLottieStickerBufferFromImage,
    extractEmbeddedImageFromLottieBuffer,
    rebuildLottieStickerBuffer,
    sendGeneratedLottieSticker
} = require('./lottieStickerBuilder');
const lottiePresetDB = require('./database/lottiePresetDB');
const lottiCommand = require('./commands/lotti');
const addStickerLottierCommand = require('./commands/addstickerlottier');
const { startBot } = require('./bot');

module.exports = {
    buildLottieContent,
    extractLottieSource,
    relayLottieSticker,
    buildLottieStickerBufferFromImage,
    extractEmbeddedImageFromLottieBuffer,
    rebuildLottieStickerBuffer,
    sendGeneratedLottieSticker,
    lottiePresetDB,
    commands: {
        lotti: lottiCommand,
        addstickerlottier: addStickerLottierCommand
    },
    startBot
};

if (require.main === module) {
    console.log('[LOTTIE-ZAP] INICIOU');
    startBot().catch((error) => {
        console.error('[LOTTIE-ZAP] Falha ao iniciar:', error);
        process.exitCode = 1;
    });
}
