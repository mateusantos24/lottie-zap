<p align="center">
  <img src="https://cdn.nexray.web.id/2zesyama.jpg" alt="Megumin cover" width="100%" />
</p>

<p align="center">
  <img src="./assets/megumin-logo.svg" alt="Megumin Lottie Zap logo" width="168" />
</p>

# Megumin Lottie Zap

**Release:** `1.0.0-beta.1`

<p align="center">
  <img alt="release" src="https://img.shields.io/badge/release-beta.1-8b5cf6?style=for-the-badge" />
  <img alt="database" src="https://img.shields.io/badge/database-sqlite-f59e0b?style=for-the-badge" />
  <img alt="engine" src="https://img.shields.io/badge/engine-baileys-22c55e?style=for-the-badge" />
</p>

Projeto por **Rei Ayanami**.

Comandos para criar, salvar e reenviar **figurinhas Lottie animadas no WhatsApp MD** usando Baileys.

O foco do projeto e o fluxo de bot:

```txt
/addstickerlottier nome
/lotti nome original
/lotti nome animacao
```

Ou seja: salvar uma Lottie base no banco e usar essa base para reenviar a Lottie original ou criar uma nova Lottie animada trocando a imagem interna.

## Estado atual

Atualmente o caminho mais confiavel e:

```txt
/addstickerlottier nome
/lotti nome original
```

Em clientes recentes, reconstruir/modificar a animacao pode falhar por verificacao de integridade da Lottie. Por isso:

- `original` continua sendo o modo recomendado
- `animacao`/rebuild ficou **experimental**
- para liberar rebuild manualmente, use:

```bash
LOTTIE_ZAP_ALLOW_REBUILD=true npm start
```

## Creditos

- Projeto: **Rei Ayanami**
- Branding: **Megumin**
- Repo: **lottie-zap**

## Release

- Canal atual: **Beta**
- Versao atual: **v1.0.0-beta.1**
- Notas: [RELEASE_NOTES.md](RELEASE_NOTES.md)

## O que tem aqui

```txt
src/commands/lotti.js
src/commands/addstickerlottier.js
src/database/lottiePresetDB.js
src/lottieSticker.js
src/lottieStickerBuilder.js
examples/register-commands.js
```

## Instalar

```bash
npm install
```

## Iniciar como bot

Agora o repo tambem pode rodar direto como bot:

```bash
npm start
```

ou:

```bash
node src/index.js
```

Na primeira execucao, o Baileys mostra o QR code no terminal. Escaneie no WhatsApp e depois use:

```txt
/addstickerlottier choro
/lotti choro original
/lotti choro animacao
```

A sessao fica em:

```txt
auth/
```

Variaveis opcionais:

```bash
LOTTIE_ZAP_PREFIX=/
LOTTIE_ZAP_SESSION=auth
LOTTIE_ZAP_DATA_DIR=./data
LOTTIE_ZAP_DB=./data/lottiepresets.db
```

Dependencias principais:

```txt
better-sqlite3 - banco dos presets
jszip - leitura/escrita do .was
sharp - conversao da imagem para PNG
@whiskeysockets/baileys - conexao WhatsApp MD
```

## Como funciona

1. Responda uma figurinha Lottie `.was`.
2. Use `/addstickerlottier nome`.
3. A Lottie e salva no SQLite.
4. Use `/lotti nome original` para reenviar a original.
5. Responda uma imagem e use `/lotti nome animacao` para trocar a imagem interna mantendo a animacao.

Observacao: esse rebuild pode nao renderizar em clientes que validam a integridade da animacao.

## Comando: addstickerlottier

Salva ou atualiza uma Lottie base no banco.

```txt
/addstickerlottier choro
/addstickerlottier grita
/addstickerlottier list
/addstickerlottier del choro
```

Uso normal:

```txt
responda uma figurinha Lottie com /addstickerlottier choro
```

O banco fica em:

```txt
data/lottiepresets.db
```

Voce pode mudar o caminho com variaveis de ambiente:

```bash
LOTTIE_ZAP_DATA_DIR=./data
LOTTIE_ZAP_DB=./data/lottiepresets.db
```

## Comando: lotti

Lista as Lotties salvas:

```txt
/lotti
/lotti list
```

Reenvia a Lottie original:

```txt
/lotti choro original
/lotti grita nativo
```

Cria uma nova Lottie com uma imagem respondida:

```txt
responda uma imagem com /lotti choro animacao
responda uma imagem com /lotti grita 512 animacao
responda uma imagem com /lotti grita 512 512 animacao
responda uma imagem com /lotti grita 512x512 animacao
```

Por padrao, esse modo experimental fica bloqueado. Para testar mesmo assim:

```bash
LOTTIE_ZAP_ALLOW_REBUILD=true npm start
```

Tambem da para trocar pack/publisher inline:

```txt
/lotti grita animacao Meu Pack / Meu Nome
```

## Registrar no seu bot

Exemplo simples em [`examples/register-commands.js`](examples/register-commands.js):

```js
const baileys = require('@whiskeysockets/baileys');
const { commands } = require('lottie-zap');

commandHandler.register({
  ...commands.lotti,
  async execute(sock, messageData, args) {
    return commands.lotti.execute(sock, { ...messageData, baileys }, args, { baileys });
  }
});

commandHandler.register(commands.addstickerlottier);
```

O `messageData` precisa ter:

```txt
from
quoteThis
prefix
decryptedMedia.buffer
decryptedMedia.mimetype
decryptedMedia.type
decryptedMedia.isLottie
```

Esse formato combina com bots que ja extraem midia antes de chamar o comando.

## Reenvio Lottie nativo

O envio original usa:

```txt
lottieStickerMessage.message.stickerMessage
```

e monta o payload com:

```txt
mimetype: application/was
isAnimated: true
isLottie: true
```

## Criacao com template

Quando uma Lottie e salva no banco, o projeto extrai:

```txt
animation/animation.json
animation/animation_secondary.json
animation/animation.json.trust_token
animation/animation_secondary.json.trust_token
```

Se a Lottie nao tiver slot de imagem, o banco cria um `animation_secondary.json` com slot `image_0`, permitindo usar a base como template para `/lotti nome animacao`.

## Checar sintaxe

```bash
npm run check
```

## Aviso

Use para criar figurinhas animadas, relay original, compatibilidade e pesquisa defensiva. Nao use para travar cliente, floodar grupos ou abusar do WhatsApp.

Reconstrucao de animacao Lottie pode falhar em clientes recentes por verificacao de integridade do payload.

## Licenca

MIT
