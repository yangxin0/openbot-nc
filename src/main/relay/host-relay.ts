import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { RELAY_LABEL_LIMIT, type RelayPeerCertificate } from "@openbot/contracts/relay-protocol/messages";
import type { RelayV2TunnelMarker } from "@openbot/contracts/relay-protocol/v2-tunnel";
import { Effect } from "effect";
import { RelayAcceptor } from "./acceptor";
import { RelayControl, type RelayControlState } from "./control";
import type { RelayCredentialSource } from "./identity-store";
import type { RelaySocketError } from "./socket";
import type { RelayStream } from "./stream";
import { type RelayStreamOpening, sniffRelayStream } from "./stream-sniffer";

interface RelayHostedServer {
  acceptConnection(stream: Duplex, peer: RelayPeerCertificate): void;
  setRelayHosting(enabled: boolean, v2Tunnels: boolean): void;
}

interface RelayV2TunnelAcceptor {
  accept(stream: Duplex, peer: RelayPeerCertificate, marker: RelayV2TunnelMarker, rest: Uint8Array): void;
  stop(): Effect.Effect<void>;
}

interface HostRelayEvents {
  state: [state: RelayControlState];
  refused: [error: RelaySocketError];
}

interface HostRelayOptions {
  identity: RelayCredentialSource;
  server: RelayHostedServer;
  label: string | null;
  reconnect?: { baseMs?: number; maxMs?: number };
  control?: RelayControl;
  tunnels?: RelayV2TunnelAcceptor;
  firstBytesDeadlineMs?: number;
}

export class HostRelay extends EventEmitter<HostRelayEvents> {
  readonly #server: RelayHostedServer;
  readonly #control: RelayControl;
  readonly #ownsControl: boolean;
  readonly #label: string | null;
  readonly #acceptor: RelayAcceptor;
  readonly #tunnels: RelayV2TunnelAcceptor | null;
  readonly #firstBytesDeadlineMs: number | undefined;
  readonly #streams = new Set<RelayStream>();
  #started = false;

  constructor(options: HostRelayOptions) {
    super();
    this.#server = options.server;
    this.#tunnels = options.tunnels ?? null;
    this.#firstBytesDeadlineMs = options.firstBytesDeadlineMs;
    this.#label = relayLabel(options.label);
    this.#ownsControl = options.control === undefined;
    this.#control =
      options.control ??
      new RelayControl({
        identity: options.identity,
        hosting: true,
        label: this.#label,
        ...(options.reconnect ? { reconnect: options.reconnect } : {}),
      });
    this.#acceptor = new RelayAcceptor({
      identity: options.identity,
      control: this.#control,
      onStream: (stream, peer) => this.#accept(stream, peer),
      onRefused: (error) => this.emit("refused", error),
    });
  }

  readonly start = Effect.fn("HostRelay.start")(function* (this: HostRelay) {
    if (this.#started) return;
    this.#started = true;
    this.#server.setRelayHosting(true, this.#tunnels !== null);
    this.#control.on("state", this.#onState);
    yield* this.#acceptor.start();
    if (!this.#ownsControl) yield* this.#control.setHosting(true, this.#label).pipe(Effect.ignore);
    yield* this.#control.start();
  }).bind(this);

  readonly stop = Effect.fn("HostRelay.stop")(function* (this: HostRelay) {
    if (!this.#started) return;
    this.#started = false;
    yield* this.#acceptor.stop();
    if (this.#ownsControl) yield* this.#control.stop();
    else yield* this.#control.setHosting(false).pipe(Effect.ignore);
    this.#control.off("state", this.#onState);
    this.#server.setRelayHosting(false, false);
    for (const stream of this.#streams) stream.destroy();
    this.#streams.clear();
    if (this.#tunnels) yield* this.#tunnels.stop();
  }).bind(this);

  readonly setLabel = Effect.fn("HostRelay.setLabel")(function* (
    this: HostRelay,
    label: string | null,
  ): Effect.fn.Return<void, RelaySocketError> {
    yield* this.#control.setHosting(true, relayLabel(label));
  }).bind(this);

  state(): RelayControlState {
    return this.#control.state();
  }

  readonly #onState = (state: RelayControlState): void => {
    this.emit("state", state);
  };

  #accept(stream: RelayStream, peer: RelayPeerCertificate): void {
    if (!this.#started) {
      stream.destroy();
      return;
    }
    this.#streams.add(stream);
    stream.once("close", () => this.#streams.delete(stream));
    stream.on("error", () => stream.destroy());
    const tunnels = this.#tunnels;
    if (!tunnels) {
      this.#server.acceptConnection(stream, peer);
      return;
    }
    Effect.runFork(
      sniffRelayStream(stream, this.#firstBytesDeadlineMs).pipe(
        Effect.match({
          onFailure: () => stream.destroy(),
          onSuccess: (opening) => this.#open(stream, peer, opening, tunnels),
        }),
      ),
    );
  }

  #open(
    stream: RelayStream,
    peer: RelayPeerCertificate,
    opening: RelayStreamOpening,
    tunnels: RelayV2TunnelAcceptor,
  ): void {
    if (!this.#started || stream.destroyed) {
      stream.destroy();
      return;
    }
    if (opening.kind === "v2") {
      tunnels.accept(stream, peer, opening.marker, opening.rest);
      return;
    }
    stream.unshift(opening.head);
    this.#server.acceptConnection(stream, peer);
    stream.resume();
  }
}

function relayLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  return trimmed ? trimmed.slice(0, RELAY_LABEL_LIMIT) : null;
}
