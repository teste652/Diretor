// Teste da atualização automática no app instalado (CI, Windows), depois do roteiro de ponta a ponta.
//   node scripts/update-check.mjs
// 1. Confere o que o CI vai publicar: o latest.yml (versão, nome e sha512 do instalador) e o
//    endereço das versões gravado no app instalado (app-update.yml).
// 2. Faz uma atualização de verdade: um servidor local anuncia uma versão nova (o mesmo
//    instalador, com outro número), o Diretor instalado baixa, confere, fecha, o instalador
//    roda sozinho e o Diretor abre de novo.
// Usa DIRETOR_APP (o Diretor.exe instalado), release/Diretor-Setup.exe e release/latest.yml.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const app = process.env.DIRETOR_APP ? resolve(process.env.DIRETOR_APP) : null;
if (process.platform !== 'win32' || !app || !existsSync(app)) {
  console.error('Uso, no Windows: DIRETOR_APP=<Diretor.exe instalado> node scripts/update-check.mjs');
  process.exit(2);
}
const installDir = dirname(app);
const setup = resolve('release', 'Diretor-Setup.exe');
const latestPath = resolve('release', 'latest.yml');
const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(500);
  }
  return false;
}

// Processos que rodam da pasta instalada (o editor e os auxiliares do Electron).
function running() {
  const ps = `$d=$env:DIRETOR_INSTDIR.TrimEnd('\\')+'\\';@(Get-CimInstance Win32_Process|?{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($d,'OrdinalIgnoreCase')}).Count`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, DIRETOR_INSTDIR: installDir }, encoding: 'utf8' });
  return Number(r.stdout.trim()) || 0;
}
function killAll() {
  const ps = `$d=$env:DIRETOR_INSTDIR.TrimEnd('\\')+'\\';Get-CimInstance Win32_Process|?{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($d,'OrdinalIgnoreCase')}|%{Stop-Process -Id $_.ProcessId -Force -EA 0}`;
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, DIRETOR_INSTDIR: installDir } });
}

// ---------- 1. o que vai ser publicado ----------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const feed = pkg.build.publish[0].url;
const latest = existsSync(latestPath) ? readFileSync(latestPath, 'utf8') : '';
const field = (name) => latest.match(new RegExp(`^${name}: ['"]?([^'"\\r\\n]+)`, 'm'))?.[1];
const sha512 = createHash('sha512').update(readFileSync(setup)).digest('base64');
check('latest.yml gerado junto com o instalador', !!latest);
check('latest.yml: versão deste build', !process.env.VERSAO || field('version') === process.env.VERSAO, `${field('version')} (esperado ${process.env.VERSAO})`);
check('latest.yml: aponta para o Diretor-Setup.exe', field('path') === 'Diretor-Setup.exe', field('path'));
check('latest.yml: sha512 confere com o instalador', field('sha512') === sha512);
const appUpdate = join(installDir, 'resources', 'app-update.yml');
const appUpdateText = existsSync(appUpdate) ? readFileSync(appUpdate, 'utf8') : '';
check('app instalado sabe onde procurar versões (app-update.yml)', appUpdateText.includes(`url: ${feed}`), appUpdateText.replace(/\r?\n/g, ' | '));

// ---------- 2. uma atualização de verdade ----------
// A primeira consulta anuncia a versão 99.0.0; as seguintes, a versão instalada.
const novo = latest.replace(/^version: .*$/m, 'version: 99.0.0');
let consultas = 0;
let baixou = false;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/latest.yml') {
    consultas++;
    res.writeHead(200, { 'content-type': 'text/yaml' });
    res.end(consultas === 1 ? novo : latest);
  } else if (path === '/Diretor-Setup.exe') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(setup).size });
    createReadStream(setup).pipe(res).on('finish', () => (baixou = true));
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const out = join(process.env.RUNNER_TEMP ?? tmpdir(), 'diretor-atualizacao');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const userData = join(out, 'perfil-electron');
const log = join(userData, 'atualizacao.log');
const readLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const env = { ...process.env, DIRETOR_ATUALIZACAO_URL: url, DIRETOR_ATUALIZAR_SEM_PERGUNTAR: '1', DIRETOR_USER_DATA: userData, DIRETOR_BRIDGE_FILE: join(out, 'ponte.json') };
delete env.DIRETOR_SEM_ATUALIZAR;

killAll();
// O instalador da versão nova apaga a pasta antiga antes de pôr os arquivos novos: se esta
// marca some e o Diretor.exe está lá, os arquivos foram trocados.
const marca = join(installDir, 'marca-do-teste.txt');
writeFileSync(marca, 'some quando o instalador troca os arquivos');
const proc = spawn(app, ['--disable-gpu'], { env, stdio: 'ignore' });
let saiu = false;
proc.on('exit', () => (saiu = true));

check('procura a versão nova ao abrir', await until(() => consultas >= 1, 60_000), `${consultas} consulta(s)`);
check('baixa o instalador novo', await until(() => baixou, 120_000));
check('confere e deixa a versão nova pronta', await until(() => readLog().includes('Versão 99.0.0 baixada'), 60_000));
check('fecha para instalar', await until(() => saiu, 60_000));
check('o instalador troca os arquivos', await until(() => !existsSync(marca) && existsSync(app), 180_000));
// O instalador abre o Diretor pelo Windows, sem as variáveis deste teste: ele procura versões
// no endereço de verdade, que não tem nada mais novo que este build.
check('o Diretor abre de novo depois de atualizar', await until(() => running() > 0, 60_000));
await wait(5000);
check('o Diretor continua aberto', running() > 0);

killAll();
server.close();
const erros = readLog()
  .split(/\r?\n/)
  .filter((l) => l.includes('[erro]'));
if (erros.length) console.log(`Erros no registro da atualização:\n${erros.join('\n')}`);
console.log(`\nRegistro completo (${log}):\n${readLog()}`);
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} verificação(ões) falharam.` : '\nAtualização automática: tudo certo.');
process.exit(failed ? 1 : 0);
