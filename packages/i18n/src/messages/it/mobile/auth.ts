import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Anima il logo di OpenBot-NC",
  "mobile.auth.logo.animateHint": "Fa fare l'occhiolino al logo",
  "mobile.auth.scanner.connectFailed": "Impossibile connettersi",
  "mobile.auth.scanner.codeFailed": "Impossibile usare questo codice",
  "mobile.auth.scanner.scanAgain": "Scansiona di nuovo",
  "mobile.auth.scanner.connecting": "Connessione del telefono…",
  "mobile.auth.scanner.readingInvitation": "Lettura dell'invito…",
  "mobile.auth.scanner.scanDesktop": "Scansiona il codice del desktop",
  "mobile.auth.scanner.scanInvitation": "Scansiona il codice dell'invito",
  "mobile.auth.scanner.verifying": "Verifica del codice monouso.",
  "mobile.auth.scanner.checkingServer": "Controllo dell'identità del server.",
  "mobile.auth.scanner.keepCentered": "Tieni il codice QR al centro dell'inquadratura.",
  "mobile.auth.scanner.connectFallback": "OpenBot-NC non è riuscito a connettere questo telefono.",
  "mobile.auth.scanner.cameraFailed": "Impossibile avviare la fotocamera. Riprova.",
  "mobile.auth.camera.title": "Serve l'accesso alla fotocamera",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC usa la fotocamera solo per scansionare il codice QR monouso mostrato nell'app desktop.",
  "mobile.auth.camera.invitationReason": "OpenBot-NC usa la fotocamera solo per scansionare il codice QR dell'invito.",
  "mobile.auth.camera.blocked":
    "L'accesso alla fotocamera è bloccato. Attivalo per OpenBot-NC nelle impostazioni del dispositivo, poi torna qui per scansionare il codice.",
  "mobile.auth.camera.allow": "Consenti l'accesso alla fotocamera",
  "mobile.auth.camera.openSettings": "Apri le impostazioni",
  "mobile.auth.error.signOutUnconfirmed": "Impossibile confermare l'uscita. Controlla la connessione e riprova.",
} as const satisfies PartialTranslation<typeof source>;
