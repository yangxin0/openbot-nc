import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Bu Slack çalışma alanı bağlı değil.",
  "error.messaging.whatsappNotConnected": "Bu WhatsApp numarası bağlı değil.",
  "error.messaging.whatsappUnsupported": "Bu bilgisayar WhatsApp'a bağlanamıyor.",
  "error.messaging.whatsappTooManySenders": "Bir WhatsApp numarası en fazla 200 kişiye ve gruba izin verebilir.",
  "error.messaging.whatsappNumberNotFound":
    "Bu numaranın WhatsApp hesabı yok. Numarayı ülke koduyla yazın, örneğin +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "Bu kişi veya grup artık listede değil.",
  "error.messaging.whatsappRequestEnded": "Bu istek sona erdi. Yeni bir kod için kişiden tekrar yazmasını isteyin.",
  "error.messaging.memoryLimit": "Bağlı bir çalışma alanı en fazla {limit} belleğe sahip olabilir. Önce birini silin.",
} as const satisfies PartialTranslation<typeof source>;
