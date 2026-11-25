import {
  RELAY_AUDIENCE_LIMIT,
  RELAY_CERTIFICATE_PEM_LIMIT,
  RELAY_CHAIN_LIMIT,
  RELAY_CONNECTION_ID_PATTERN,
  RELAY_KEY_ID_PATTERN,
  RELAY_LABEL_LIMIT,
  RELAY_PROTOCOL_VERSION,
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
const proofShape = {
  type: z.literal("hello"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  audience: z.string().min(1).max(RELAY_AUDIENCE_LIMIT),
  certificate: certificateSchema,
  chain: z.array(certificateSchema).max(RELAY_CHAIN_LIMIT).optional(),
  signature: z.string().regex(RELAY_SIGNATURE_PATTERN),
};
const helloSchema = z.discriminatedUnion("role", [
  z.object({ ...proofShape, role: z.literal("member"), hosting: z.boolean(), label: labelSchema.optional() }),
  z.object({
    ...proofShape,
    role: z.literal("client"),
    target: z.string().regex(RELAY_KEY_ID_PATTERN),
    waitForTarget: z.boolean().optional(),
  }),
  z.object({ ...proofShape, role: z.literal("accept"), connectionId: z.string().regex(RELAY_CONNECTION_ID_PATTERN) }),
]);
const presenceSchema = z.object({
  type: z.literal("presence"),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  hosting: z.boolean(),
  label: labelSchema.optional(),
});
const clientMessageSchema = z.union([helloSchema, presenceSchema]) satisfies z.ZodType<RelayClientMessage>;

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
