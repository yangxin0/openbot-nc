import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Impossible de télécharger le modèle vocal. Réessayez.",
  "error.voice.downloadStopped": "Le téléchargement du modèle vocal a été arrêté.",
  "error.voice.removeBusy": "Attendez la fin de la transcription vocale, puis retirez le modèle.",
  "error.voice.removeFailed": "Impossible de retirer le modèle vocal. Réessayez.",
  "error.voice.runtimeUnavailable": "La transcription vocale locale n’est pas disponible sur cette plateforme.",
  "error.voice.modelUnavailable": "Le modèle vocal est indisponible.",
  "error.voice.transcriptionTimedOut": "La transcription vocale a expiré.",
  "error.voice.prepareRequired":
    "La transcription vocale locale est indisponible. Exécutez `bun run voice:prepare` et redémarrez OpenBot-NC.",
  "error.voice.transcriptionFailed": "OpenBot-NC n’a pas pu transcrire cet enregistrement.",
  "error.voice.videoModelMissing":
    "Aucun modèle de reconnaissance vocale pour les enregistrements n’est configuré dans Réglages → Voix.",
  "error.voice.videoModelMissingServer":
    "Aucun modèle de reconnaissance vocale n’est configuré sur ce serveur. Un propriétaire ou un administrateur peut configurer un modèle dans les réglages du serveur, dans Reconnaissance vocale.",
  "error.voice.cloud.keyRequired": "Ajoutez votre clé API {provider} dans Réglages → Voix.",
  "error.voice.cloud.keyRejected": "{provider} n’a pas accepté la clé API. Vérifiez la clé dans Réglages → Voix.",
  "error.voice.cloud.quotaExceeded": "Votre quota {provider} est épuisé.",
  "error.voice.cloud.rateLimited": "{provider} est occupé. Réessayez dans un instant.",
  "error.voice.cloud.termsRequired":
    "Acceptez les conditions d’ElevenLabs dans votre compte ElevenLabs, puis réessayez.",
  "error.voice.cloud.streamEnded": "Le flux de dictée s’est arrêté. Enregistrez à nouveau.",
  "error.voice.cloud.tooLong": "L’enregistrement est trop long.",
  "error.voice.cloud.keySaveFailed": "Impossible d’enregistrer la clé API {provider}.",
  "error.voice.speech.runtimeUnavailable": "La synthèse vocale locale n’est pas disponible sur cette plateforme.",
  "error.voice.speech.modelRequired": "Téléchargez le modèle de synthèse vocale dans Réglages → Voix.",
  "error.voice.speech.timedOut": "La lecture à voix haute de la réponse a expiré.",
  "error.voice.speech.failed": "OpenBot-NC n’a pas pu lire la réponse à voix haute.",
  "error.voice.speech.providerRefused": "{provider} a refusé de créer l’audio : {reason}",
  "error.voice.recordingNotKept": "OpenBot-NC n’a pas pu conserver l’enregistrement vocal.",
  "error.voice.server.modelUnsupported":
    "{host} ne peut pas transcrire avec {model}. Dans Réglages → Voix, choisissez un autre modèle de dictée pour le serveur vocal.",
} as const satisfies PartialTranslation<typeof source>;
