import { lazy } from "solid-js";

export const AgentUsagePanel = lazy(() =>
  import("./features/usage/AgentUsagePanel").then((module) => ({ default: module.AgentUsagePanel })),
);
export const LibraryPanel = lazy(() =>
  import("./features/files/LibraryPanel").then((module) => ({ default: module.LibraryPanel })),
);
export const CrmPage = lazy(() => import("./features/crm/CrmPage").then((module) => ({ default: module.CrmPage })));
export const CrmScreen = lazy(() =>
  import("./features/crm/CrmScreen").then((module) => ({ default: module.CrmScreen })),
);
export const ServerLibrary = lazy(() =>
  import("./features/files/ServerLibrary").then((module) => ({ default: module.ServerLibrary })),
);
export const DirectConversation = lazy(() =>
  import("@openbot/ui/features/conversation/DirectConversation").then((module) => ({
    default: module.DirectConversation,
  })),
);
export const GlobalSearch = lazy(() =>
  import("@openbot/ui/components/GlobalSearch").then((module) => ({ default: module.GlobalSearch })),
);
export const CreateLocalServerDialog = lazy(() =>
  import("@openbot/ui/features/servers/CreateLocalServerDialog").then((module) => ({
    default: module.CreateLocalServerDialog,
  })),
);
export const FirstRunFlow = lazy(() =>
  import("./features/onboarding/FirstRunFlow").then((module) => ({ default: module.FirstRunFlow })),
);
export const LanguageStep = lazy(() =>
  import("./features/onboarding/LanguageStep").then((module) => ({ default: module.LanguageStep })),
);
export const ServerSettingsModal = lazy(() =>
  import("./features/servers/ServerSettingsModal").then((module) => ({ default: module.ServerSettingsModal })),
);
export const SettingsModal = lazy(() =>
  import("./features/settings/SettingsModal").then((module) => ({ default: module.SettingsModal })),
);
export const MarketplaceModal = lazy(() =>
  import("./features/settings/MarketplaceModal").then((module) => ({ default: module.MarketplaceModal })),
);
export const WorkflowsPage = lazy(() =>
  import("./features/workflows/WorkflowsPage").then((module) => ({ default: module.WorkflowsPage })),
);
export const WorkflowsCanvas = lazy(() =>
  import("./features/workflows/WorkflowsCanvas").then((module) => ({ default: module.WorkflowsCanvas })),
);
export const ScheduleView = lazy(() =>
  import("./features/schedule/SchedulePanel").then((module) => ({ default: module.ScheduleView })),
);
export const TasksView = lazy(() =>
  import("./features/tasks/TasksView").then((module) => ({ default: module.TasksView })),
);
export const ServerOnboarding = lazy(() =>
  import("./features/onboarding/ServerOnboarding").then((module) => ({ default: module.ServerOnboarding })),
);
