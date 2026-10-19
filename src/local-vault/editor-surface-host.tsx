"use client";
import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { UnifiedDocumentEditor, type LocalDocumentRebind, type UnifiedDocumentEditorProps } from "@/components/document/UnifiedDocumentEditor";

type Owner = "local" | "shared";
type HostedProps = UnifiedDocumentEditorProps & { surfaceResetKey?: string };
/** The controllers retain persistence ownership. This host owns only the single
 * mounted surface and its synchronous document/callback switch. */
export class VaultEditorSurfaceHost {
  private registrations = new Map<Owner, HostedProps>();
  private listeners = new Set<() => void>();
  private waiting = new Set<() => void>();
  private active: Owner = "local";
  private revision = 0;
  private rebind: LocalDocumentRebind | null = null;
  private composing = false;
  private compositionListeners = new Set<() => void>();
  setComposing(value: boolean) { this.composing = value; for (const listener of this.compositionListeners) listener(); }
  waitForComposition(signal: AbortSignal): Promise<void> {
    if (!this.composing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let frame: number | null = null;
      const cleanup = () => { clearTimeout(timer); if (frame !== null) cancelAnimationFrame(frame); this.compositionListeners.delete(check); signal.removeEventListener("abort", abort); };
      const check = () => {
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
        if (!this.composing) frame = requestAnimationFrame(() => {
          frame = null;
          if (!this.composing) { cleanup(); resolve(); }
        });
      };
      const abort = () => { cleanup(); reject(new DOMException("The editor handoff was cancelled.", "AbortError")); };
      const timer = setTimeout(() => { cleanup(); reject(Error("Composition is still active. The editable draft is kept.")); }, 20_000);
      if (signal.aborted) { abort(); return; }
      this.compositionListeners.add(check); signal.addEventListener("abort", abort, { once: true }); check();
    });
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  current = () => this.registrations.get(this.active);
  register(owner: Owner, props: HostedProps) {
    this.registrations.set(owner, props);
    for (const listener of this.waiting) listener();
    if (owner === this.active) this.changed();
  }
  unregister(owner: Owner, props: HostedProps) {
    // Effect cleanup followed by a new registration in the same commit must
    // not briefly unmount the editing surface or blur its current control.
    queueMicrotask(() => {
      if (this.registrations.get(owner) !== props) return;
      this.registrations.delete(owner);
      if (owner === this.active) this.changed();
    });
  }
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }
  registerRebind = (value: LocalDocumentRebind | null) => {
    if (this.rebind === value) return;
    this.rebind = value;
    this.current()?.registerLocalRebind?.(value);
    this.changed();
  };
  hasLocalSurface() { return Boolean(this.registrations.get("local")?.localDocument && this.rebind); }
  hasSharedSurface() { return Boolean(this.registrations.get("shared")?.localDocument); }
  waitForSharedSurface(signal: AbortSignal): Promise<void> {
    if (this.hasSharedSurface()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.waiting.delete(check); signal.removeEventListener("abort", abort); };
      const check = () => { if (this.hasSharedSurface()) { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(new DOMException("The editor handoff was cancelled.", "AbortError")); };
      const timer = setTimeout(() => { cleanup(); reject(Error("The shared editor surface did not become ready. The local draft is kept.")); }, 20_000);
      if (signal.aborted) { abort(); return; }
      this.waiting.add(check); signal.addEventListener("abort", abort, { once: true }); check();
    });
  }
  /** No await may separate the final local capture from this ownership switch. */
  commitShared(): boolean {
    const next = this.registrations.get("shared");
    if (!next?.localDocument || !next.localPresence || !this.rebind) return false;
    const previous = this.current();
    flushSync(() => {
      void this.rebind!(next.localDocument!, next.localPresence!.awareness);
      previous?.registerLocalRebind?.(null);
      this.active = "shared";
      next.registerLocalRebind?.(this.rebind);
      this.changed();
    });
    return true;
  }
}
const Context = createContext<{ host: VaultEditorSurfaceHost; owner: Owner } | null>(null);
export function VaultEditorSurfaceController({ host, owner, children }: { host: VaultEditorSurfaceHost; owner: Owner; children: ReactNode }) {
  return <Context.Provider value={{ host, owner }}>{children}</Context.Provider>;
}
/** Default behavior is unchanged outside the explicit native handoff host. */
export function HostedVaultEditor(props: HostedProps) {
  const context = useContext(Context);
  useLayoutEffect(() => {
    if (!context) return;
    context.host.register(context.owner, props);
    return () => context.host.unregister(context.owner, props);
  }, [context, props]);
  return context ? null : <UnifiedDocumentEditor {...props} />;
}
export function VaultEditorSurface({ host }: { host: VaultEditorSurfaceHost }) {
  useSyncExternalStore(host.subscribe, host.snapshot, host.snapshot);
  const props = host.current();
  return props ? <UnifiedDocumentEditor key={props.surfaceResetKey ?? "initial"} {...props} registerLocalRebind={host.registerRebind} /> : null;
}
