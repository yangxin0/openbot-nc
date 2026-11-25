import { EventEmitter } from "node:events";
import { Effect } from "effect";
import type {
  TeamV2Channel,
  TeamV2ChannelTransport,
  TeamV2ChannelTransportEvents,
} from "../src/main/team-v2-channel-transport";

export class TeamV2Loopback extends EventEmitter<TeamV2ChannelTransportEvents> implements TeamV2ChannelTransport {
  readonly sent: { peerId: string; channel: TeamV2Channel; data: string }[] = [];
  readonly disconnected: string[] = [];
  readonly #waiters = new Set<() => void>();

  send(peerId: string, channel: TeamV2Channel, data: string | ArrayBuffer) {
    return Effect.sync(() => {
      if (typeof data === "string") this.sent.push({ peerId, channel, data });
      this.#wake();
    });
  }

  disconnectPeer(peerId: string) {
    return Effect.sync(() => {
      this.disconnected.push(peerId);
      queueMicrotask(() => this.emit("disconnected", peerId));
      this.#wake();
    });
  }

  until<T>(pick: () => T | null): Promise<T> {
    return new Promise((resolveValue) => {
      const check = () => {
        const value = pick();
        if (value === null) return;
        this.#waiters.delete(check);
        resolveValue(value);
      };
      this.#waiters.add(check);
      check();
    });
  }

  rpcFrom<T>(from: number, decode: (data: string) => T | null): Promise<T> {
    return this.until(() => {
      for (const frame of this.sent.slice(from)) {
        if (frame.channel !== "rpc") continue;
        const value = decode(frame.data);
        if (value !== null) return value;
      }
      return null;
    });
  }

  #wake(): void {
    for (const wake of [...this.#waiters]) wake();
  }
}
