const fs = require('node:fs/promises');
const path = require('node:path');
const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const channelTitle = 'Canal de Vídeos para Afiliados ✨';
const dataDir = path.join(__dirname, 'dados');
const sessionPath = path.join(dataDir, 'session');
const registryPath = path.join(dataDir, 'baixados.json');

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function writeAtomic(file, contents) {
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function findChannel(client, channelId) {
  let match;
  for await (const dialog of client.iterDialogs({})) {
    if (!(dialog.entity instanceof Api.Channel)) continue;
    if (channelId ? dialog.entity.id.toString() !== channelId : dialog.title !== channelTitle) continue;
    if (match) throw new Error('Há canais com o mesmo título. Configure channelId em env.json.');
    match = dialog.entity;
    if (channelId) break;
  }
  if (!match) throw new Error('Canal não encontrado nas conversas da conta autenticada.');
  return match;
}

async function hasExpectedSize(file, document) {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return stat.isFile() && stat.size === BigInt(document.size.toString());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function syncVideos(client, config) {
  const stored = await readOptional(registryPath);
  const registry = stored === null ? null : JSON.parse(stored);
  const channel = await findChannel(client, config.channelId ?? registry?.channelId);
  const channelId = channel.id.toString();
  if (registry && (registry.channelId !== channelId || !registry.baixados || Array.isArray(registry.baixados) || typeof registry.baixados !== 'object')) {
    throw new Error('O registro baixados.json é inválido ou pertence a outro canal.');
  }
  if (channel.noforwards) throw new Error('O canal restringe o salvamento de conteúdo.');

  const state = registry ?? { channelId, baixados: {} };
  const saveRegistry = () => writeAtomic(registryPath, JSON.stringify(state, null, 2) + '\n');
  const videosDir = path.join(dataDir, 'videos');
  await fs.mkdir(videosDir, { recursive: true, mode: 0o700 });
  if (!registry) await saveRegistry();

  let downloaded = 0;
  let skipped = 0;
  let failures = 0;
  for await (const message of client.iterMessages(channel, {})) {
    const document = message.document;
    if (!(document instanceof Api.Document)) continue;
    if (!document.mimeType.startsWith('video/') &&
        !document.attributes.some(attribute => attribute instanceof Api.DocumentAttributeVideo)) continue;
    if (message.noforwards) continue;

    const documentId = document.id.toString();
    const extension = message.file?.ext;
    const filename = `${message.id}-${documentId}${/^\.[a-z0-9]{1,10}$/i.test(extension ?? '') ? extension : '.bin'}`;
    const destination = path.join(videosDir, filename);
    const key = String(message.id);
    const previous = state.baixados[key];
    if (previous?.documentId === documentId && previous.arquivo === filename && await hasExpectedSize(destination, document)) {
      skipped++;
      continue;
    }

    try {
      if (!(await hasExpectedSize(destination, document))) {
        const partial = destination + '.part';
        try {
          const file = await fs.open(partial, 'w', 0o600);
          try {
            await client.downloadMedia(message, {
              outputFile: { write: chunk => file.writeFile(chunk) }
            });
          } finally {
            await file.close();
          }
          if (!(await hasExpectedSize(partial, document))) throw new Error('O tamanho do arquivo baixado não confere.');
          await fs.rename(partial, destination);
        } finally {
          await fs.rm(partial, { force: true });
        }
      }
    } catch (error) {
      console.error(`Vídeo ${message.id}: ${error.message}`);
      failures++;
      continue;
    }

    state.baixados[key] = { documentId, arquivo: filename, bytes: document.size.toString() };
    await saveRegistry();
    downloaded++;
    console.log(filename);
  }

  console.log(`Concluídos nesta execução: ${downloaded}. Já presentes: ${skipped}. Falhas: ${failures}.`);
  if (failures) process.exitCode = 1;
}

async function main() {
  const settings = await readOptional(path.join(__dirname, 'env.json'));
  if (settings === null) throw new Error('Crie env.json usando env.example.json como modelo.');
  const config = JSON.parse(settings);
  if (!Number.isSafeInteger(config.apiId) || config.apiId <= 0 || !/^[a-f0-9]{32}$/i.test(config.apiHash ?? '')) {
    throw new Error('Preencha apiId e apiHash em env.json.');
  }

  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dataDir, 'execucao.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Já existe um bloqueio em dados/execucao.lock. Consulte o README.');
  });
  let client;
  try {
    await lock.writeFile(String(process.pid));
    client = new TelegramClient(new StringSession((await readOptional(sessionPath)) ?? ''), config.apiId, config.apiHash, {
      connectionRetries: 5
    });
    await client.connect();
    if (!(await client.checkAuthorization())) {
      if (!process.stdin.isTTY) throw new Error('Faça o primeiro login em um terminal interativo.');
      await client.start({
        phoneNumber: () => input.text('Número com código do país'),
        phoneCode: () => input.password('Código do Telegram'),
        password: () => input.password('Senha da verificação em duas etapas'),
        onError: error => { throw error; }
      });
    }
    await writeAtomic(sessionPath, client.session.save());
    await syncVideos(client, config);
  } finally {
    try {
      await client?.disconnect();
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
