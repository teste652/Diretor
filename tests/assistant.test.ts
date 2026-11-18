import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgs, claudeInput, cliCandidates, codexArgs, codexNative, exitMessage, findCli, launchFor, parseClaudeLine, parseCodexLine, shimTarget, terminalScript } from '../src/main/assistant';

describe('encontrar o Claude Code e o Codex', () => {
  it('procura primeiro no lugar do instalador oficial e depois no PATH, sem repetir', () => {
    const list = cliCandidates('claude', { HOME: '/casa', PATH: ['/casa/.local/bin', '/usr/bin'].join(delimiter) }, 'linux');
    expect(list[0]).toBe(join('/casa', '.local', 'bin', 'claude'));
    expect(list).toContain(join('/usr/bin', 'claude'));
    expect(list.filter((f) => f === join('/casa', '.local', 'bin', 'claude'))).toHaveLength(1);
  });

  it('a variável de teste aponta um programa específico', () => {
    expect(cliCandidates('codex', { DIRETOR_CODEX_CLI: '/x/codex.mjs', PATH: '/usr/bin' }, 'linux')).toEqual(['/x/codex.mjs']);
  });

  it('atalho .cmd do npm: roda o .js de dentro com o próprio Diretor (sem cmd.exe)', () => {
    // Exatamente o que o npm grava (cmd-shim): o node.exe aparece antes do programa e não pode ser escolhido.
    const shim = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      '',
    ].join('\r\n');
    expect(shimTarget('/npm/codex.cmd', shim)).toBe(resolve('/npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    expect(shimTarget('/npm/x.cmd', 'echo nada')).toBeNull();

    const dir = mkdtempSync(join(tmpdir(), 'diretor-cli-'));
    const target = join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'cli.js'), '');
    writeFileSync(join(dir, 'claude.cmd'), 'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
    // Sem node.exe no computador: o próprio Diretor roda o .js (como Node).
    expect(launchFor(join(dir, 'claude.cmd'))).toMatchObject({ path: join(dir, 'claude.cmd'), command: process.execPath, args: [resolve(target, 'cli.js')], env: { ELECTRON_RUN_AS_NODE: '1' } });
    // Com node.exe: ele roda, sem precisar da variável do Electron.
    const viaNode = launchFor(join(dir, 'claude.cmd'), 'C:/nodejs/node.exe');
    expect(viaNode).toMatchObject({ command: 'C:/nodejs/node.exe', args: [resolve(target, 'cli.js')] });
    expect(viaNode?.env).toBeUndefined();
    // Atalho que aponta para um arquivo que não existe: não serve.
    writeFileSync(join(dir, 'quebrado.cmd'), '"%dp0%\\nao\\existe.js" %*');
    expect(launchFor(join(dir, 'quebrado.cmd'))).toBeNull();
    // .exe roda direto.
    expect(launchFor('C:/x/claude.exe')).toEqual({ path: 'C:/x/claude.exe', command: 'C:/x/claude.exe', args: [] });
  });

  it('não encontra nada quando nada existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diretor-vazio-'));
    expect(findCli('claude', { USERPROFILE: dir, APPDATA: join(dir, 'Roaming'), PATH: join(dir, 'bin') }, 'win32')).toBeNull();
  });

  it('Codex do npm: roda o codex.exe de dentro do pacote, não o .js (que abriria uma janela preta)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diretor-codex-'));
    const pkg = join(dir, 'node_modules', '@openai', 'codex');
    const exe = join(pkg, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(join(pkg, 'bin', 'codex.js'), '');
    writeFileSync(exe, '');
    expect(codexNative(join(pkg, 'bin', 'codex.js'), 'win32', 'x64')).toBe(exe);
    // Pacote da plataforma "içado" para o lado (node_modules/@openai/codex-win32-x64).
    const dir2 = mkdtempSync(join(tmpdir(), 'diretor-codex-'));
    const pkg2 = join(dir2, 'node_modules', '@openai', 'codex');
    const exe2 = join(dir2, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    mkdirSync(join(pkg2, 'bin'), { recursive: true });
    mkdirSync(join(exe2, '..'), { recursive: true });
    writeFileSync(join(pkg2, 'bin', 'codex.js'), '');
    writeFileSync(exe2, '');
    expect(codexNative(join(pkg2, 'bin', 'codex.js'), 'win32', 'x64')).toBe(resolve(exe2));
    expect(codexNative('/x/outro/bin/codex.js', 'win32', 'x64')).toBeNull();
  });
});

describe('argumentos', () => {
  it('Claude Code: só o conector do Diretor, nenhuma outra ferramenta, retomando a conversa', () => {
    const a = claudeArgs({ mcpConfigFile: '/ia/mcp.json', sessionId: 'abc' });
    expect(a.slice(0, 1)).toEqual(['-p']);
    expect(a[a.indexOf('--mcp-config') + 1]).toBe('/ia/mcp.json');
    expect(a).toContain('--strict-mcp-config');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('mcp__diretor');
    expect(a[a.indexOf('--resume') + 1]).toBe('abc');
    expect(claudeArgs({ mcpConfigFile: 'x' })).not.toContain('--resume');
  });

  it('Claude Code: texto e imagens vão pela entrada', () => {
    const msg = JSON.parse(claudeInput('deixa assim', [{ mime: 'image/png', data: 'AAAA' }]));
    expect(msg).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'deixa assim' }] },
    });
  });

  it('Codex: conector aprovado, sem mexer em arquivos, imagens depois do "-"', () => {
    const mcp = { command: 'C:\\Users\\Zé\\Diretor.exe', args: ['C:\\Users\\Zé\\server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
    const a = codexArgs({ mcp, cwd: '/ia', sessionId: 't1', imageFiles: ['/ia/a.png'] });
    expect(a.slice(0, 2)).toEqual(['exec', '--json']);
    expect(a[a.indexOf('--sandbox') + 1]).toBe('read-only');
    // Sem terminal e sem abrir imagens do disco.
    const off = a.filter((_, i) => a[i - 1] === '--disable');
    expect(off).toEqual(['shell_tool', 'unified_exec', 'view_image']);
    const cfg = a.filter((_, i) => a[i - 1] === '-c');
    // O caminho do Windows vira um texto TOML com as barras escapadas.
    expect(cfg).toContain('mcp_servers.diretor.command="C:\\\\Users\\\\Zé\\\\Diretor.exe"');
    expect(cfg).toContain('mcp_servers.diretor.env={ELECTRON_RUN_AS_NODE="1"}');
    expect(cfg).toContain('mcp_servers.diretor.default_tools_approval_mode="approve"');
    expect(cfg).toContain('approval_policy="never"');
    expect(a.slice(-5)).toEqual(['resume', 't1', '-', '-i', '/ia/a.png']);
    expect(codexArgs({ mcp, cwd: '/ia' }).slice(-1)).toEqual(['-']);
  });
});

