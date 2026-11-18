// Roda no desinstalador do Windows (Diretor.exe com ELECTRON_RUN_AS_NODE=1, veja
// build/installer.nsh): tira o Diretor da configuração do Claude Desktop, só a entrada
// que aponta para esta instalação, para o Claude não ficar tentando abrir um programa
// que não existe mais. Nunca impede a desinstalação: sai sempre com 0.
//   --verificar: não muda nada; sai com 10 se há uma entrada desta instalação para tirar
//   (o desinstalador só pede para fechar o Claude Desktop nesse caso).
import { claudeConfigCandidates, disconnectClaude } from './claudeDesktop';

const dryRun = process.argv.includes('--verificar');
let code = 0;
disconnectClaude(claudeConfigCandidates(), process.execPath, { dryRun })
  .then((results) => {
    for (const r of results) console.log(`${r.state}${dryRun && r.state === 'removed' ? ' (verificar: nada mudou)' : ''}: ${r.file}${'error' in r ? ` (${r.error})` : ''}`);
    if (dryRun && results.some((r) => r.state === 'removed')) code = 10;
  })
  .catch((e: unknown) => console.error(e))
  .finally(() => process.exit(code));
