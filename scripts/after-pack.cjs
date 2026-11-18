// Depois de empacotar (electron-builder): confere que o ffmpeg do sistema de destino foi junto.
// O ffmpeg-static baixa o ffmpeg do sistema onde o "npm install" rodou, então um instalador
// do Windows gerado no Linux levaria o ffmpeg errado e não exportaria nada.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const resources =
    platform === 'darwin' ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(context.appOutDir, 'resources');
  const ffmpeg = join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const name = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[platform] ?? platform;
  if (!existsSync(ffmpeg)) {
    throw new Error(`O ffmpeg para ${name} não está no pacote (${ffmpeg}). Gere o instalador no próprio ${name}, depois de "npm ci".`);
  }
  const server = join(resources, 'app.asar.unpacked', 'dist', 'mcp', 'server.cjs');
  if (!existsSync(server)) throw new Error(`O servidor do Claude não está fora do app.asar (${server}). Rode "npm run build" antes.`);
};
