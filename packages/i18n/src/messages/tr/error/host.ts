import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.nameBeforePublish": "Yayımlamadan önce bu OpenBot-NC'ye bir ad verin.",
  "error.host.publishBeforeInvite": "Davet oluşturmadan önce bu OpenBot-NC'yi herkese açık hale getirin.",
  "error.host.teamAccessUnavailable": "Ekip erişiminiz kullanılamıyor.",
  "error.host.ownerIdentityUnavailable": "Ana makine sahibi kimliği kullanılamıyor.",
  "error.host.publishFailed": "Bu OpenBot-NC yayımlanamadı.",
  "error.host.noServer": "Bu bilgisayarda değiştirilecek bir sunucu yok.",
  "error.host.identityLocalOnly": "Sunucu adı ve logosu yalnızca onu çalıştıran bilgisayarda değiştirilebilir.",
  "error.host.timezoneInvalid": "Bu saat dilimi bilinmiyor.",
  "error.host.turnLimitInvalid": "Bu iş parçacığı sınırı geçerli değil.",
  "error.host.maintenanceInterrupted":
    "Ana makine bakımı kesintiye uğradı. Tekrar denemeden önce uygulamayı doğrulayın ve ana makine durumunu sıfırlayın.",
  "error.host.updateFailed":
    "{phase} sırasında ana makine güncellemesi başarısız oldu. Durumu sıfırlamadan önce paket sahipliğini, imzalamayı, kiracı durumunu ve boş disk alanını doğrulayın.",
  "error.host.tenantsNotIdle": "Kiracılar iki saat içinde beş dakika boşta kalmadı.",
  "error.host.tenantShutdownTimeout": "Kiracı kapatması zaman aşımına uğradı. Hiçbir uygulama değişimi başlatılmadı.",
  "error.host.tenantHealthMissing":
    "Yeniden başlatmanın ardından kiracı sağlık raporları eksik veya sağlıksız. Başka bir güncellemeden önce kiracı oturumlarını inceleyin.",
  "error.host.personalityInvalid": "Bu yanıt stili bilinmiyor.",
} as const satisfies PartialTranslation<typeof source>;
