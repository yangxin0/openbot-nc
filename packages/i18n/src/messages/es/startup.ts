import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC no pudo iniciarse",
  "startup.failedBody":
    "{message}\n\nTus datos locales no se han restablecido ni sobrescrito. Consulta la guía de solución de problemas para recuperarlos.",
  "startup.archiveChangedTitle": "Se cambiaron archivos de OpenBot-NC",
  "startup.archiveChangedBody":
    "Otro programa cambió el archivo app.asar de OpenBot-NC. OpenBot-NC funciona ahora, pero no se abrirá después de cerrarlo.\n\nPara repararlo, vuelve a instalar OpenBot-NC. Tus datos locales se conservan.",
  "startup.filesDamagedBody":
    "Algunos archivos de OpenBot-NC están dañados o faltan.\n\nPara repararlo, vuelve a instalar OpenBot-NC. Tus datos locales se conservan.",
  "startup.newerDataTitle": "Instala la última versión de OpenBot-NC",
  "startup.newerDataBody":
    "Una versión más reciente de OpenBot-NC guardó tus datos y esta versión ({version}) no puede abrirlos. Instala la última versión para abrir tus datos.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.newerDataQuit": "Salir",
  "startup.newerDataLoopTitle": "La última versión de OpenBot-NC no se abrió",
  "startup.newerDataLoopBody":
    "Una versión más reciente de OpenBot-NC guardó tus datos y esta versión ({version}) no puede abrirlos. OpenBot-NC {loopVersion} se detuvo antes de abrirse varias veces seguidas, así que no se vuelve a instalar.\n\nInstala una versión más reciente que {loopVersion} cuando esté disponible. Para obtener ayuda, abre la guía.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.recoveryWindowTitle": "Recuperación de OpenBot-NC",
  "startup.recoveryTitle": "OpenBot-NC no se abrió",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version} se detuvo antes de abrirse, {count} vez seguida. Tus datos locales no se restablecieron ni se sobrescribieron.",
    other:
      "OpenBot-NC {version} se detuvo antes de abrirse, {count} veces seguidas. Tus datos locales no se restablecieron ni se sobrescribieron.",
  },
  "startup.recoveryHint":
    "Vuelve a intentarlo o instala la última versión que se abrió. Para obtener ayuda, exporta el diagnóstico y envía el archivo con tu informe.",
  "startup.recoveryHintLatest":
    "OpenBot-NC no encontró una versión anterior que pueda abrir tus datos. Vuelve a intentarlo o instala la última versión. Para obtener ayuda, exporta el diagnóstico y envía el archivo con tu informe.",
  "startup.recoveryRetry": "Reintentar",
  "startup.recoveryExportDiagnostics": "Exportar diagnóstico",
  "startup.recoveryOpenDataFolder": "Abrir carpeta de datos",
  "startup.recoveryQuit": "Salir",
  "startup.recoveryDiagnosticsSaved": "El archivo de diagnóstico se guardó.",
  "startup.recoveryActionFailed": "OpenBot-NC no pudo realizar esta acción.",
} as const satisfies PartialTranslation<typeof source>;
