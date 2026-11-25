import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.stagePreferences": "Lokale chatvoorkeuren laden: {reason}",
  "status.remote.stageConnection": "Verbinden met de desktop: {reason}",
  "status.remote.stageCompatibility": "Compatibiliteit van de desktop controleren: {reason}",
  "status.remote.stageAgents": "Agents laden: {reason}",
  "status.remote.stageReads": "Leesstatus laden: {reason}",
  "status.remote.suspendedDetail": "Werk OpenBot Mobile of de desktop-app bij voordat je verbinding maakt.\n{detail}",
  "status.remote.cooldownDetail":
    "Verbinding mislukt na {limit} pogingen. Opnieuw proberen over {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Verbinding mislukt na {limit} pogingen. Opnieuw proberen over {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Verbinding verbroken. Opnieuw proberen over {count} s.\n{detail}",
    other: "Verbinding verbroken. Opnieuw proberen over {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Verbinding verbroken. Opnieuw proberen over {count} s.",
    other: "Verbinding verbroken. Opnieuw proberen over {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.\n{detail}",
    other: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.",
    other: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Opnieuw verbinden {attempt}/{count}\n{detail}",
    other: "Opnieuw verbinden {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Opnieuw verbinden {attempt}/{count}",
    other: "Opnieuw verbinden {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[{size} MB van dit bericht wordt niet getoond op dit apparaat. Open het op de computer waarop de server draait om alles te lezen.]",
} as const satisfies PartialTranslation<typeof source>;
