import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Paylaştığınız içerik okunuyor…",
  "mobile.share.readFailed": "OpenBot paylaştığınız içeriği okuyamadı. Tekrar paylaşın.",
  "mobile.share.content": "Paylaşılacak",
  "mobile.share.footer":
    "Sohbet, bu içerik mesaj alanında olacak şekilde açılır. Siz gönderene kadar hiçbir şey gönderilmez.",
  "mobile.share.sendFooter": "OpenBot bunu ajana gönderir, sonra sohbeti açar.",
  "mobile.share.lastUsed": "Son kullanılan",
  "mobile.share.noAgents": "Ajan yok",
  "mobile.share.chooseAgent": "Bir ajan seçin",
  "mobile.share.action": "{name} ile paylaş",
  "mobile.share.extension.send": "Gönder",
  "mobile.share.extension.message": "Mesaj ekle",
  "mobile.share.extension.sending": "{name} adlı ajana gönderiliyor…",
} as const satisfies PartialTranslation<typeof source>;
