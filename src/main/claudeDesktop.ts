// "Conectar ao Claude Desktop": grava o servidor MCP "diretor" na configuração do
// Claude Desktop (claude_desktop_config.json) sem mexer no resto do arquivo.

import { constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { copyFile, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, win32 } from 'node:path';

/** O que o Claude Desktop executa para falar com o editor. */
export interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const CONFIG_NAME = 'claude_desktop_config.json';
/** Cópia do arquivo como estava antes da primeira mudança feita pelo Diretor (nunca é substituída). */
export const BACKUP_NAME = 'claude_desktop_config.antes-do-diretor.json';
const SERVER_NAME = 'diretor';

/** Estado da configuração numa pasta do Claude Desktop. */
export type ConfigState = { file: string; state: 'connected' | 'outdated' | 'missing' } | { file: string; state: 'invalid'; error: string };
export type ConnectResult = { file: string; state: 'added' | 'updated' | 'unchanged' } | { file: string; state: 'invalid' | 'error'; error: string };
export type DisconnectResult = { file: string; state: 'removed' | 'kept' | 'absent' } | { file: string; state: 'invalid' | 'error'; error: string };

type Where = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string };
type Rename = (from: string, to: string) => Promise<void>;

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Pasta do pacote do Claude Desktop: Claude_<editor> ou AnthropicPBC.Claude_<editor> (na Claude-Data, em minúsculas). */
const FAMILY = /^(anthropicpbc\.)?claude_[a-z0-9]+$/i;
/** O Claude Desktop 4 muda os dados para %LOCALAPPDATA%\Claude-Data e deixa esta marca vazia na pasta antiga. */
const LEFT_MARKER = /^\.user-data-left\./i;
const hasConfig = (names: string[]) => names.some((n) => n.toLowerCase() === CONFIG_NAME);
const wasLeft = (names: string[]) => names.some((n) => LEFT_MARKER.test(n));
const onlyMarkers = (names: string[]) => names.every((n) => n.startsWith('.user-data-'));

function windowsFolders(env: NodeJS.ProcessEnv, home: string) {
  const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || join(home, 'AppData', 'Roaming');
  const dataRoot = join(local, 'Claude-Data');
  const packages = join(local, 'Packages');
  const moved = list(dataRoot)
    .filter((n) => FAMILY.test(n) && isDir(join(dataRoot, n)))
    .sort()
    .map((family) => ({ family, dir: join(dataRoot, family) }));
  const pkgs = list(packages)
    .filter((n) => FAMILY.test(n))
    .sort()
    .map((family) => ({ family, dir: join(packages, family, 'LocalCache', 'Roaming', 'Claude') }))
    .filter((p) => isDir(p.dir));
  const classic = join(roaming, 'Claude');
  return { moved, pkgs, classic: isDir(classic) ? classic : null };
}

