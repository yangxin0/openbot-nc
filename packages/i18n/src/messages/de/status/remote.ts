import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "Lokale Chateinstellungen werden geladen: {reason}",
  "status.remote.stageConnection": "Verbindung zum Desktop wird hergestellt: {reason}",
  "status.remote.stageCompatibility": "Desktop-Kompatibilität wird geprüft: {reason}",
  "status.remote.stageAgents": "Agenten werden geladen: {reason}",
  "status.remote.stageReads": "Lesestatus wird geladen: {reason}",
  "status.remote.suspendedDetail":
    "Aktualisiere OpenBot-NC Mobile oder die Desktop-App, bevor du dich verbindest.\n{detail}",
  "status.remote.cooldownDetail":
    "Verbindung nach {limit} Versuchen fehlgeschlagen. Neuer Versuch in {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Verbindung nach {limit} Versuchen fehlgeschlagen. Neuer Versuch in {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Verbindung verloren. Neuer Versuch in {count} s.\n{detail}",
    other: "Verbindung verloren. Neuer Versuch in {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Verbindung verloren. Neuer Versuch in {count} s.",
    other: "Verbindung verloren. Neuer Versuch in {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.\n{detail}",
    other: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.",
    other: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Verbindung wird wiederhergestellt {attempt}/{count}\n{detail}",
    other: "Verbindung wird wiederhergestellt {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Verbindung wird wiederhergestellt {attempt}/{count}",
    other: "Verbindung wird wiederhergestellt {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[{size} MB dieser Nachricht werden auf diesem Gerät nicht angezeigt. Öffnen Sie sie auf dem Computer, auf dem der Server läuft, um sie ganz zu lesen.]",
} as const satisfies PartialTranslation<typeof source>;
