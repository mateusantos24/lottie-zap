const baileys = require('@whiskeysockets/baileys');
const { commands } = require('../src');

function registerLottieZap(commandHandler) {
    commandHandler.register({
        ...commands.lotti,
        async execute(sock, messageData, args) {
            return commands.lotti.execute(sock, { ...messageData, baileys }, args, { baileys });
        }
    });

    commandHandler.register({
        ...commands.addstickerlottier,
        async execute(sock, messageData, args) {
            return commands.addstickerlottier.execute(sock, messageData, args);
        }
    });
}

module.exports = {
    registerLottieZap
};
