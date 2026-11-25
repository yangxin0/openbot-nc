import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/billing";

export const messages = {
  "billing.plan.starter": "Starter",
  "billing.plan.standard": "Standard",
  "billing.plan.pro": "Pro",
  "billing.license.description": "Voor werk bij een bedrijf. Er is geen server bij inbegrepen.",
  "billing.license.contact.action": "Contact opnemen",
  "billing.license.change.more": { other: "Meer dan {count}" },
  "billing.license.change.custom": "Op maat",
  "billing.license.change.customDescription": {
    one: "Voor meer dan {count} gebruiker spreken we de prijs en de voorwaarden met je af.",
    other: "Voor meer dan {count} gebruikers spreken we de prijs en de voorwaarden met je af.",
  },
  "billing.order.cta.download": "Downloaden",
} as const satisfies PartialTranslation<typeof source>;
