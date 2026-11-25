import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.reading": "Lecture du contenu partagé…",
  "mobile.share.readFailed": "OpenBot-NC n’a pas pu lire ce que vous avez partagé. Partagez-le à nouveau.",
  "mobile.share.content": "À partager",
  "mobile.share.footer":
    "La discussion s’ouvre avec ce contenu dans le champ de message. Rien n’est envoyé tant que vous ne l’envoyez pas.",
  "mobile.share.sendFooter": "OpenBot-NC envoie ceci à l’agent, puis ouvre la discussion.",
  "mobile.share.lastUsed": "Utilisé en dernier",
  "mobile.share.noAgents": "Aucun agent",
  "mobile.share.chooseAgent": "Choisissez un agent",
  "mobile.share.action": "Partager avec {name}",
  "mobile.share.extension.send": "Envoyer",
  "mobile.share.extension.message": "Ajouter un message",
  "mobile.share.extension.sending": "Envoi à {name}…",
} as const satisfies PartialTranslation<typeof source>;
