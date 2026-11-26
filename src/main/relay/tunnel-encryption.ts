import {
  RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES,
  RELAY_TUNNEL_HANDSHAKE_DEADLINE_MS,
  type RelayTunnelCryptoErrorCode,
  RelayTunnelHandshake,
  type RelayTunnelHandshakeStep,
  type RelayTunnelRole,
  type RelayTunnelSession,
} from "@openbot/contracts/relay-protocol/tunnel-crypto";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import { Effect, Exit } from "effect";
import { readCertificate } from "./certificates";
import type { RelayCredentialSource } from "./identity-store";
import { type RelayOpen, type RelaySocket, RelaySocketError } from "./socket";

export interface RelayTunnelCipher {
  session: RelayTunnelSession;
  rest: Uint8Array;
  heldByPeer: boolean;
}

interface RelayTunnelFlow {
  heldByPeer: boolean;
}

export function relayTunnelError(code: RelayTunnelCryptoErrorCode): RelaySocketError {
  return new RelaySocketError({ code, message: RELAY_TUNNEL_CRYPTO_ERROR_MESSAGES[code] });
}

export const encryptRelayTunnel = Effect.fn("RelayTunnel.encrypt")(function* (input: {
  socket: RelaySocket;
  open: RelayOpen;
  role: RelayTunnelRole;
  credentials: RelayCredentialSource;
  selfKeyId: string;
  deadlineMs?: number | undefined;
}): Effect.fn.Return<RelayTunnelCipher, RelaySocketError> {
  const { socket, open, role, credentials, selfKeyId } = input;
  const peerKey = readCertificate(open.peer.certificate)?.publicKey.export({ type: "spki", format: "der" });
  if (!peerKey) return yield* relayTunnelError("tunnel_peer_unverified");
  const handshake = new RelayTunnelHandshake({
    role,
    crypto: webRelayCrypto,
    binding:
      role === "client"
        ? { connectionId: open.connectionId, clientKeyId: selfKeyId, hostKeyId: open.peer.keyId }
        : { connectionId: open.connectionId, clientKeyId: open.peer.keyId, hostKeyId: selfKeyId },
    peerPublicKey: { format: "spki", bytes: peerKey },
    sign: async (transcript) => credentials.signTunnelTranscript(transcript),
  });
  const flow: RelayTunnelFlow = { heldByPeer: false };
  return yield* Effect.gen(function* () {
    let step = yield* handshakeStep(() => handshake.begin());
    for (;;) {
      if (step.kind === "failed") return yield* relayTunnelError(step.code);
      if (step.send) yield* sendBinary(socket, step.send);
      if (step.kind === "done") return { session: step.session, rest: step.rest, heldByPeer: flow.heldByPeer };
      const chunk = yield* nextChunk(socket, flow);
      step = yield* handshakeStep(() => handshake.receive(chunk));
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: input.deadlineMs ?? RELAY_TUNNEL_HANDSHAKE_DEADLINE_MS,
      orElse: () =>
        Effect.fail(
          new RelaySocketError({
            code: "deadline_exceeded",
            message: "The peer did not complete the encrypted connection in time.",
          }),
        ),
    }),
    Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => socket.terminate()))),
  );
});

function handshakeStep(
  run: () => Promise<RelayTunnelHandshakeStep>,
): Effect.Effect<RelayTunnelHandshakeStep, RelaySocketError> {
  return Effect.tryPromise({ try: run, catch: () => relayTunnelError("tunnel_handshake_failed") });
}

function sendBinary(socket: RelaySocket, bytes: Uint8Array): Effect.Effect<void, RelaySocketError> {
  return Effect.callback<void, RelaySocketError>((resume) => {
    socket.sendBinary(bytes, (error) =>
      resume(
        error
          ? Effect.fail(new RelaySocketError({ code: "closed", message: "The relay socket is closed." }))
          : Effect.void,
      ),
    );
  });
}

function nextChunk(socket: RelaySocket, flow: RelayTunnelFlow): Effect.Effect<Uint8Array, RelaySocketError> {
  return Effect.callback<Uint8Array, RelaySocketError>((resume) => {
    socket.attach({
      binary: (data) => {
        socket.detach();
        resume(Effect.succeed(data));
      },
      message: (message) => {
        if (message.type === "pause" || message.type === "resume") {
          flow.heldByPeer = message.type === "pause";
          return;
        }
        socket.detach();
        resume(
          Effect.fail(
            new RelaySocketError({
              code: "protocol_error",
              message: "The relay server sent a message that is not expected.",
            }),
          ),
        );
      },
      closed: (close) => {
        socket.detach();
        resume(Effect.fail(close.error));
      },
    });
    return Effect.sync(() => socket.detach());
  });
}
