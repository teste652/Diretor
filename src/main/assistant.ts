// Chat com a IA dentro do Diretor. O editor não fala com a internet: ele chama o
// Claude Code ou o Codex instalados no computador, que usam a assinatura da pessoa
// (Claude Pro/Max, ChatGPT Plus), sem chave de API. Cada mensagem roda o programa
// uma vez no modo não interativo, retomando a mesma conversa, e com um único
// conector: o servidor MCP do próprio Diretor. As edições chegam como rascunho.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import type { McpEntry } from './claudeDesktop';

export type AiKind = 'claude' | 'codex';

export const AI_NAME: Record<AiKind, string> = { claude: 'Claude', codex: 'Codex' };

/** Como iniciar o programa (um .exe direto, ou o .js de um pacote do npm rodando no próprio Diretor). */
export interface CliLaunch {
  /** O arquivo que a pessoa tem instalado (o que aparece para ela e o que o terminal abre). */
  path: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type AiEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'error'; message: string; login?: boolean }
  | { type: 'done'; ok: boolean };

export interface AiImage {
  mime: string;
  /** Conteúdo em base64, sem o prefixo "data:". */
  data: string;
}

export const INSTRUCTIONS = [
  'Você está conversando com o usuário pelo painel de chat do editor de vídeo Diretor. Ele não é técnico: responda em português do Brasil, curto e em linguagem simples, sem jargão nem nomes de ferramentas.',
  'Para ver o projeto, use get_context do conector "diretor". Para mudar qualquer coisa, use propose_edit: a edição vira um rascunho que o usuário vê na prévia e na linha do tempo e aceita, ajusta ou descarta no próprio editor.',
  'Não rode comandos nem abra arquivos do computador: tudo é feito pelo conector "diretor".',
  'Depois de enviar uma proposta, NÃO fique esperando a decisão (não use get_proposal com waitSeconds). Termine com uma ou duas frases dizendo o que propôs. Na próxima mensagem, confira o que foi aceito com get_proposal (sem esperar) ou get_context antes de continuar.',
  'Se uma proposta estiver desatualizada e o usuário pedir para refazer, faça uma nova com replaces=<id da antiga> e um requestId novo.',
  'Se o usuário mandar imagens, use como referência visual (estilo, cores, posição, texto).',
].join('\n');

/** Variável que aponta um programa específico (testes, ou uma instalação fora do lugar comum). */
const OVERRIDE: Record<AiKind, string> = { claude: 'DIRETOR_CLAUDE_CLI', codex: 'DIRETOR_CODEX_CLI' };

type Env = Record<string, string | undefined>;

