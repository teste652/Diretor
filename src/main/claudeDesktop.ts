// "Conectar ao Claude Desktop": grava o servidor MCP "diretor" na configuração do
// Claude Desktop (claude_desktop_config.json) sem mexer no resto do arquivo.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** O que o Claude Desktop executa para falar com o editor. */
export interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const CONFIG_NAME = 'claude_desktop_config.json';
/** Cópia do arquivo como estava antes da última mudança feita pelo Diretor. */
export const BACKUP_NAME = 'claude_desktop_config.antes-do-diretor.json';
const SERVER_NAME = 'diretor';

/** Estado da configuração numa pasta do Claude Desktop. */
export type ConfigState = { file: string; state: 'connected' | 'outdated' | 'missing' } | { file: string; state: 'invalid'; error: string };
export type ConnectResult = { file: string; state: 'added' | 'updated' | 'unchanged' } | { file: string; state: 'invalid' | 'error'; error: string };

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Pastas de configuração do Claude Desktop que existem nesta máquina (ele já
 * abriu pelo menos uma vez). No Windows há duas: o instalador atual (pacote
 * MSIX) guarda tudo em %LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude,
 * e a instalação antiga em %APPDATA%\Claude. Grava nas duas quando existirem.
 */
export function claudeConfigDirs(opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {}): string[] {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const dirs: string[] = [];
  if (platform === 'win32') {
    const packages = join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Packages');
    let names: string[] = [];
    try {
      names = readdirSync(packages).filter((n) => /^Claude_[a-z0-9]+$/i.test(n)).sort();
    } catch {
      /* sem pacotes */
    }
    for (const n of names) dirs.push(join(packages, n, 'LocalCache', 'Roaming', 'Claude'));
    dirs.push(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude'));
  } else if (platform === 'darwin') {
    dirs.push(join(home, 'Library', 'Application Support', 'Claude'));
  } else {
    dirs.push(join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude'));
  }
  return dirs.filter(isDir);
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
async function replaceFile(tmp: string, file: string, rename: (from: string, to: string) => Promise<void>): Promise<void> {
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

/**
 * Grava (ou atualiza) o servidor "diretor" em cada pasta. Mantém tudo o que já
 * existe no arquivo, guarda uma cópia do original e troca o arquivo de uma vez
 * (nunca fica um arquivo pela metade). Arquivo com erro de formato não é tocado.
 */
export async function connectClaude(
  dirs: string[],
  entry: McpEntry,
  opts: { rename?: (from: string, to: string) => Promise<void> } = {},
): Promise<ConnectResult[]> {
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
    const eol = parsed.raw?.includes('\r\n') ? '\r\n' : '\n';
    const text = JSON.stringify(next, null, 2).replace(/\n/g, eol) + eol;
    const tmp = join(dirname(file), `.${CONFIG_NAME}.diretor-${process.pid}.tmp`);
    try {
      if (parsed.raw !== null) await copyFile(file, join(dir, BACKUP_NAME));
      await writeFile(tmp, text, 'utf8');
      await replaceFile(tmp, file, rename);
      results.push({ file, state: before === 'missing' ? 'added' : 'updated' });
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      results.push({ file, state: 'error', error: (e as Error).message });
    }
  }
  return results;
}

/** O servidor MCP vem dentro do app; no instalador ele fica fora do app.asar para poder ser executado. */
export function unpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
