import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Nie udało się pobrać modelu głosowego. Spróbuj ponownie.",
  "error.voice.downloadStopped": "Pobieranie modelu głosowego zostało zatrzymane.",
  "error.voice.removeBusy": "Poczekaj na koniec transkrypcji głosu, a potem usuń model.",
  "error.voice.removeFailed": "Nie udało się usunąć modelu głosowego. Spróbuj ponownie.",
  "error.voice.runtimeUnavailable": "Lokalna transkrypcja głosu nie jest dostępna na tej platformie.",
  "error.voice.modelUnavailable": "Model głosowy jest niedostępny.",
  "error.voice.transcriptionTimedOut": "Przekroczono limit czasu transkrypcji głosu.",
  "error.voice.prepareRequired":
    "Lokalna transkrypcja głosu jest niedostępna. Uruchom `bun run voice:prepare` i uruchom ponownie OpenBot-NC.",
  "error.voice.transcriptionFailed": "Nie udało się przetranskrybować tego nagrania.",
  "error.voice.videoModelMissing":
    "W sekcji Ustawienia → Głos nie skonfigurowano modelu rozpoznawania mowy dla nagrań.",
  "error.voice.videoModelMissingServer":
    "Na tym serwerze nie skonfigurowano modelu rozpoznawania mowy. Właściciel lub administrator może skonfigurować model w ustawieniach serwera, w sekcji Rozpoznawanie mowy.",
  "error.voice.cloud.keyRequired": "Dodaj klucz API {provider} w sekcji Ustawienia → Głos.",
  "error.voice.cloud.keyRejected": "{provider} nie zaakceptował klucza API. Sprawdź klucz w sekcji Ustawienia → Głos.",
  "error.voice.cloud.quotaExceeded": "Limit {provider} został wyczerpany.",
  "error.voice.cloud.rateLimited": "{provider} jest zajęty. Spróbuj ponownie za chwilę.",
  "error.voice.cloud.termsRequired": "Zaakceptuj warunki ElevenLabs na swoim koncie ElevenLabs i spróbuj ponownie.",
  "error.voice.cloud.streamEnded": "Przesyłanie dyktowania zostało przerwane. Nagraj ponownie.",
  "error.voice.cloud.tooLong": "Nagranie jest za długie.",
  "error.voice.cloud.keySaveFailed": "Nie udało się zapisać klucza API {provider}.",
  "error.voice.speech.runtimeUnavailable": "Lokalna synteza mowy nie jest dostępna na tej platformie.",
  "error.voice.speech.modelRequired": "Pobierz model syntezy mowy w Ustawienia → Głos.",
  "error.voice.speech.timedOut": "Czytanie odpowiedzi na głos trwało zbyt długo.",
  "error.voice.speech.failed": "OpenBot-NC nie mógł przeczytać odpowiedzi na głos.",
  "error.voice.speech.providerRefused": "{provider} odmówił utworzenia dźwięku: {reason}",
  "error.voice.recordingNotKept": "OpenBot-NC nie mógł zachować nagrania głosowego.",
  "error.voice.server.modelUnsupported":
    "{host} nie może transkrybować za pomocą {model}. W Ustawienia → Głos wybierz inny model dyktowania dla serwera głosowego.",
} as const satisfies PartialTranslation<typeof source>;
