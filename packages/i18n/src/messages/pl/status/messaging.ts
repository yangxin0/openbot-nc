import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Pracuję nad tym…",
  "status.messaging.queued": "Oczekiwanie na zakończenie wcześniejszego żądania. Odpowiedź pojawi się tutaj.",
  "status.messaging.busy": "Czeka zbyt wiele żądań. Spróbuj ponownie później.",
  "status.messaging.failed": "OpenBot-NC nie mógł dokończyć tego żądania. Szczegóły są na hoście OpenBot-NC.",
  "status.messaging.noAnswer": "OpenBot-NC zakończył pracę bez odpowiedzi tekstowej.",
  "status.messaging.noAgent": "Żaden agent nie może tu jeszcze odpowiadać. Dodaj Slack Orchestrator w OpenBot-NC.",
  "status.messaging.delegated": "Członek zespołu nad tym pracuje. Odpowiedź pojawi się tutaj.",
  "status.messaging.stopped": "Zatrzymano.",
  "status.messaging.stop": "Zatrzymaj",
  "status.messaging.approvalTitle": "OpenBot-NC prosi o zatwierdzenie, aby kontynuować.",
  "status.messaging.approvalTitleTeammate": "Członek zespołu {agent} prosi o zatwierdzenie, aby kontynuować.",
  "status.messaging.approvalCommand": "Uruchomienie polecenia",
  "status.messaging.approvalFileChange": "Zmiana plików",
  "status.messaging.approvalPermissions": "Dodatkowe uprawnienia",
  "status.messaging.approve": "Zatwierdź",
  "status.messaging.deny": "Odrzuć",
  "status.messaging.approvedBy": "Zatwierdzone przez: {user}.",
  "status.messaging.deniedBy": "Odrzucone przez: {user}.",
  "status.messaging.answeredOnHost": "Odpowiedziano na hoście OpenBot-NC.",
  "status.messaging.requestInactive": "To żądanie nie jest już aktywne.",
  "status.messaging.onlyRequester": "Tylko {user} może to zrobić. Może też odpowiedzieć host OpenBot-NC.",
  "status.messaging.hostOnly": "Na to żądanie może odpowiedzieć tylko host OpenBot-NC.",
  "status.messaging.filesSkipped": "Niektóre pliki nie zostały wysłane: {names}.",
  "status.messaging.integrationsSection": "Integracje",
  "status.messaging.whatsappNoAgent":
    "Żaden agent nie może tu jeszcze odpowiadać. Dodaj WhatsApp Orchestrator w OpenBot-NC.",
  "status.messaging.whatsappApprovalMenu": "Odpowiedz 1, aby zatwierdzić, lub 2, aby odrzucić.",
  "status.messaging.whatsappStopMenu": "Odpowiedz „stop”, aby zatrzymać.",
  "status.messaging.whatsappPairingCode":
    "Ten numer odpowiada tylko osobom, którym pozwolił właściciel. Przekaż właścicielowi ten kod: {code}",
  "status.messaging.whatsappPairingApproved": "Możesz teraz wysyłać prośby na ten numer.",
  "status.messaging.whatsappOwnChat": "Wiadomość do siebie",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot-NC jest połączony*\n\nNapisz tutaj, aby poprosić swoich agentów. WhatsApp Orchestrator odpowiada albo przekazuje pracę właściwemu agentowi.\n\nWyślij *stop*, aby zatrzymać prośbę.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot-NC jest połączony*\n\nOsoby, na które pozwolisz w OpenBot-NC, mogą już pisać na ten numer. Nowa osoba dostaje kod: zatwierdź go w OpenBot-NC w sekcji Prośby.\n\nWyślij *stop*, aby zatrzymać prośbę.",
  "status.messaging.whatsappOtherOpenBot":
    "Z tym numerem WhatsApp jest połączony inny OpenBot-NC, więc możesz dostać dwie odpowiedzi. Aby to naprawić, otwórz Połączone urządzenia w WhatsAppie na telefonie i wyloguj OpenBot-NC, którego nie używasz.",
  "status.messaging.whatsappPaused":
    "OpenBot-NC przestał tu odpowiadać na 10 minut: w krótkim czasie przyszło za dużo wiadomości. Jeśli z tym numerem jest połączony inny OpenBot-NC, otwórz Połączone urządzenia w WhatsAppie na telefonie i wyloguj OpenBot-NC, którego nie używasz.",
  "status.messaging.whatsappNotDelivered": "WhatsApp nie przyjął tej odpowiedzi, więc ta osoba jej nie dostała.",
  "status.messaging.whatsappPartlyDelivered":
    "WhatsApp nie przyjął całej tej odpowiedzi, więc ta osoba dostała tylko jej część.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Odpowiada w WhatsApp i pyta zespół",
} as const satisfies PartialTranslation<typeof source>;
