import {
  RELAY_AUDIENCE_LIMIT,
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CHAIN_LIMIT,
  RELAY_DATA_TICKET_PATTERN,
  RELAY_FEATURE_PATTERN,
  RELAY_FEATURES_LIMIT,
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_NONCE_PATTERN,
  RELAY_PING_ID_MAX,
  RELAY_PROTOCOL_VERSION,
  RELAY_SESSION_FIRST_PATTERN,
  RELAY_SESSION_ID_MAX,
  RELAY_SESSION_REFUSAL_CODES,
  RELAY_SESSION_WINDOW_BYTES,
  RELAY_SIGNATURE_PATTERN,
  type RelayClientMessage,
  type RelayServerMessage,
} from "@openbot/contracts/relay-protocol/messages";
import { z } from "zod";

const certificateSchema = z.string().min(1).max(RELAY_CERTIFICATE_PEM_LIMIT);
const labelSchema = z
  .string()
  .max(RELAY_LABEL_LIMIT)
  .regex(/^[^\p{Cc}]*$/u);
const helloSchema = z.object({
  type: z.literal("hello"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  audience: z.string().min(1).max(RELAY_AUDIENCE_LIMIT),
  clientNonce: z.string().regex(RELAY_NONCE_PATTERN),
  certificate: certificateSchema,
  chain: z.array(certificateSchema).max(RELAY_CHAIN_LIMIT).optional(),
  signature: z.string().regex(RELAY_SIGNATURE_PATTERN),
  role: z.literal("member"),
  hosting: z.boolean(),
  label: labelSchema.optional(),
  features: z.array(z.string().regex(RELAY_FEATURE_PATTERN)).max(RELAY_FEATURES_LIMIT).optional(),
});
const presenceSchema = z.object({
  type: z.literal("presence"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  hosting: z.boolean(),
  label: labelSchema.optional(),
});
const pingSchema = z.object({
  type: z.literal("ping"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  id: z.number().int().min(1).max(RELAY_PING_ID_MAX),
});
const dataTicketSchema = z.object({ type: z.literal("data-ticket"), version: z.literal(RELAY_PROTOCOL_VERSION) });
const dataHelloSchema = z.object({
  type: z.literal("data-hello"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  ticket: z.string().regex(RELAY_DATA_TICKET_PATTERN),
});
const sessionSchema = z.number().int().min(1).max(RELAY_SESSION_ID_MAX);
const firstSchema = z.string().regex(RELAY_SESSION_FIRST_PATTERN).optional();
const sessionOpenSchema = z.object({
  type: z.literal("session-open"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  session: sessionSchema,
  target: z.string().regex(RELAY_KEY_ID_PATTERN),
  first: firstSchema,
});
const sessionAcceptSchema = z.object({
  type: z.literal("session-accept"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  session: sessionSchema,
  first: firstSchema,
});
const sessionRefuseSchema = z.object({
  type: z.literal("session-refuse"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  session: sessionSchema,
  code: z.enum(RELAY_SESSION_REFUSAL_CODES),
});
const sessionCloseSchema = z.object({
  type: z.literal("session-close"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  session: sessionSchema,
});
const sessionCreditSchema = z.object({
  type: z.literal("session-credit"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  session: sessionSchema,
  bytes: z.number().int().min(1).max(RELAY_SESSION_WINDOW_BYTES),
});
const clientMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  presenceSchema,
  pingSchema,
  dataTicketSchema,
  dataHelloSchema,
  sessionOpenSchema,
  sessionAcceptSchema,
  sessionRefuseSchema,
  sessionCloseSchema,
  sessionCreditSchema,
]) satisfies z.ZodType<RelayClientMessage>;

export type DecodedRelayClientMessage = z.output<typeof clientMessageSchema>;

export function decodeRelayClientMessage(text: string): DecodedRelayClientMessage | null {
  try {
    const parsed = clientMessageSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeRelayServerMessage(message: RelayServerMessage): string {
  return JSON.stringify(message);
}
