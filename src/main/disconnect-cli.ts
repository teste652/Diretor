// Roda no desinstalador do Windows (Diretor.exe com ELECTRON_RUN_AS_NODE=1, veja
// build/installer.nsh): tira o Diretor da configuração do Claude Desktop, só a entrada
// que aponta para esta instalação, para o Claude não ficar tentando abrir um programa
// que não existe mais. Nunca impede a desinstalação: sai sempre com 0.
import { claudeConfigCandidates, disconnectClaude } from './claudeDesktop';

disconnectClaude(claudeConfigCandidates(), process.execPath)
  .then((results) => {
    for (const r of results) console.log(`${r.state}: ${r.file}${'error' in r ? ` (${r.error})` : ''}`);
  })
  .catch((e: unknown) => console.error(e))
  .finally(() => process.exit(0));