/** Onde procurar o programa, na ordem. */
export function cliCandidates(kind: AiKind, env: Env = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const override = env[OVERRIDE[kind]];
  if (override) return [override];
  const home = env.USERPROFILE || env.HOME || homedir();
  const win = platform === 'win32';
  const names = win ? [`${kind}.exe`, `${kind}.cmd`] : [kind];
  const dirs: string[] = [];
  // Instalador oficial do Claude Code (PowerShell/curl): ~/.local/bin. Instalação "local" antiga: ~/.claude/local.
  if (kind === 'claude') dirs.push(join(home, '.local', 'bin'), join(home, '.claude', 'local'));
  if (win) {
    if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  } else dirs.push(join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin');
  // O PATH vem por último: o Diretor aberto pelo menu Iniciar herda o PATH de quando o Windows entrou.
  const path = env.PATH ?? env.Path ?? '';
  dirs.push(...path.split(delimiter).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs)
    for (const n of names) {
      const f = join(d, n);
      const key = win ? f.toLowerCase() : f;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  return out;
}

/**
 * O que um atalho .cmd do npm executa. Ex.: `"%dp0%\node_modules\@openai\codex\bin\codex.js" %*`.
 * Rodar o alvo direto evita o cmd.exe, que estraga textos com aspas e acentos.
 */
export function shimTarget(cmdFile: string, text: string): string | null {
  // O atalho do npm cita antes o node.exe ("IF EXIST %dp0%\node.exe"): o programa é o último caminho, e nunca o node.exe.
  const targets = [...text.matchAll(/%~?dp0%?\\([^"\r\n%]+?\.(?:c?js|mjs|exe))"/gi)].map((m) => m[1]).filter((t) => !/(^|\\)node\.exe$/i.test(t));
  const t = targets[targets.length - 1];
  return t ? resolve(dirname(cmdFile), t.replace(/\\/g, '/')) : null;
}

const CODEX_TRIPLE: Record<string, [string, string]> = {
  'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
  'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
  'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
  'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
  'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
};

/**
 * O Codex do npm é um .js que só inicia o programa de verdade (codex.exe). Rodar o .js pelo
 * Diretor faria o Windows abrir uma janela preta a cada mensagem: chama o codex.exe direto.
 */
export function codexNative(jsFile: string, platform: string = process.platform, arch: string = process.arch): string | null {
  if (!/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/i.test(jsFile)) return null;
  const t = CODEX_TRIPLE[`${platform}-${arch}`];
  if (!t) return null;
  const [pkg, triple] = t;
  const root = resolve(dirname(jsFile), '..');
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';
  const tail = ['vendor', triple, 'bin', exe];
  const candidates = [join(root, 'node_modules', ...pkg.split('/'), ...tail), join(root, '..', '..', ...pkg.split('/'), ...tail), join(root, ...tail)];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Monta como iniciar um arquivo encontrado; null se ele não dá para ser iniciado sem o cmd.exe. */
export function launchFor(file: string, nodeExec: string = process.execPath, depth = 0): CliLaunch | null {
  const ext = extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const native = codexNative(file);
    if (native) return { path: file, command: native, args: [], env: { CODEX_MANAGED_BY_NPM: '1' } };
    return { path: file, command: nodeExec, args: [file], env: nodeExec === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : undefined };
  }
  if (ext === '.cmd' || ext === '.bat') {
    if (depth > 0) return null;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const target = shimTarget(file, text);
    if (!target || !existsSync(target)) return null;
    const inner = launchFor(target, nodeExec, depth + 1);
    return inner && { ...inner, path: file };
  }
  return { path: file, command: file, args: [] };
}

/** node.exe do computador, se houver: um .js rodado por ele não abre janelas pretas para o que ele iniciar. */
function consoleNode(env: Env, platform: NodeJS.Platform): string | null {
  if (platform !== 'win32') return null;
  const path = env.PATH ?? env.Path ?? '';
  for (const d of path.split(delimiter).filter(Boolean)) {
    const f = join(d, 'node.exe');
    if (existsSync(f)) return f;
  }
  return null;
}

export function findCli(kind: AiKind, env: Env = process.env, platform: NodeJS.Platform = process.platform): CliLaunch | null {
  const nodeExec = consoleNode(env, platform) ?? process.execPath;
  for (const f of cliCandidates(kind, env, platform)) {
    if (!existsSync(f)) continue;
    const l = launchFor(f, nodeExec);
    if (l) return l;
  }
  return null;
}

/** Argumentos do Claude Code: modo não interativo, só o conector do Diretor, sem nenhuma outra ferramenta. */
export function claudeArgs(o: { mcpConfigFile: string; sessionId?: string }): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    o.mcpConfigFile,
    '--strict-mcp-config',
    '--tools',
    '',
    '--allowedTools',
    'mcp__diretor',
    '--append-system-prompt',
    INSTRUCTIONS,
    ...(o.sessionId ? ['--resume', o.sessionId] : []),
  ];
}

/** A mensagem do usuário no formato que o Claude Code lê pela entrada (texto e imagens). */
export function claudeInput(text: string, images: AiImage[] = []): string {
  const content: unknown[] = images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }));
  content.push({ type: 'text', text: text || 'Veja a imagem.' });
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

/** Valor em TOML para o `-c chave=valor` do Codex (o JSON de textos e listas também é TOML válido). */
const toml = (v: string | string[]) => JSON.stringify(v);

/** Argumentos do Codex: `codex exec` com o conector do Diretor aprovado e sem poder mexer em arquivos. */
export function codexArgs(o: { mcp: McpEntry; cwd: string; sessionId?: string; imageFiles?: string[] }): string[] {
  const env = Object.entries(o.mcp.env ?? {})
    .map(([k, v]) => `${k}=${toml(v)}`)
    .join(',');
  const cfg = [
    `mcp_servers.diretor.command=${toml(o.mcp.command)}`,
    `mcp_servers.diretor.args=${toml(o.mcp.args)}`,
    `mcp_servers.diretor.env={${env}}`,
    'mcp_servers.diretor.default_tools_approval_mode="approve"',
    'mcp_servers.diretor.tool_timeout_sec=60',
    'approval_policy="never"',
    `developer_instructions=${toml(INSTRUCTIONS)}`,
  ].flatMap((c) => ['-c', c]);
  // Sem terminal e sem abrir imagens do disco: o Codex só mexe no projeto pelo conector do Diretor.
  const tools = ['shell_tool', 'unified_exec', 'view_image'].flatMap((f) => ['--disable', f]);
  const base = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', o.cwd, ...tools, ...cfg];
  // O texto vem pela entrada ("-"). As imagens ficam depois dele: "-i" aceita vários arquivos e engoliria o "-".
  const images = (o.imageFiles ?? []).flatMap((f) => ['-i', f]);
  return o.sessionId ? [...base, 'resume', o.sessionId, '-', ...images] : [...base, '-', ...images];
}

