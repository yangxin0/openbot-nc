import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CentralAuthManager } from "../central-auth-manager";
import type { HostService } from "../host-service";
import { createHostedMobileConnect, createHostedMobileConnectLink } from "../mobile-connect-host";
import type { RelayService } from "../relay-service";
import { RemoteWorkflowError } from "../remote-service-effects";
import { parseChatColor, parseEmailCodeVerification, parseProfileName } from "./app-inputs";
import { parseAvatarImage } from "./avatar-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AccountIpcDependencies {
  centralAuth: CentralAuthManager;
  refreshServers: () => void;
  host: Pick<HostService, "configure" | "getStatus" | "getMobileConnectHost" | "refreshRegistration">;
  relayHosting: Pick<RelayService, "publishHost">;
}

export function accountIpcHandlers({
  centralAuth,
  host,
  relayHosting,
  refreshServers,
}: AccountIpcDependencies): Pick<IpcGroupHandlers, "auth"> {
  const mobileConnectHost = {
    configure: (input: { serverName: string }) => host.configure(input),
    getStatus: () => host.getStatus(),
    getMobileConnectHost: () => host.getMobileConnectHost(),
    refreshRegistration: () => host.refreshRegistration(),
    start: () => relayHosting.publishHost().pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
  };
  return {
    auth: {
      getState: handler(() => centralAuth.getState()),
      retry: handler(() => runCauseEffect(centralAuth.retry())),
      requestEmailCode: payloadHandler(stringPayload("email", INPUT_LIMITS.email), (email) =>
        runCauseEffect(centralAuth.requestEmailCode(email)),
      ),
      verifyEmailCode: payloadHandler(parseEmailCodeVerification, (verification) =>
        runCauseEffect(
          centralAuth.verifyEmailCode(verification.challengeId, verification.code, verification.referralCode),
        ),
      ),
      updateName: payloadHandler(parseProfileName, (name) => runCauseEffect(centralAuth.updateName(name))),
      updateAvatar: payloadHandler(parseAvatarImage, (parsed) => runCauseEffect(centralAuth.updateAvatar(parsed))),
      updateChatColor: payloadHandler(parseChatColor, (chatColor) =>
        runCauseEffect(centralAuth.updateChatColor(chatColor)),
      ),
      createMobileConnect: handler(() =>
        runCauseEffect(createHostedMobileConnect({ centralAuth, host: mobileConnectHost })),
      ),
      cancelMobileConnect: handler(() => runCauseEffect(centralAuth.cancelMobileConnect(host.getMobileConnectHost()))),
      getMobileConnectLink: handler(() => centralAuth.getMobileConnectLink(host.getMobileConnectHost())),
      createMobileConnectLink: handler(() =>
        runCauseEffect(createHostedMobileConnectLink({ centralAuth, host: mobileConnectHost })),
      ),
      revokeMobileConnectLink: handler(() =>
        runCauseEffect(centralAuth.revokeMobileConnectLink(host.getMobileConnectHost())),
      ),
      listMobileConnectedDevices: handler(() =>
        runCauseEffect(centralAuth.listMobileConnectedDevices(host.getMobileConnectHost())),
      ),
      listAccountSessions: handler(() => runCauseEffect(centralAuth.listAccountSessions())),
      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        runCauseEffect(centralAuth.revokeAccountSession(sessionId)),
      ),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        runCauseEffect(centralAuth.revokeMobileConnectedDevice(sessionId)),
      ),
      logout: handler(() => runCauseEffect(centralAuth.logout())),
      listOwnerTransfers: handler(() => runCauseEffect(centralAuth.incomingOwnerTransfers())),
      acceptOwnerTransfer: payloadHandler(stringPayload("transferId", INPUT_LIMITS.identifier), async (transferId) => {
        const accepted = await runCauseEffect(centralAuth.acceptOwnerTransfer(transferId));
        refreshServers();
        return accepted;
      }),
      declineOwnerTransfer: payloadHandler(stringPayload("transferId", INPUT_LIMITS.identifier), (transferId) =>
        runCauseEffect(centralAuth.declineOwnerTransfer(transferId)),
      ),
    },
  };
}
