import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "Cargando las preferencias de chat locales: {reason}",
  "status.remote.stageConnection": "Conectando con el escritorio: {reason}",
  "status.remote.stageCompatibility": "Comprobando la compatibilidad del escritorio: {reason}",
  "status.remote.stageAgents": "Cargando agentes: {reason}",
  "status.remote.stageReads": "Cargando el estado de lectura: {reason}",
  "status.remote.suspendedDetail":
    "Actualiza OpenBot-NC Mobile o la aplicación de escritorio antes de conectarte.\n{detail}",
  "status.remote.cooldownDetail":
    "La conexión falló tras {limit} intentos. Nuevo intento en {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "La conexión falló tras {limit} intentos. Nuevo intento en {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Conexión perdida. Nuevo intento en {count} s.\n{detail}",
    other: "Conexión perdida. Nuevo intento en {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Conexión perdida. Nuevo intento en {count} s.",
    other: "Conexión perdida. Nuevo intento en {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "El intento de conexión falló. Nuevo intento en {count} s.\n{detail}",
    other: "El intento de conexión falló. Nuevo intento en {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "El intento de conexión falló. Nuevo intento en {count} s.",
    other: "El intento de conexión falló. Nuevo intento en {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconectando {attempt}/{count}\n{detail}",
    other: "Reconectando {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Reconectando {attempt}/{count}",
    other: "Reconectando {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[{size} MB de este mensaje no se muestran en este dispositivo. Ábrelo en el ordenador que ejecuta el servidor para leerlo completo.]",
} as const satisfies PartialTranslation<typeof source>;
