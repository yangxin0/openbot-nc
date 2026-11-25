import type { SkillCategory } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

export const CATEGORY_LABELS = {
  coding: "marketplace.category.coding",
  design: "marketplace.category.design",
  "data-analytics": "marketplace.category.dataAnalytics",
  documents: "marketplace.category.documents",
  productivity: "marketplace.category.productivity",
  research: "marketplace.category.research",
  automation: "marketplace.category.automation",
  other: "marketplace.category.other",
} as const satisfies Record<SkillCategory, AppTextKey>;
