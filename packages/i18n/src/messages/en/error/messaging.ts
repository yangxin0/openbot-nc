import { defineMessages } from "../../../message";

export const messages = defineMessages("error.messaging", {
  "error.messaging.notConnected": "This Slack workspace is not connected.",
  "error.messaging.whatsappNotConnected": "This WhatsApp number is not connected.",
  "error.messaging.whatsappUnsupported": "This computer cannot connect to WhatsApp.",
  "error.messaging.whatsappTooManySenders": "A WhatsApp number can allow up to 200 contacts and groups.",
  "error.messaging.whatsappNumberNotFound":
    "This number has no WhatsApp account. Type it with its country code, such as +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "This contact or group is not on the list now.",
  "error.messaging.whatsappRequestEnded": "This request ended. Ask the person to write again for a new code.",
  "error.messaging.memoryLimit": "A connected workspace can have up to {limit} memories. Delete one first.",
});