const LOGIN = /log ?in|sign ?in|log ?out|api key|auth|unauthori[sz]ed|401|credential|subscription|refresh token|access token/i;

/** Uma linha de saída do Claude Code (stream-json) vira eventos para o chat. */
export function parseClaudeLine(line: string): AiEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') return [{ type: 'session', id: m.session_id }];
  if (m.type === 'assistant') {
    // Erro da API (sem login, limite de uso): o Claude Code manda como se fosse uma resposta, e de novo no "result".
    if (m.error || m.is_api_error_message) return [];
    const content = ((m.message as { content?: unknown[] })?.content ?? []) as { type: string; text?: string; name?: string }[];
    const out: AiEvent[] = [];
    for (const c of content) {
      if (c.type === 'text' && c.text?.trim()) out.push({ type: 'text', text: c.text });
      else if (c.type === 'tool_use' && c.name) out.push({ type: 'tool', name: c.name.replace(/^mcp__diretor__/, '') });
    }
    return out;
  }
  if (m.type === 'result') {
    const out: AiEvent[] = [];
    if (typeof m.session_id === 'string') out.push({ type: 'session', id: m.session_id });
    if (m.is_error) {
      const msg = typeof m.result === 'string' && m.result ? m.result : Array.isArray(m.errors) ? m.errors.join(' ') : String(m.subtype ?? 'erro');
      out.push({ type: 'error', message: msg, login: LOGIN.test(msg) });
      out.push({ type: 'done', ok: false });
    } else out.push({ type: 'done', ok: true });
    return out;
  }
  return [];
}

/** Uma linha de saída do Codex (`exec --json`) vira eventos para o chat. */
export function parseCodexLine(line: string): AiEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  const item = m.item as { type?: string; text?: string; tool?: string } | undefined;
  switch (m.type) {
    case 'thread.started':
      return typeof m.thread_id === 'string' ? [{ type: 'session', id: m.thread_id }] : [];
    case 'item.started':
      return item?.type === 'mcp_tool_call' && item.tool ? [{ type: 'tool', name: item.tool }] : [];
    case 'item.completed':
      return item?.type === 'agent_message' && item.text?.trim() ? [{ type: 'text', text: item.text }] : [];
    case 'turn.completed':
      return [{ type: 'done', ok: true }];
    case 'turn.failed': {
      const msg = (m.error as { message?: string })?.message ?? 'O Codex não conseguiu responder.';
      return [
        { type: 'error', message: msg, login: LOGIN.test(msg) },
        { type: 'done', ok: false },
      ];
    }
    case 'error': {
      const msg = String(m.message ?? '');
      // "Reconnecting... 2/5": o Codex tenta de novo sozinho.
      if (/^Reconnecting/i.test(msg)) return [];
      return [{ type: 'error', message: msg, login: LOGIN.test(msg) }];
    }
    default:
      return [];
  }
}

/** Mensagem curta para quando o programa termina sem dizer o porquê. */
export function exitMessage(kind: AiKind, code: number | null, stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // O Codex pode acrescentar um "Stack backtrace" depois do erro: a linha que importa começa com "Error".
  const errLine = [...lines].reverse().find((l) => /^error\b/i.test(l));
  const tail = (errLine ?? lines.slice(-3).join(' ')).slice(0, 400);
  const name = kind === 'claude' ? 'O Claude Code' : 'O Codex';
  return tail ? `${name} parou: ${tail}` : `${name} parou sem responder (código ${code ?? '?'}).`;
}

export interface RunOptions {
  kind: AiKind;
  launch: CliLaunch;
  args: string[];
  input: string;
  cwd: string;
  onEvent: (ev: AiEvent) => void;
}