/** Tira repetidas (a mesma pasta por dois caminhos, como um atalho de pasta). */
function unique(dirs: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  return dirs.filter((d) => {
    let key = d;
    try {
      key = realpathSync(d);
    } catch {
      /* fica o caminho como veio */
    }
    if (platform === 'win32') key = key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pastas onde o Conectar grava: as que o Claude Desktop instalado lê (ele já abriu
 * pelo menos uma vez). Não cria pasta nenhuma. No Windows, cada versão usa um lugar:
 * - Claude Desktop 4: %LOCALAPPDATA%\Claude-Data\claude_<editor>. A pasta antiga
 *   fica só com a marca .user-data-left.<família>, e o Claude não lê mais nada dela.
 * - Instalador MSIX mais antigo: a cópia particular do pacote,
 *   %LOCALAPPDATA%\Packages\Claude_<editor>\LocalCache\Roaming\Claude. Quando ela não
 *   tem o arquivo, o Claude lê o de %APPDATA%\Claude, então não cria uma cópia
 *   particular que esconderia aquele.
 * - Instalação clássica: %APPDATA%\Claude.
 * CLAUDE_USER_DATA_DIR, quando definida, troca a pasta de dados do Claude por ela.
 */
export function claudeConfigDirs(opts: Where = {}): string[] {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  if (env.CLAUDE_USER_DATA_DIR) return isDir(env.CLAUDE_USER_DATA_DIR) ? [env.CLAUDE_USER_DATA_DIR] : [];
  if (platform !== 'win32') {
    const dir = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude') : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude');
    return isDir(dir) && !wasLeft(list(dir)) ? [dir] : [];
  }
  const { moved, pkgs, classic } = windowsFolders(env, home);
  const out: string[] = [];
  for (const m of moved) if (!wasLeft(list(m.dir))) out.push(m.dir);
  const classicNames = classic ? list(classic) : [];
  const classicUsed = classic !== null && !wasLeft(classicNames);
  const classicHasConfig = classicUsed && hasConfig(classicNames);
  for (const p of pkgs) {
    const names = list(p.dir);
    if (wasLeft(names)) continue;
    // "Redefinir" o app deixa a pasta do pacote só com marcas: o Claude usa a Claude-Data.
    if (onlyMarkers(names) && moved.some((m) => m.family.toLowerCase() === p.family.toLowerCase())) continue;
    if (hasConfig(names) || !classicHasConfig) out.push(p.dir);
  }
  if (classic && classicUsed && (classicHasConfig || out.length === 0)) out.push(classic);
  return unique(out, platform);
}

/** Todas as pastas de configuração do Claude Desktop que existem, inclusive as abandonadas (para desconectar). */
export function claudeConfigCandidates(opts: Where = {}): string[] {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const dirs: string[] = [];
  if (env.CLAUDE_USER_DATA_DIR) dirs.push(env.CLAUDE_USER_DATA_DIR);
  if (platform === 'win32') {
    const { moved, pkgs, classic } = windowsFolders(env, home);
    dirs.push(...moved.map((m) => m.dir), ...pkgs.map((p) => p.dir));
    if (classic) dirs.push(classic);
  } else {
    dirs.push(platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude') : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude'));
  }
  return unique(dirs.filter(isDir), platform);
}

type Parsed = { ok: true; json: Record<string, unknown>; raw: string | null } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readConfig(file: string): Parsed {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, json: {}, raw: null };
    return { ok: false, error: (e as Error).message };
  }
  const text = raw.replace(/^﻿/, '');
  if (!text.trim()) return { ok: true, json: {}, raw };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `o arquivo não é um JSON válido (${(e as Error).message})` };
  }
  if (!isObject(json)) return { ok: false, error: 'o arquivo não contém um objeto JSON' };
  if (json.mcpServers !== undefined && !isObject(json.mcpServers)) return { ok: false, error: '"mcpServers" não é um objeto' };
  return { ok: true, json, raw };
}

function sameEntry(a: unknown, b: McpEntry): boolean {
  if (!isObject(a)) return false;
  const envA = isObject(a.env) ? a.env : {};
  const envB = b.env ?? {};
  return (
    a.command === b.command &&
    Array.isArray(a.args) &&
    a.args.length === b.args.length &&
    a.args.every((x, i) => x === b.args[i]) &&
    Object.keys(envA).length === Object.keys(envB).length &&
    Object.entries(envB).every(([k, v]) => envA[k] === v)
  );
}

function stateOf(parsed: Extract<Parsed, { ok: true }>, entry: McpEntry): 'connected' | 'outdated' | 'missing' {
  const current = (parsed.json.mcpServers as Record<string, unknown> | undefined)?.[SERVER_NAME];
  if (current === undefined) return 'missing';
  return sameEntry(current, entry) ? 'connected' : 'outdated';
}

/** Como está a configuração em cada pasta (sem mudar nada). */
export function readClaudeConfigs(dirs: string[], entry: McpEntry): ConfigState[] {
  return dirs.map((dir) => {
    const file = join(dir, CONFIG_NAME);
    const parsed = readConfig(file);
    return parsed.ok ? { file, state: stateOf(parsed, entry) } : { file, state: 'invalid', error: parsed.error };
  });
}

/** Troca o arquivo de uma vez. Se o Claude estiver gravando nele naquele instante, tenta de novo. */
async function replaceFile(tmp: string, file: string, rename: Rename): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(tmp, file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code) || i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

/** Mesmo JSON, com as quebras de linha que o arquivo já usava. */
function format(json: Record<string, unknown>, raw: string | null): string {
  const eol = raw?.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol;
}

/**
 * Grava sem deixar arquivo pela metade: escreve ao lado e troca de uma vez.
 * Se o arquivo é um atalho (link simbólico), grava no arquivo de verdade e o atalho
 * continua. Se ele tem outro nome no disco (link físico), grava no lugar para os dois
 * nomes continuarem sendo o mesmo arquivo.
 */
