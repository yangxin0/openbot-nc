import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "O OpenBot-NC não conseguiu iniciar",
  "startup.failedBody":
    "{message}\n\nSeus dados locais não foram redefinidos nem sobrescritos. Consulte o guia de solução de problemas para ver os passos de recuperação.",
  "startup.archiveChangedTitle": "Arquivos do OpenBot-NC foram alterados",
  "startup.archiveChangedBody":
    "Outro programa alterou o arquivo app.asar do OpenBot-NC. O OpenBot-NC funciona agora, mas não vai abrir depois que você fechá-lo.\n\nPara reparar, instale o OpenBot-NC novamente. Seus dados locais são mantidos.",
  "startup.filesDamagedBody":
    "Alguns arquivos do OpenBot-NC estão danificados ou faltando.\n\nPara reparar, instale o OpenBot-NC novamente. Seus dados locais são mantidos.",
  "startup.newerDataTitle": "Instale o OpenBot-NC mais recente",
  "startup.newerDataBody":
    "Uma versão mais recente do OpenBot-NC salvou seus dados, e esta versão ({version}) não consegue abri-los. Instale a versão mais recente para abrir seus dados.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataQuit": "Sair",
  "startup.newerDataLoopTitle": "A versão mais recente do OpenBot-NC não abriu",
  "startup.newerDataLoopBody":
    "Uma versão mais recente do OpenBot-NC salvou seus dados, e esta versão ({version}) não consegue abri-los. O OpenBot-NC {loopVersion} parou antes de abrir várias vezes seguidas, então ele não será instalado de novo.\n\nInstale uma versão mais recente que a {loopVersion} quando houver uma disponível. Para obter ajuda, abra o guia.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.recoveryWindowTitle": "Recuperação do OpenBot-NC",
  "startup.recoveryTitle": "O OpenBot-NC não abriu",
  "startup.recoveryBody": {
    one: "O OpenBot-NC {version} parou antes de abrir, {count} vez seguida. Seus dados locais não foram redefinidos nem substituídos.",
    other:
      "O OpenBot-NC {version} parou antes de abrir, {count} vezes seguidas. Seus dados locais não foram redefinidos nem substituídos.",
  },
  "startup.recoveryHint":
    "Tente novamente ou instale a última versão que abriu. Para obter ajuda, exporte o diagnóstico e envie o arquivo com seu relato.",
  "startup.recoveryHintLatest":
    "O OpenBot-NC não encontrou uma versão anterior que consiga abrir seus dados. Tente novamente ou instale a versão mais recente. Para obter ajuda, exporte o diagnóstico e envie o arquivo com seu relato.",
  "startup.recoveryRetry": "Tentar de novo",
  "startup.recoveryExportDiagnostics": "Exportar diagnóstico",
  "startup.recoveryOpenDataFolder": "Abrir pasta de dados",
  "startup.recoveryQuit": "Sair",
  "startup.recoveryDiagnosticsSaved": "O arquivo de diagnóstico foi salvo.",
  "startup.recoveryActionFailed": "O OpenBot-NC não conseguiu fazer esta ação.",
} as const satisfies PartialTranslation<typeof source>;