/** Roda uma mensagem. `stop()` encerra o programa (e o que ele abriu). */
export function runAssistant(o: RunOptions): { stop: () => void; child: ChildProcess } {
  const parse = o.kind === 'claude' ? parseClaudeLine : parseCodexLine;
  // Sem ELECTRON_RUN_AS_NODE herdado: ele vale só para quem precisa (o .js do npm e o servidor do Diretor).
  const env: Env = { ...process.env, ...o.launch.env };
  if (!o.launch.env?.ELECTRON_RUN_AS_NODE) delete env.ELECTRON_RUN_AS_NODE;
  delete env.RUST_BACKTRACE;
  delete env.RUST_LIB_BACKTRACE;
  const child = spawn(o.launch.command, [...o.launch.args, ...o.args], { cwd: o.cwd, env: env as NodeJS.ProcessEnv, windowsHide: true, stdio: 'pipe' });
  let finished = false;
  let stopped = false;
  let stderr = '';
  let buf = '';
  let lastError = '';
  const emit = (ev: AiEvent) => {
    if (finished) return;
    // O Codex manda o mesmo erro duas vezes ("error" e "turn.failed"): mostra uma.
    if (ev.type === 'error') {
      if (ev.message === lastError) return;
      lastError = ev.message;
    }
    if (ev.type === 'done') finished = true;
    o.onEvent(ev);
  };
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) for (const ev of parse(line)) emit(ev);
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (c: string) => {
    stderr = (stderr + c).slice(-8000);
  });
  child.on('error', (e) => {
    emit({ type: 'error', message: `Não consegui abrir ${o.launch.path}: ${e.message}` });
    emit({ type: 'done', ok: false });
  });
  child.on('close', (code) => {
    if (buf.trim()) for (const ev of parse(buf.trim())) emit(ev);
    if (finished) return;
    if (stopped) return emit({ type: 'done', ok: false });
    if (code === 0) return emit({ type: 'done', ok: true });
    const msg = exitMessage(o.kind, code, stderr);
    emit({ type: 'error', message: msg, login: LOGIN.test(stderr) });
    emit({ type: 'done', ok: false });
  });
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(o.input);
  return {
    child,
    stop: () => {
      if (child.exitCode !== null || stopped) return;
      stopped = true;
      // No Windows, kill() fecha só o primeiro processo: taskkill /T leva junto o que ele abriu.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    },
  };
}

/**
 * Script do PowerShell para instalar e/ou entrar na conta, numa janela que a pessoa vê.
 * Instalar: o instalador oficial (Claude Code) ou o npm (Codex). Entrar: o próprio programa pede o login.
 * O caminho do programa já instalado chega pela variável DIRETOR_CLI, nunca no texto do script
 * (um nome de pasta com aspas não vira comando).
 */
export function terminalScript(kind: AiKind, action: 'install' | 'login'): string {
  const q = (s: string) => `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;
  const say = (s: string) => `Write-Host ${q(s)} -ForegroundColor Cyan`;
  // O Diretor guarda o PATH de quando abriu: relê o atual (Node.js ou Claude Code instalados depois).
  const freshPath = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')";
  if (kind === 'claude') {
    const installed = "Join-Path $env:USERPROFILE '.local\\bin\\claude.exe'";
    const signIn = say('Entre na sua conta do Claude (plano Pro ou Max). Quando terminar, feche esta janela e volte ao Diretor.');
    if (action === 'login') return [freshPath, signIn, `$cli = if ($env:DIRETOR_CLI) { $env:DIRETOR_CLI } else { ${installed} }`, '& $cli'].join('; ');
    return [freshPath, say('Instalando o Claude Code (instalador oficial da Anthropic)...'), 'irm https://claude.ai/install.ps1 | iex', signIn, `& (${installed})`].join('; ');
  }
  const signIn = say('Entre na sua conta do ChatGPT (plano Plus ou maior). Quando terminar, volte ao Diretor.');
  if (action === 'login') return [freshPath, signIn, 'if ($env:DIRETOR_CLI) { & $env:DIRETOR_CLI login } else { codex login }'].join('; ');
  const noNode = [
    say('O Codex precisa do Node.js. Abrindo a página para baixar: instale a versão LTS e clique de novo em Instalar no Diretor.'),
    "Start-Process 'https://nodejs.org/pt'",
    'return',
  ].join('; ');
  return [
    freshPath,
    `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { ${noNode} }`,
    say('Instalando o Codex...'),
    'npm install -g @openai/codex',
    signIn,
    // O codex.cmd fica na pasta global do npm, que nem sempre está no PATH desta janela.
    "& (Join-Path (npm prefix -g).Trim() 'codex.cmd') login",
  ].join('; ');
}
