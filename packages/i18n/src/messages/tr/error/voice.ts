import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Ses modeli indirilemedi. Tekrar deneyin.",
  "error.voice.downloadStopped": "Ses modeli indirmesi durduruldu.",
  "error.voice.removeBusy": "Ses dökümü bitene kadar bekleyin, sonra modeli kaldırın.",
  "error.voice.removeFailed": "Ses modeli kaldırılamadı. Tekrar deneyin.",
  "error.voice.runtimeUnavailable": "Yerel ses dökümü bu platformda kullanılamıyor.",
  "error.voice.modelUnavailable": "Ses modeli kullanılamıyor.",
  "error.voice.transcriptionTimedOut": "Ses dökümü zaman aşımına uğradı.",
  "error.voice.prepareRequired":
    "Yerel ses dökümü kullanılamıyor. `bun run voice:prepare` komutunu çalıştırın ve OpenBot'u yeniden başlatın.",
  "error.voice.transcriptionFailed": "OpenBot bu kaydın dökümünü çıkaramadı.",
  "error.voice.videoModelMissing": "Ayarlar → Ses bölümünde kayıtlar için bir konuşma tanıma modeli ayarlanmamış.",
  "error.voice.videoModelMissingServer":
    "Bu sunucuda bir konuşma tanıma modeli ayarlanmamış. Bir sahip veya yönetici, sunucu ayarlarındaki Konuşma tanıma bölümünden bir model ayarlayabilir.",
  "error.voice.cloud.keyRequired": "{provider} API anahtarınızı Ayarlar → Ses bölümünde ekleyin.",
  "error.voice.cloud.keyRejected":
    "{provider} API anahtarını kabul etmedi. Anahtarı Ayarlar → Ses bölümünde kontrol edin.",
  "error.voice.cloud.quotaExceeded": "{provider} kotanız doldu.",
  "error.voice.cloud.rateLimited": "{provider} meşgul. Biraz sonra yeniden deneyin.",
  "error.voice.cloud.termsRequired": "ElevenLabs hesabınızda ElevenLabs koşullarını kabul edin, sonra yeniden deneyin.",
  "error.voice.cloud.streamEnded": "Dikte aktarımı sona erdi. Yeniden kaydedin.",
  "error.voice.cloud.tooLong": "Kayıt çok uzun.",
  "error.voice.cloud.keySaveFailed": "{provider} API anahtarı kaydedilemedi.",
  "error.voice.speech.runtimeUnavailable": "Yerel konuşma sentezi bu platformda kullanılamıyor.",
  "error.voice.speech.modelRequired": "Konuşma modelini Ayarlar → Ses bölümünden indirin.",
  "error.voice.speech.timedOut": "Yanıtı sesli okuma zaman aşımına uğradı.",
  "error.voice.speech.failed": "OpenBot yanıtı sesli okuyamadı.",
  "error.voice.speech.providerRefused": "{provider} sesi oluşturmayı reddetti: {reason}",
  "error.voice.recordingNotKept": "OpenBot ses kaydını saklayamadı.",
  "error.voice.server.modelUnsupported":
    "{host}, {model} ile yazıya dökemiyor. Ayarlar → Ses bölümünde ses sunucusu için başka bir dikte modeli seçin.",
} as const satisfies PartialTranslation<typeof source>;
