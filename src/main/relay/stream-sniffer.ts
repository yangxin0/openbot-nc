import type { Duplex } from "node:stream";
import {
  RELAY_V2_FIRST_BYTES_DEADLINE_MS,
  type RelayV2TunnelMarker,
  scanRelayV2TunnelMarker,
} from "@openbot/contracts/relay-protocol/v2-tunnel";
import { Effect } from "effect";
import { RelaySocketError } from "./socket";

export type RelayStreamOpening =
  | { kind: "http"; head: Buffer }
  | { kind: "v2"; marker: RelayV2TunnelMarker; rest: Uint8Array };

export function sniffRelayStream(
  stream: Duplex,
  deadlineMs = RELAY_V2_FIRST_BYTES_DEADLINE_MS,
): Effect.Effect<RelayStreamOpening, RelaySocketError> {
  return Effect.callback<RelayStreamOpening, RelaySocketError>((resume) => {
    let head: Buffer = Buffer.alloc(0);
    const finish = (result: Effect.Effect<RelayStreamOpening, RelaySocketError>) => {
      release();
      resume(result);
    };
    const onData = (chunk: Buffer) => {
      head = head.byteLength === 0 ? chunk : Buffer.concat([head, chunk]);
      const scan = scanRelayV2TunnelMarker(head);
      if (scan.status === "partial") return;
      stream.pause();
      if (scan.status === "other") finish(Effect.succeed({ kind: "http", head }));
      else if (scan.status === "marker") {
        finish(Effect.succeed({ kind: "v2", marker: scan.marker, rest: head.subarray(scan.length) }));
      } else {
        finish(
          Effect.fail(new RelaySocketError({ code: "protocol_error", message: "The relay stream marker is invalid." })),
        );
      }
    };
    const onClosed = () =>
      finish(
        Effect.fail(new RelaySocketError({ code: "closed", message: "The relay stream closed before it began." })),
      );
    const timer = setTimeout(
      () =>
        finish(
          Effect.fail(
            new RelaySocketError({ code: "deadline_exceeded", message: "The relay stream sent no request." }),
          ),
        ),
      deadlineMs,
    );
    function release(): void {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onClosed);
      stream.off("close", onClosed);
    }
    stream.on("data", onData);
    stream.once("end", onClosed);
    stream.once("close", onClosed);
    return Effect.sync(release);
  });
}
