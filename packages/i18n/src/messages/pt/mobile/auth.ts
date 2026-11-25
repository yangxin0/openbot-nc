import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animar logotipo do OpenBot",
  "mobile.auth.logo.animateHint": "Faz o logotipo piscar",
  "mobile.auth.scanner.connectFailed": "Não foi possível conectar",
  "mobile.auth.scanner.codeFailed": "Não foi possível usar este código",
  "mobile.auth.scanner.scanAgain": "Ler novamente",
  "mobile.auth.scanner.connecting": "Conectando seu celular…",
  "mobile.auth.scanner.readingInvitation": "Lendo o convite…",
  "mobile.auth.scanner.scanDesktop": "Leia o código do computador",
  "mobile.auth.scanner.scanInvitation": "Leia o código do convite",
  "mobile.auth.scanner.verifying": "Verificando o código de uso único.",
  "mobile.auth.scanner.checkingServer": "Verificando a identidade do servidor.",
  "mobile.auth.scanner.keepCentered": "Mantenha o código QR centralizado dentro do quadro.",
  "mobile.auth.scanner.connectFallback": "O OpenBot não conseguiu conectar este celular.",
  "mobile.auth.scanner.cameraFailed": "Não foi possível iniciar a câmera. Tente novamente.",
  "mobile.auth.camera.title": "É necessário permitir o acesso à câmera",
  "mobile.auth.camera.pairingReason":
    "O OpenBot usa a câmera apenas para ler o código QR de uso único mostrado no app para computador.",
  "mobile.auth.camera.invitationReason": "O OpenBot usa a câmera apenas para ler o código QR do convite.",
  "mobile.auth.camera.blocked":
    "O acesso à câmera está bloqueado. Ative-o para o OpenBot nas configurações do dispositivo e volte aqui para ler o código.",
  "mobile.auth.camera.allow": "Permitir acesso à câmera",
  "mobile.auth.camera.openSettings": "Abrir configurações",
  "mobile.auth.error.signOutUnconfirmed":
    "Não foi possível confirmar a saída. Verifique sua conexão e tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
