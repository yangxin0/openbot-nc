import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Bu adrese adıyla ulaşılamıyor.",
  "error.mcp.redirectNotSignIn": "Bu adres bir oturum açma işleminin parçası değil.",
  "error.mcp.redirectRefused": "Oturum açma reddedildi. OpenBot-NC'ye geri dönün ve tekrar deneyin.",
  "error.mcp.redirectNoSignIn":
    "Bu oturum açma işlemi artık etkin değil. OpenBot-NC'ye dönün ve oturum açmayı yeniden başlatın.",
  "error.mcp.redirectSignedIn": "OpenBot-NC oturumu açıldı. Bu pencereyi kapatabilirsiniz.",
  "error.mcp.redirectNotSaved": "Oturum açma tamamlanmadı. Nedenini görmek için OpenBot-NC'ye dönün.",
  "error.mcp.signInFileUnreadable": "MCP oturum açma dosyası okunamıyor.",
  "error.mcp.signInFileTooLarge": "MCP oturum açma dosyası çok büyük.",
  "error.mcp.unsupported": "MCP sunucuları bu sunucu tarafından desteklenmiyor.",
  "error.mcp.signInOnHost": "Bir MCP sunucusunda oturum açma yalnızca ana makinedeki OpenBot-NC'de çalışır.",
  "error.mcp.signInPageOnServer":
    "Bu oturum açma sayfası yalnızca sunucuda açılır. Sunucunun sahibinden veya yöneticisinden oturum açmasını isteyin.",
  "error.mcp.signInPageOnServerSwitch":
    "Bu oturum açma sayfası yalnızca sunucuda açılır. Bu sunucuya geçin, ardından yeniden Oturum aç'ı seçin.",
  "error.mcp.signInAppUnsupported":
    "Bu sunucu oturum açma uygulamalarını desteklemiyor. Ana makinedeki OpenBot-NC'yi güncelleyin.",
  "error.mcp.redirectRelayed": "OpenBot-NC oturum açmayı sunucuya gönderdi. Bu pencereyi kapatabilirsiniz.",
  "error.mcp.relayEnded": "Bu oturum açma sona erdi. Yeniden başlatın.",
  "error.mcp.signInLinkNotReady": "Giriş sayfası henüz açılmadı. Biraz sonra yeniden dene.",
  "error.mcp.relayNoState":
    "Sunucunun oturum açma sayfası dönüş adresini korumuyor, bu yüzden OpenBot-NC onu bu bilgisayarda açmaz.",
  "error.mcp.relayAddressInvalid": "Bu, bu oturum açmanın sonundaki adres değil. Tarayıcıdan tam adresi kopyalayın.",
} as const satisfies PartialTranslation<typeof source>;