async function writeConfig(file: string, text: string, rename: Rename): Promise<void> {
  let target = file;
  try {
    target = realpathSync(file);
  } catch {
    /* ainda não existe */
  }
  let links = 1;
  try {
    links = statSync(target).nlink;
  } catch {
    /* ainda não existe */
  }
  if (links > 1) return writeFile(target, text, 'utf8');
  const tmp = join(dirname(target), `.${CONFIG_NAME}.diretor-${process.pid}.tmp`);
  try {
    await writeFile(tmp, text, 'utf8');
    await replaceFile(tmp, target, rename);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/**
 * Grava (ou atualiza) o servidor "diretor" em cada pasta. Mantém tudo o que já
 * existe no arquivo e guarda uma cópia de como ele estava antes da primeira mudança.
 * Arquivo com erro de formato não é tocado.
 */
export async function connectClaude(dirs: string[], entry: McpEntry, opts: { rename?: Rename } = {}): Promise<ConnectResult[]> {
  const rename = opts.rename ?? fsRename;
  const results: ConnectResult[] = [];
  for (const dir of dirs) {
    const file = join(dir, CONFIG_NAME);
    const parsed = readConfig(file);
    if (!parsed.ok) {
      results.push({ file, state: 'invalid', error: parsed.error });
      continue;
    }
    const before = stateOf(parsed, entry);
    if (before === 'connected') {
      results.push({ file, state: 'unchanged' });
      continue;
    }
    const servers = isObject(parsed.json.mcpServers) ? parsed.json.mcpServers : {};
    const next = { ...parsed.json, mcpServers: { ...servers, [SERVER_NAME]: entry } };
    try {
      if (parsed.raw !== null) await copyFile(file, join(dir, BACKUP_NAME), constants.COPYFILE_EXCL).catch(ignoreExisting); // a primeira cópia fica
      await writeConfig(file, format(next, parsed.raw), rename);
      results.push({ file, state: before === 'missing' ? 'added' : 'updated' });
    } catch (e) {
      results.push({ file, state: 'error', error: (e as Error).message });
    }
  }
  return results;
}

function ignoreExisting(e: NodeJS.ErrnoException) {
  if (e.code !== 'EEXIST') throw e;
}

/** O mesmo executável? No Windows, maiúsculas e minúsculas no caminho não importam. */
function sameCommand(a: unknown, b: string, platform: NodeJS.Platform): boolean {
  if (typeof a !== 'string') return false;
  return platform === 'win32' ? win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase() : a === b;
}

/**
 * Tira o servidor "diretor" da configuração, mas só quando ele executa `command`
 * (esta instalação). Usado ao desinstalar, para o Claude Desktop não ficar tentando
 * abrir um programa que não existe mais.
 */
export async function disconnectClaude(
  dirs: string[],
  command: string,
  opts: { platform?: NodeJS.Platform; rename?: Rename } = {},
): Promise<DisconnectResult[]> {
  const platform = opts.platform ?? process.platform;
  const rename = opts.rename ?? fsRename;
  const results: DisconnectResult[] = [];
  for (const dir of dirs) {
    const file = join(dir, CONFIG_NAME);
    const parsed = readConfig(file);
    if (!parsed.ok) {
      results.push({ file, state: 'invalid', error: parsed.error });
      continue;
    }
    const servers = isObject(parsed.json.mcpServers) ? parsed.json.mcpServers : {};
    const current = servers[SERVER_NAME];
    if (parsed.raw === null || current === undefined) {
      results.push({ file, state: 'absent' });
      continue;
    }
    if (!isObject(current) || !sameCommand(current.command, command, platform)) {
      results.push({ file, state: 'kept' });
      continue;
    }
    const rest = Object.fromEntries(Object.entries(servers).filter(([k]) => k !== SERVER_NAME));
    try {
      await writeConfig(file, format({ ...parsed.json, mcpServers: rest }, parsed.raw), rename);
      results.push({ file, state: 'removed' });
    } catch (e) {
      results.push({ file, state: 'error', error: (e as Error).message });
    }
  }
  return results;
}

/** O servidor MCP vem dentro do app; no instalador ele fica fora do app.asar para poder ser executado. */
export function unpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
