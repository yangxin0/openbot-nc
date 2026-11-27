import type { ServerCompatibility, ServerConnectionIssue, ServerSummary } from "@openbot/contracts/ipc";
import { TEAM_PROTOCOL_V1, type TeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V3_CAPABILITIES } from "@openbot/contracts/team-protocol/v3";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { isSafeConnectionError } from "@openbot/team-client/remote-recovery";
import { errorReference, referenceFrom } from "@openbot/user-errors";
import { RelaySocketError, type RelaySocketErrorCode } from "./relay/socket";
import {
  RemoteProtocolError,
  RemoteRelayRefusal,
  type RemoteRelayRefusalCode,
  RemoteRequestError,
} from "./remote-server-errors";

export const LOCAL_TEAM_PROTOCOL = { minimum: TEAM_PROTOCOL_V1, maximum: TEAM_PROTOCOL_V10 } as const;

export interface RemoteServerConnectionStatus {
  state: ServerSummary["state"];
  compatibility: ServerCompatibility | null;
  issue: ServerConnectionIssue | null;
  connectionSequence: number;
  capabilitiesPending: boolean;
  hostRestart: ServerSummary["hostRestart"];
}

export interface RemoteConnectionOutcome {
  issue: ServerConnectionIssue | null;
  state: ServerSummary["state"] | null;
  suspendReconnect: boolean;
  hostSupport: TeamProtocolSupportV1 | null;
}

const NO_OUTCOME: RemoteConnectionOutcome = { issue: null, state: null, suspendReconnect: false, hostSupport: null };

export function hostUnreachable(
  reference = "network/fetch",
  message = sourceText("error.remote.hostUnreachable"),
): RemoteConnectionOutcome {
  return {
    issue: {
      code: "network_unavailable",
      message,
      retryable: true,
      reference,
    },
    state: "offline",
    suspendReconnect: false,
    hostSupport: null,
  };
}

export function classifyConnectFailure(failure: unknown): RemoteConnectionOutcome {
  if (failure instanceof DOMException && failure.name === "TimeoutError")
    return hostUnreachable("auth/timeout", sourceText("error.remote.directoryTimeout"));
  const reference = errorReference(failure);
  const message =
    failure instanceof Error && isSafeConnectionError(failure.message)
      ? failure.message
      : reference === null
        ? sourceText("error.remote.connectionNotStarted")
        : undefined;
  return hostUnreachable(reference ?? "transport/connect_failed", message);
}

function relayRefusalMessage(code: RemoteRelayRefusalCode): string {
  switch (code) {
    case "member_disabled":
      return sourceText("error.team.memberDisabled");
    case "certificate_revoked":
      return sourceText("error.remote.relayCertificateRevoked");
    case "certificate_expired":
      return sourceText("error.remote.relayCertificateExpired");
    case "certificate_refused":
      return sourceText("error.remote.relayCertificateRefused");
    case "identity_unusable":
      return sourceText("error.remote.relayIdentityUnusable");
    case "other_team":
      return sourceText("error.remote.relayOtherTeam");
    case "host_certificate_refused":
      return sourceText("error.remote.relayHostCertificateRefused");
    case "relay_server_refused":
      return sourceText("error.remote.relayServerRefused");
    case "identity_changed":
      return sourceText("error.remote.identityNotVerified");
  }
}

export function relayRefusal(code: RemoteRelayRefusalCode): RemoteRelayRefusal {
  return new RemoteRelayRefusal({ code, message: relayRefusalMessage(code) });
}

export function relayRefusalForSocketCode(code: RelaySocketErrorCode): RemoteRelayRefusalCode | null {
  switch (code) {
    case "certificate_revoked":
      return "certificate_revoked";
    case "certificate_expired":
      return "certificate_expired";
    case "authentication_failed":
      return "certificate_refused";
    case "identity_unavailable":
    case "relay_url_missing":
    case "insecure_relay_url":
      return "identity_unusable";
    case "peer_refused":
      return "host_certificate_refused";
    case "server_refused":
      return "relay_server_refused";
    default:
      return null;
  }
}

function relaySocketCodeOf(error: unknown): RelaySocketErrorCode | null {
  if (error instanceof RelaySocketError) return error.code;
  return error instanceof TypeError && error.cause instanceof RelaySocketError ? error.cause.code : null;
}

function relayRefused(code: RemoteRelayRefusalCode): RemoteConnectionOutcome {
  return {
    issue: withReference(
      { code: "authentication_required", message: relayRefusalMessage(code), retryable: false },
      referenceFrom("relay", code),
    ),
    state: "error",
    suspendReconnect: true,
    hostSupport: null,
  };
}

function relayTransportFailure(code: RelaySocketErrorCode): RemoteConnectionOutcome {
  const refusal = relayRefusalForSocketCode(code);
  if (refusal) return relayRefused(refusal);
  return code === "target_unavailable"
    ? relayHostOffline()
    : hostUnreachable(referenceFrom("relay", code) ?? undefined);
}

export function relayHostOffline(): RemoteConnectionOutcome {
  return hostUnreachable("relay/target_unavailable", sourceText("error.remote.hostOffline"));
}

