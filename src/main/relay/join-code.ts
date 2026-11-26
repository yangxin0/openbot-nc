import { generateKeyPairSync, sign } from "node:crypto";
import {
  RELAY_IDENTITY_BUNDLE_VERSION,
  type RelayIdentityBundle,
} from "@openbot/contracts/relay-protocol/identity-bundle";
import { webRelayCrypto } from "@openbot/team-client/relay-crypto";
import {
  enrollRelayKey,
  RelayJoinError,
  type RelayJoinFetch,
  readRelayJoinCode,
  relayIdentityParts,
  relayJoinError,
} from "@openbot/team-client/relay-join";
import { Effect } from "effect";

const ENROLL_DEADLINE_MS = 30_000;
const P256_CURVE = "prime256v1";

export interface RelayJoinCodeOptions {
  fetch?: RelayJoinFetch;
  label?: string;
  now?: () => number;
}

export const joinRelayWithCode = Effect.fn("RelayJoinCode.join")(function* (
  text: string,
  options: RelayJoinCodeOptions = {},
): Effect.fn.Return<RelayIdentityBundle, RelayJoinError> {
  const code = yield* Effect.try({ try: () => readRelayJoinCode(text), catch: joinFailure("invalid_code") });
  const { privateKey, publicKey } = yield* Effect.try({
    try: () => {
      const pair = generateKeyPairSync("ec", { namedCurve: P256_CURVE });
      return {
        privateKey: pair.privateKey,
        publicKey: new Uint8Array(pair.publicKey.export({ type: "spki", format: "der" })),
      };
    },
    catch: joinFailure("key_unavailable"),
  });
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      enrollRelayKey(
        code,
        {
          publicKey,
          sign: async (data) => new Uint8Array(sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" })),
        },
        {
          crypto: webRelayCrypto,
          signal: AbortSignal.any([signal, AbortSignal.timeout(ENROLL_DEADLINE_MS)]),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.label === undefined ? {} : { label: options.label }),
          ...(options.now ? { now: options.now() } : {}),
        },
      ),
    catch: joinFailure("network"),
  });
  return {
    version: RELAY_IDENTITY_BUNDLE_VERSION,
    ...relayIdentityParts(response),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
});

function joinFailure(fallback: RelayJoinError["code"]): (cause: unknown) => RelayJoinError {
  return (cause) => (cause instanceof RelayJoinError ? cause : relayJoinError(fallback));
}
