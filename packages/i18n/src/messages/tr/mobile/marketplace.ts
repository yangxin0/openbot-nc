import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/marketplace";

export const messages = {
  "mobile.marketplace.app.slackTagline": "Slack'te bahsetmeler ve doğrudan mesajlar",
  "mobile.marketplace.app.discordTagline": "Discord'da bahsetmeler ve doğrudan mesajlar",
  "mobile.marketplace.app.telegramTagline": "Telegram'da gruplar ve doğrudan sohbetler",
  "mobile.marketplace.app.whatsappTagline": "WhatsApp'ta kendi sohbetiniz ve izin verdiğiniz kişiler",
  "mobile.marketplace.app.githubTagline": "Depolar, sorunlar ve çekme istekleri",
  "mobile.marketplace.app.onePasswordTagline": "Paylaştığınız oturum bilgileriyle sitelerde oturum açın",
  "mobile.marketplace.app.bitwardenTagline": "Paylaşılan bir klasördeki oturum bilgileriyle sitelerde oturum açın",
  "mobile.marketplace.app.protonPassTagline": "Paylaşılan bir kasadaki oturum bilgileriyle sitelerde oturum açın",
  "mobile.marketplace.error.signInUnsupported":
    "Telefondan uygulamalarda oturum açmak için sunucudaki OpenBot-NC'yi güncelleyin.",
  "mobile.marketplace.app.connect": "Bağlan",
  "mobile.marketplace.app.signInIntro": "Uygulamanın sayfasında oturum açın. Oturumu bu telefon değil, sunucu saklar.",
  "mobile.marketplace.app.stepOpen": "{name} giriş sayfasını açın.",
  "mobile.marketplace.app.stepAllow": "Giriş yapın ve erişime izin verin.",
  "mobile.marketplace.app.stepBlank": "Son sayfa yüklenmez. Bu doğrudur.",
  "mobile.marketplace.app.stepCopy": "Adres çubuğuna dokunun ve adresin tamamını kopyalayın.",
  "mobile.marketplace.app.stepPaste": "OpenBot-NC'ye dönün ve adresi aşağıya yapıştırın.",
  "mobile.marketplace.app.connected": "Bağlandı",
  "mobile.marketplace.app.connectFailed": "Uygulama bağlanamadı.",
  "mobile.marketplace.app.waiting": "Oturum açma sayfası bekleniyor…",
  "mobile.marketplace.app.openAgain": "Oturum açma sayfasını yeniden aç",
  "mobile.marketplace.app.pasteLabel": "Oturum açma sonrası adres",
  "mobile.marketplace.app.pasteInvalid": "Bu adres, bu oturum açma işleminin sonu değil.",
  "mobile.marketplace.app.finishSignIn": "Oturum açmayı bitir",
  "mobile.marketplace.app.openFailed": "Oturum açma sayfası açılamadı.",
} as const satisfies PartialTranslation<typeof source>;
