import type { SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { BitwardenTile, OnePasswordTile, ProtonPassTile, WhatsAppTile } from "../settings/brand-marks";
import type { ConnectorId } from "./connectors";

export interface ConnectorListing {
  title: AppTextKey;
  tagline: AppTextKey;
  category: SkillCategory;
  Mark: () => JSX.Element;
}

export const CONNECTOR_LISTINGS: Readonly<Record<ConnectorId, ConnectorListing>> = {
  whatsapp: {
    title: "connector.whatsapp.title",
    tagline: "marketplace.app.whatsappTagline",
    category: "productivity",
    Mark: () => <WhatsAppTile />,
  },
  onepassword: {
    title: "connector.onePassword.title",
    tagline: "marketplace.app.onePasswordTagline",
    category: "productivity",
    Mark: () => <OnePasswordTile />,
  },
  bitwarden: {
    title: "connector.bitwarden.title",
    tagline: "marketplace.app.bitwardenTagline",
    category: "productivity",
    Mark: () => <BitwardenTile />,
  },
  protonpass: {
    title: "connector.protonPass.title",
    tagline: "marketplace.app.protonPassTagline",
    category: "productivity",
    Mark: () => <ProtonPassTile />,
  },
};
