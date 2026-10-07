import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { FilePresenceClient } from "./presence-client";
import type { VaultTransport } from "./bridge";

/** A native agent turn owns presence independently of whether its panel is visible. */
export class AgentPresenceClient {
  private generation = 0;
  private active: { taskId: string; close(): void } | null = null;
  private destroyed = false;
  private taskId: string | null = null;
  private opening: AbortController | null = null;
  constructor(private readonly request: VaultTransport, private readonly events: EventTarget = window) {
    events.addEventListener("texttext:vault-agent", this.receive);
  }
  private receive = (event: Event) => {
    const value = (event as CustomEvent).detail;
    if (!value || typeof value !== "object") return;
    if ((value.taskId === this.taskId && ["turn-completed", "turn-cancelled", "error"].includes(value.type)) ||
        (value.type === "status" && ["disconnected", "failed", "signed-out"].includes(value.state))) this.stop();
  };
  async start(path: string, taskId: string) {
    this.stop();
    if (this.destroyed || !path || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(taskId)) return;
    this.taskId = taskId;
    const generation = this.generation;
    const opening = new AbortController(); this.opening = opening;
    try {
      const config = await this.request("collaborationConfig", { path, readyOnly: true }, opening.signal) as { itemId?: string; localFiles?: boolean } | null;
      if (this.destroyed || generation !== this.generation || !config?.itemId || config.localFiles !== true) return;
      const server = await this.request("presenceRead", { itemId: config.itemId }, opening.signal) as { capabilities?: { nativeAgentPresence?: boolean } } | null;
      // Older servers treat an unknown agent field as human presence. Never announce before support is explicit.
      if (this.destroyed || generation !== this.generation || server?.capabilities?.nativeAgentPresence !== true) return;
      const document = new Y.Doc(), awareness = new Awareness(document);
      const agent = { name: "Codex", taskId };
      const presence = new FilePresenceClient({ itemId: config.itemId, awareness, onPresence: () => {},
        request: (method, params, signal) => this.request(method, method === "presenceRead" ? params : { ...params, agent }, signal) });
      this.active = { taskId, close() { presence.destroy(); awareness.destroy(); document.destroy(); } };
      presence.setActive(true);
    } catch { /* Presence failure must never block an authorized file operation. */ }
    finally { if (this.opening === opening) this.opening = null; }
  }
  stop() { this.generation++; this.opening?.abort(); this.opening = null; this.active?.close(); this.active = null; this.taskId = null; }
  destroy() { this.destroyed = true; this.stop(); this.events.removeEventListener("texttext:vault-agent", this.receive); }
}