export function classifyRemoteConnectionError(error: unknown): RemoteConnectionOutcome {
  if (error instanceof RemoteRelayRefusal) return relayRefused(error.code);
  const relayCode = relaySocketCodeOf(error);
  if (relayCode !== null) return relayTransportFailure(relayCode);
  if (error instanceof RemoteProtocolError) {
    return {
      issue: withReference(
        { code: error.code, message: error.message, retryable: true },
        referenceFrom("protocol", error.code),
      ),
      state: error.code === "protocol_error" ? "error" : "incompatible",
      suspendReconnect: true,
      hostSupport: error.support,
    };
  }
  if (error instanceof RemoteRequestError) {
    const reference = error.reference ?? referenceFrom("http", error.status, error.code);
    if (error.code === "client_update_required" || error.code === "host_update_required") {
      return {
        issue: withReference(
          {
            code: error.code,
            message:
              error.code === "client_update_required"
                ? sourceText("error.remote.appUpdateRequired")
                : sourceText("error.team.hostUpdateRequired"),
            retryable: true,
          },
          reference,
        ),
        state: "incompatible",
        suspendReconnect: true,
        hostSupport: null,
      };
    }
    if (error.code === "server_safe_mode") {
      return {
        issue: withReference(
          { code: "server_safe_mode", message: sourceText("error.team.serverSafeMode"), retryable: true },
          reference,
        ),
        state: "incompatible",
        suspendReconnect: true,
        hostSupport: null,
      };
    }
    if (error.code === "protocol_error") {
      return {
        issue: withReference(
          {
            code: "protocol_error",
            message:
              error.status >= 500
                ? sourceText("error.remote.invalidData")
                : sourceText("error.remote.hostRefused", { status: error.status }),
            retryable: true,
          },
          reference,
        ),
        state: "error",
        suspendReconnect: true,
        hostSupport: null,
      };
    }
    if (error.status === 401) {
      return {
        issue: withReference(
          {
            code: "authentication_required",
            message: sourceText("error.remote.signInToHostAgain"),
            retryable: true,
          },
          reference,
        ),
        state: "error",
        suspendReconnect: true,
        hostSupport: null,
      };
    }
    return NO_OUTCOME;
  }
  if (error instanceof SyntaxError) {
    return {
      issue: {
        code: "protocol_error",
        message: sourceText("error.remote.invalidData"),
        retryable: true,
        reference: "protocol/invalid_json",
      },
      state: "error",
      suspendReconnect: true,
      hostSupport: null,
    };
  }
  if (error instanceof TypeError) return hostUnreachable();
  return NO_OUTCOME;
}

export function classifyTransportError(code: string, message: string): RemoteConnectionOutcome {
  const authenticationEnded = code === "session_revoked";
  const suspendReconnect = code === "protocol_error" || authenticationEnded;
  const failure = transportFailure(code, message);
  return {
    issue: withReference(
      {
        code:
          code === "protocol_error"
            ? "protocol_error"
            : authenticationEnded
              ? "authentication_required"
              : "network_unavailable",
        message: failure.message,
        retryable: !suspendReconnect,
      },
      failure.reference,
    ),
    state: code === "protocol_error" ? "incompatible" : "error",
    suspendReconnect,
    hostSupport: null,
  };
}

function transportFailure(code: string, message: string): { message: string; reference: string | null } {
  const signal = signalIssueText(code);
  if (signal !== null) return { message: signal, reference: referenceFrom("signal", code) };
  if (code === "session_revoked") return { message, reference: "signal/session_revoked" };
  return { message, reference: referenceFrom("transport", code) };
}

function signalIssueText(code: string): string | null {
  switch (code) {
    case "host_unavailable":
      return sourceText("error.remote.hostOffline");
    case "host_busy":
      return sourceText("error.remote.hostBusy");
    case "permission_denied":
      return sourceText("error.remote.signalPermissionDenied");
    case "rate_limited":
      return sourceText("error.remote.signalRateLimited", { seconds: 60 });
    case "invalid_message":
      return sourceText("error.remote.signalInvalidMessage");
    case "authentication_required":
      return sourceText("error.remote.ticketInvalidOrExpired");
    default:
      return null;
  }
}

function withReference(issue: ServerConnectionIssue, reference: string | null): ServerConnectionIssue {
  return reference === null ? issue : { ...issue, reference };
}

export function checkingCompatibility(localAppVersion: string | null): ServerCompatibility {
  return {
    localAppVersion: localAppVersion ?? "0.0.0",
    hostAppVersion: null,
    localProtocol: LOCAL_TEAM_PROTOCOL,
    hostProtocol: null,
    negotiatedProtocol: null,
    capabilities: [],
  };
}

export function assumedCompatibility(localAppVersion: string | null): ServerCompatibility {
  return {
    ...checkingCompatibility(localAppVersion),
    hostAppVersion: "0.0.0",
    hostProtocol: LOCAL_TEAM_PROTOCOL,
    negotiatedProtocol: TEAM_PROTOCOL_V1,
    capabilities: [...TEAM_PROTOCOL_V3_CAPABILITIES],
  };
}

export function negotiatedCompatibility(
  localAppVersion: string | null,
  host: TeamProtocolSupportV1,
  negotiatedProtocol: number | null,
): ServerCompatibility {
  return {
    localAppVersion: localAppVersion ?? "0.0.0",
    hostAppVersion: host.appVersion,
    localProtocol: LOCAL_TEAM_PROTOCOL,
    hostProtocol: host.protocol,
    negotiatedProtocol,
    capabilities: host.capabilities,
  };
}