describe('ler a saída', () => {
  it('Claude Code: sessão, texto, ferramenta e fim', () => {
    expect(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1"}')).toEqual([{ type: 'session', id: 's1' }]);
    expect(
      parseClaudeLine(
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fiz.' }, { type: 'tool_use', name: 'mcp__diretor__propose_edit', input: {} }] } }),
      ),
    ).toEqual([
      { type: 'text', text: 'Fiz.' },
      { type: 'tool', name: 'propose_edit' },
    ]);
    expect(parseClaudeLine('{"type":"result","subtype":"success","is_error":false,"result":"Fiz.","session_id":"s1"}')).toEqual([
      { type: 'session', id: 's1' },
      { type: 'done', ok: true },
    ]);
    expect(parseClaudeLine('{"type":"stream_event"}')).toEqual([]);
    expect(parseClaudeLine('não é json')).toEqual([]);
  });

  it('Claude Code sem login: a mensagem de erro não aparece como resposta, só como erro', () => {
    expect(
      parseClaudeLine(
        JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, error: 'authentication_failed', is_api_error_message: true }),
      ),
    ).toEqual([]);
  });

  it('Claude Code sem login: o erro pede para entrar na conta', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}');
    expect(ev).toEqual([
      { type: 'error', message: 'Not logged in · Please run /login', login: true },
      { type: 'done', ok: false },
    ]);
  });

  it('Codex: sessão, ferramenta, texto, fim e erros', () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual([{ type: 'session', id: 't1' }]);
    expect(parseCodexLine('{"type":"item.started","item":{"id":"i","type":"mcp_tool_call","server":"diretor","tool":"get_context"}}')).toEqual([{ type: 'tool', name: 'get_context' }]);
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"Pronto."}}')).toEqual([{ type: 'text', text: 'Pronto.' }]);
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"reasoning","text":"pensando"}}')).toEqual([]);
    expect(parseCodexLine('{"type":"turn.completed","usage":{}}')).toEqual([{ type: 'done', ok: true }]);
    expect(parseCodexLine('{"type":"error","message":"Reconnecting... 2/5 (stream disconnected)"}')).toEqual([]);
    // Login do ChatGPT vencido: também oferece "Entrar na conta".
    const expired = parseCodexLine(
      '{"type":"turn.failed","error":{"message":"Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again."}}',
    );
    expect(expired[0]).toMatchObject({ type: 'error', login: true });
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"401 Unauthorized"}}')).toEqual([
      { type: 'error', message: '401 Unauthorized', login: true },
      { type: 'done', ok: false },
    ]);
  });

  it('programa que para sem explicar: mostra o fim do erro', () => {
    expect(exitMessage('codex', 1, 'linha 1\nError: algo deu errado\n')).toBe('O Codex parou: Error: algo deu errado');
    expect(exitMessage('codex', 1, 'linha 1\nlinha 2\n')).toBe('O Codex parou: linha 1 linha 2');
    expect(exitMessage('claude', 3, '')).toBe('O Claude Code parou sem responder (código 3).');
    // Com "Stack backtrace" depois, vale a linha do erro (é nela que se vê que a conversa sumiu).
    const bt = 'Error: thread/resume: thread/resume failed: no rollout found for thread id abc (code -32600)\n\nStack backtrace:\n   0: <unknown>\n   1: <unknown>\n';
    expect(exitMessage('codex', 1, bt)).toBe('O Codex parou: Error: thread/resume: thread/resume failed: no rollout found for thread id abc (code -32600)');
  });
});

describe('janela para instalar e entrar', () => {
  it('Claude Code: relê o PATH, instala pelo instalador oficial e depois pede o login', () => {
    const s = terminalScript('claude', 'install');
    expect(s.startsWith("$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine')")).toBe(true);
    expect(s).toContain('irm https://claude.ai/install.ps1 | iex');
    expect(s).toContain(".local\\bin\\claude.exe");
  });
  it('o caminho do programa chega por variável, nunca no texto do script', () => {
    expect(terminalScript('claude', 'login')).toContain('$env:DIRETOR_CLI');
    expect(terminalScript('codex', 'login')).toContain('& $env:DIRETOR_CLI login');
  });
  it('Codex sem Node.js: abre a página do Node em vez de falhar; depois entra pela pasta global do npm', () => {
    const s = terminalScript('codex', 'install');
    expect(s).toMatch(/Get-Command npm/);
    expect(s).toContain('npm install -g @openai/codex');
    expect(s).toContain("Join-Path (npm prefix -g).Trim() 'codex.cmd'");
  });
});
