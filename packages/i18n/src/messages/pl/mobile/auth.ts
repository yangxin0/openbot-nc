import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animuj logo OpenBot-NC",
  "mobile.auth.logo.animateHint": "Logo puszcza oko",
  "mobile.auth.scanner.connectFailed": "Nie udało się połączyć",
  "mobile.auth.scanner.codeFailed": "Nie udało się użyć tego kodu",
  "mobile.auth.scanner.scanAgain": "Skanuj ponownie",
  "mobile.auth.scanner.connecting": "Łączenie telefonu…",
  "mobile.auth.scanner.readingInvitation": "Odczytywanie zaproszenia…",
  "mobile.auth.scanner.scanDesktop": "Zeskanuj kod z komputera",
  "mobile.auth.scanner.scanInvitation": "Zeskanuj kod zaproszenia",
  "mobile.auth.scanner.verifying": "Weryfikowanie kodu jednorazowego.",
  "mobile.auth.scanner.checkingServer": "Sprawdzanie tożsamości serwera.",
  "mobile.auth.scanner.keepCentered": "Trzymaj kod QR na środku ramki.",
  "mobile.auth.scanner.connectFallback": "Nie udało się połączyć tego telefonu.",
  "mobile.auth.scanner.cameraFailed": "Nie udało się uruchomić aparatu. Spróbuj ponownie.",
  "mobile.auth.camera.title": "Wymagany dostęp do aparatu",
  "mobile.auth.camera.pairingReason":
    "OpenBot-NC używa aparatu tylko do zeskanowania jednorazowego kodu QR z aplikacji na komputer.",
  "mobile.auth.camera.invitationReason": "OpenBot-NC używa aparatu tylko do zeskanowania kodu QR zaproszenia.",
  "mobile.auth.camera.blocked":
    "Dostęp do aparatu jest zablokowany. Włącz go dla OpenBot-NC w ustawieniach urządzenia, a potem wróć tutaj, aby zeskanować kod.",
  "mobile.auth.camera.allow": "Zezwól na dostęp do aparatu",
  "mobile.auth.camera.openSettings": "Otwórz ustawienia",
  "mobile.auth.error.signOutUnconfirmed":
    "Nie udało się potwierdzić wylogowania. Sprawdź połączenie i spróbuj ponownie.",
} as const satisfies PartialTranslation<typeof source>;
