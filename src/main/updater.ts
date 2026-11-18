// Atualização automática do app instalado (electron-updater).
//
// O endereço das versões vem do app-update.yml que o electron-builder coloca no instalador
// (campo "publish" do package.json). O CI publica lá o instalador novo e o latest.yml, que
// diz qual é a versão mais nova. O app olha ao abrir e de tempos em tempos, baixa a versão
// nova sozinho e pergunta se pode reiniciar. Se a pessoa deixar para depois, ela instala
// quando o Diretor for fechado.
//
// Variáveis de ambiente (testes):
// - DIRETOR_SEM_ATUALIZAR=1: não procura versão nova.
// - DIRETOR_ATUALIZACAO_URL=<endereço>: procura nesse endereço em vez do app-update.yml.
// - DIRETOR_ATUALIZAR_SEM_PERGUNTAR=1: com a versão nova baixada, reinicia sem perguntar.
import { app, type BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const INTERVALO_MS = 4 * 60 * 60 * 1000;

/** Registro em <dados do app>/atualizacao.log, para entender o que aconteceu na máquina da pessoa. */
function registrar(nivel: string, ...partes: unknown[]): void {
  const texto = partes.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  try {
    const pasta = app.getPath('userData');
    mkdirSync(pasta, { recursive: true });
    appendFileSync(join(pasta, 'atualizacao.log'), `${new Date().toISOString()} [${nivel}] ${texto}\n`);
  } catch {
    // sem o registro, a atualização segue igual
  }
}

export function iniciarAtualizacao(janela: () => BrowserWindow | null): void {
  const url = process.env.DIRETOR_ATUALIZACAO_URL;
  if (process.env.DIRETOR_SEM_ATUALIZAR === '1' || (!app.isPackaged && !url)) return;

  autoUpdater.logger = {
    info: (...a: unknown[]) => registrar('info', ...a),
    warn: (...a: unknown[]) => registrar('aviso', ...a),
    error: (...a: unknown[]) => registrar('erro', ...a),
    debug: () => {},
  };
  if (url) autoUpdater.setFeedURL({ provider: 'generic', url });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // O instalador fica sempre no mesmo endereço, trocado a cada versão: não há o arquivo da
  // versão anterior para baixar só a diferença. Baixa o instalador inteiro.
  autoUpdater.disableDifferentialDownload = true;

  let perguntada: string | null = null;
  autoUpdater.on('error', (e) => registrar('erro', 'Falha ao procurar ou baixar a versão nova:', e));
  autoUpdater.on('update-downloaded', (info) => {
    registrar('info', `Versão ${info.version} baixada e pronta para instalar.`);
    if (perguntada === info.version) return;
    perguntada = info.version;
    const w = janela();
    const opcoes = {
      type: 'info' as const,
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Nova versão do Diretor',
      message: `A versão ${info.version} do Diretor está pronta.`,
      detail:
        'Reinicie para usar a versão nova. Se escolher "Depois", ela é instalada quando você fechar o Diretor.\n\n' +
        'Se o Claude Desktop estiver conectado ao Diretor, depois de atualizar feche o Claude Desktop por completo e abra de novo.',
    };
    const resposta =
      process.env.DIRETOR_ATUALIZAR_SEM_PERGUNTAR === '1'
        ? Promise.resolve({ response: 0 })
        : w
          ? dialog.showMessageBox(w, opcoes)
          : dialog.showMessageBox(opcoes);
    void resposta.then(({ response }) => {
      if (response !== 0) return;
      registrar('info', 'A pessoa pediu para reiniciar e atualizar.');
      const atual = janela();
      if (!atual) {
        autoUpdater.quitAndInstall(true, true);
        return;
      }
      // Fecha pela janela: se o projeto tem mudanças sem salvar, ela pergunta antes, e o
      // instalador só começa depois que a janela fechou de verdade.
      atual.once('closed', () => autoUpdater.quitAndInstall(true, true));
      atual.close();
    });
  });

  const procurar = () => void autoUpdater.checkForUpdates().catch((e) => registrar('erro', 'Falha ao procurar a versão nova:', e));
  procurar();
  setInterval(procurar, INTERVALO_MS).unref();
}
