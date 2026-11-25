import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot-NC başlatılamadı",
  "startup.failedBody":
    "{message}\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı. Kurtarma adımları için sorun giderme kılavuzuna bakın.",
  "startup.archiveChangedTitle": "OpenBot-NC dosyaları değiştirildi",
  "startup.archiveChangedBody":
    "Başka bir program OpenBot-NC’nin app.asar dosyasını değiştirdi. OpenBot-NC şu an çalışıyor, ancak kapattıktan sonra açılmayacak.\n\nOnarmak için OpenBot-NC’yi yeniden yükleyin. Yerel verileriniz korunur.",
  "startup.filesDamagedBody":
    "Bazı OpenBot-NC dosyaları hasarlı veya eksik.\n\nOnarmak için OpenBot-NC’yi yeniden yükleyin. Yerel verileriniz korunur.",
  "startup.newerDataTitle": "En son OpenBot-NC’yi yükleyin",
  "startup.newerDataBody":
    "OpenBot-NC’nin daha yeni bir sürümü verilerinizi kaydetti ve bu sürüm ({version}) onları açamıyor. Verilerinizi açmak için en son sürümü yükleyin.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataQuit": "Çık",
  "startup.newerDataLoopTitle": "En son OpenBot-NC açılmadı",
  "startup.newerDataLoopBody":
    "OpenBot-NC’nin daha yeni bir sürümü verilerinizi kaydetti ve bu sürüm ({version}) onları açamıyor. OpenBot-NC {loopVersion} art arda birkaç kez açılmadan durdu, bu yüzden yeniden yüklenmiyor.\n\n{loopVersion} sürümünden daha yeni bir sürüm çıktığında onu yükleyin. Yardım almak için kılavuzu açın.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.recoveryWindowTitle": "OpenBot-NC kurtarma",
  "startup.recoveryTitle": "OpenBot-NC açılmadı",
  "startup.recoveryBody": {
    one: "OpenBot-NC {version}, açılmadan önce art arda {count} kez durdu. Yerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
    other:
      "OpenBot-NC {version}, açılmadan önce art arda {count} kez durdu. Yerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  },
  "startup.recoveryHint":
    "Yeniden deneyin veya açılan son sürümü yükleyin. Yardım almak için tanılamayı dışa aktarın ve dosyayı raporunuzla gönderin.",
  "startup.recoveryHintLatest":
    "OpenBot-NC verilerinizi açabilen daha eski bir sürüm bulamadı. Yeniden deneyin veya en son sürümü yükleyin. Yardım almak için tanılamayı dışa aktarın ve dosyayı raporunuzla gönderin.",
  "startup.recoveryRetry": "Yeniden dene",
  "startup.recoveryExportDiagnostics": "Tanılamayı dışa aktar",
  "startup.recoveryOpenDataFolder": "Veri klasörünü aç",
  "startup.recoveryQuit": "Çık",
  "startup.recoveryDiagnosticsSaved": "Tanılama dosyası kaydedildi.",
  "startup.recoveryActionFailed": "OpenBot-NC bu işlemi yapamadı.",
} as const satisfies PartialTranslation<typeof source>;
