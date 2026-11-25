import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Wzmianki i wiadomości bezpośrednie w Slacku",
  "mobile.marketplace.app.discordTagline": "Wzmianki i wiadomości bezpośrednie na Discordzie",
  "mobile.marketplace.app.telegramTagline": "Grupy i czaty prywatne w Telegramie",
  "mobile.marketplace.app.whatsappTagline": "Własny czat i dozwolone osoby w WhatsApp",
  "mobile.marketplace.app.githubTagline": "Repozytoria, zgłoszenia i pull requesty",
  "mobile.marketplace.app.onePasswordTagline": "Loguj się do witryn danymi logowania, które udostępniasz",
  "mobile.marketplace.app.bitwardenTagline": "Loguj się do witryn danymi logowania z udostępnionego folderu",
  "mobile.marketplace.app.protonPassTagline": "Loguj się do witryn danymi logowania z udostępnionego sejfu",
  "mobile.marketplace.error.signInUnsupported":
    "Zaktualizuj OpenBot-NC na serwerze, aby logować się do aplikacji z telefonu.",
  "mobile.marketplace.app.connect": "Połącz",
  "mobile.marketplace.app.signInIntro":
    "Zaloguj się na stronie aplikacji. Logowanie przechowuje serwer, nie ten telefon.",
  "mobile.marketplace.app.stepOpen": "Otwórz stronę logowania {name}.",
  "mobile.marketplace.app.stepAllow": "Zaloguj się i zezwól na dostęp.",
  "mobile.marketplace.app.stepBlank": "Ostatnia strona się nie wczyta. To prawidłowe.",
  "mobile.marketplace.app.stepCopy": "Stuknij pasek adresu i skopiuj cały adres.",
  "mobile.marketplace.app.stepPaste": "Wróć do OpenBot-NC i wklej adres poniżej.",
  "mobile.marketplace.app.connected": "Połączono",
  "mobile.marketplace.app.connectFailed": "Nie udało się połączyć aplikacji.",
  "mobile.marketplace.app.waiting": "Oczekiwanie na stronę logowania…",
  "mobile.marketplace.app.openAgain": "Otwórz ponownie stronę logowania",
  "mobile.marketplace.app.pasteLabel": "Adres po zalogowaniu",
  "mobile.marketplace.app.pasteInvalid": "Ten adres nie jest końcem tego logowania.",
  "mobile.marketplace.app.finishSignIn": "Zakończ logowanie",
  "mobile.marketplace.app.openFailed": "Nie udało się otworzyć strony logowania.",
} as const satisfies PartialTranslation<typeof source>;
