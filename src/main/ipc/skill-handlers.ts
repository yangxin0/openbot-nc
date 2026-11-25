import { runCauseEffect } from "../../backend/effect-boundary";
import { localSkillTools } from "../local-skill-tools";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseCreateLocalSkill,
  parseInstallLocalSkill,
  parseReadLocalSkill,
  parseReviseLocalSkill,
} from "./local-skill-inputs";
import { stringPayload } from "./validation";

export interface SkillIpcDependencies {
  skills: SkillMarketplaceService;
}

export function skillIpcHandlers({ skills }: SkillIpcDependencies): Pick<IpcGroupHandlers, "skills"> {
  return {
    skills: {
      localList: handler(async () => (await runCauseEffect(localSkillTools(skills).list())).skills),
      localGet: payloadHandler(parseReadLocalSkill, (input) => runCauseEffect(localSkillTools(skills).get(input))),
      localCreate: payloadHandler(parseCreateLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).create(input)),
      ),
      localRevise: payloadHandler(parseReviseLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).revise(input)),
      ),
      localInstall: payloadHandler(parseInstallLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).install(input)),
      ),
      listInstalled: payloadHandler(stringPayload("agentId"), (agentId) =>
        runCauseEffect(skills.listInstalled(agentId)),
      ),
      install: payloadHandler(parseInstallSkill, (installation) => runCauseEffect(skills.install(installation))),
      uninstall: payloadHandler(parseUninstallSkill, (removal) => runCauseEffect(skills.uninstall(removal))),
      setEnabled: payloadHandler(parseSetEnabledSkill, (change) => runCauseEffect(skills.setEnabled(change))),
    },
  };
}
