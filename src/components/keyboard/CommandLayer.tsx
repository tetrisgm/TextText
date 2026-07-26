"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { isTypingTarget } from "@/components/keyboard/typing-target";
import {
  CommandPalette,
  OPEN_COMMAND_PALETTE_EVENT,
  OPEN_KEYBOARD_SHORTCUTS_EVENT,
} from "@/components/keyboard/CommandPalette";
import {
  availableWorkspaceCommands,
  shouldSuppressWorkspaceSingleKeyShortcut,
  shortcutList,
  shortcutMatches,
} from "@/lib/commands/workspace";
import type {
  CommandContext,
  CommandShortcut,
  CommandWorkspaceSurface,
} from "@/lib/commands/types";
import { useWorkspacePool } from "@/lib/pool/store";
import { disarmWorkspaceHover } from "@/lib/workspace-hover";

export type KeyBinding = CommandShortcut & {
  label: string;
  group: string;
  when?: () => boolean;
  run: () => void | Promise<void>;
};

type EscapeLayer = {
  id: number;
  label: string;
  close: () => void;
};

type ToastState = {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
};

let activeEscapeLayerCount = 0;

export function hasActiveEscapeLayer(): boolean {
  return activeEscapeLayerCount > 0;
}

type CommandLayerValue = {
  registerKey: (binding: KeyBinding) => () => void;
  pushEscapeLayer: (label: string, close: () => void) => () => void;
  setWorkspaceSurface: (surface: CommandWorkspaceSurface | null) => void;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
  closePalette: () => void;
  commandContext: () => CommandContext;
};

const CommandLayerContext = createContext<CommandLayerValue | null>(null);

function runCommand(run: () => void | Promise<void>) {
  startTransition(() => {
    void Promise.resolve(run()).catch((error) => {
      console.error("Command failed", error);
    });
  });
}

function isKeyboardShortcutsKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === "?" || (event.key === "/" && event.shiftKey);
}

export function CommandLayer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { pool } = useWorkspacePool();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceSurface, setWorkspaceSurface] =
    useState<CommandWorkspaceSurface | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const keyBindingsRef = useRef<KeyBinding[]>([]);
  const escapeStackRef = useRef<EscapeLayer[]>([]);
  const nextEscapeIdRef = useRef(1);
  const nextToastIdRef = useRef(1);
  const poolRef = useRef(pool);
  const workspaceSurfaceRef = useRef(workspaceSurface);
  const toastTimerRef = useRef<number | null>(null);
  const paletteOpenRef = useRef(paletteOpen);

  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  useEffect(() => {
    workspaceSurfaceRef.current = workspaceSurface;
  }, [workspaceSurface]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const disarm = () => disarmWorkspaceHover();
    window.addEventListener("scroll", disarm, true);
    window.addEventListener("popstate", disarm);
    return () => {
      window.removeEventListener("scroll", disarm, true);
      window.removeEventListener("popstate", disarm);
    };
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setShortcutsOpen(false);
  }, []);

  const openPalette = useCallback((query = "") => {
    setPaletteQuery(query);
    setShortcutsOpen(false);
    setPaletteOpen(true);
  }, []);

  const openShortcuts = useCallback(() => {
    setPaletteQuery("");
    setShortcutsOpen(true);
    setPaletteOpen(true);
  }, []);

  const showToast = useCallback(
    (message: string, action?: { label: string; run: () => void }) => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      const id = nextToastIdRef.current;
      nextToastIdRef.current += 1;
      setToast({ id, message, action });
      toastTimerRef.current = window.setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current));
      }, 6500);
    },
    [],
  );

  const commandContext = useCallback(
    (): CommandContext => ({
      pool: poolRef.current,
      workspace: workspaceSurfaceRef.current,
      navigate: (path: string) => router.push(path),
      refresh: () => router.refresh(),
      openPalette,
      openShortcuts,
      closePalette,
      toast: showToast,
    }),
    [closePalette, openPalette, openShortcuts, router, showToast],
  );

  const registerKey = useCallback((binding: KeyBinding) => {
    keyBindingsRef.current = [...keyBindingsRef.current, binding];
    return () => {
      keyBindingsRef.current = keyBindingsRef.current.filter(
        (candidate) => candidate !== binding,
      );
    };
  }, []);

  const pushEscapeLayer = useCallback((label: string, close: () => void) => {
    const layer = {
      id: nextEscapeIdRef.current,
      label,
      close,
    };
    nextEscapeIdRef.current += 1;
    escapeStackRef.current = [...escapeStackRef.current, layer];
    activeEscapeLayerCount += 1;
    return () => {
      const wasActive = escapeStackRef.current.some(
        (candidate) => candidate.id === layer.id,
      );
      escapeStackRef.current = escapeStackRef.current.filter(
        (candidate) => candidate.id !== layer.id,
      );
      if (wasActive) {
        activeEscapeLayerCount = Math.max(0, activeEscapeLayerCount - 1);
      }
    };
  }, []);

  const popEscapeLayer = useCallback(() => {
    const layer = escapeStackRef.current.at(-1);
    if (!layer) return false;
    escapeStackRef.current = escapeStackRef.current.slice(0, -1);
    activeEscapeLayerCount = Math.max(0, activeEscapeLayerCount - 1);
    layer.close();
    return true;
  }, []);

  useEffect(() => {
    if (!paletteOpen) return;
    return pushEscapeLayer("Command palette", closePalette);
  }, [closePalette, paletteOpen, pushEscapeLayer]);

  const dispatchRegisteredKey = useCallback((event: KeyboardEvent) => {
    const bindings = keyBindingsRef.current;
    for (let index = bindings.length - 1; index >= 0; index -= 1) {
      const binding = bindings[index];
      if (!shortcutMatches(binding, event)) continue;
      if (binding.when && !binding.when()) continue;
      event.preventDefault();
      runCommand(binding.run);
      return true;
    }
    return false;
  }, []);

  const dispatchCommandShortcut = useCallback(
    (event: KeyboardEvent, typingTarget: boolean) => {
      const ctx = commandContext();
      if (shouldSuppressWorkspaceSingleKeyShortcut(ctx, event)) return false;
      for (const command of availableWorkspaceCommands(ctx)) {
        const shortcut = shortcutList(command).find((candidate) =>
          shortcutMatches(candidate, event),
        );
        if (!shortcut) continue;
        if (typingTarget && !shortcut.allowTypingTarget) continue;
        if (shortcut.requiresWorkspace && !ctx.workspace) continue;
        event.preventDefault();
        if (event.repeat) return true;
        runCommand(() => command.run(ctx));
        return true;
      }
      return false;
    },
    [commandContext],
  );

  useEffect(() => {
    const onOpenPalette = () => openPalette();
    const onOpenShortcuts = () => openShortcuts();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette);
    window.addEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpenShortcuts);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenPalette);
      window.removeEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, onOpenShortcuts);
    };
  }, [openPalette, openShortcuts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const typingTarget = isTypingTarget(event.target);

      if (event.key === "Escape") {
        if (popEscapeLayer()) {
          event.preventDefault();
          return;
        }
        if (dispatchCommandShortcut(event, typingTarget)) return;
        if (typingTarget) return;
        dispatchRegisteredKey(event);
        return;
      }

      // While the palette or the shortcut sheet is open it owns the keyboard:
      // do not let background shortcuts (scroll, navigation) fire behind it.
      if (paletteOpenRef.current) return;

      // An open note is deliberately neutral until the user focuses an editor
      // field. Printable keys must not leak into either command registry.
      if (shouldSuppressWorkspaceSingleKeyShortcut(commandContext(), event)) {
        return;
      }

      if (!typingTarget && isKeyboardShortcutsKey(event)) {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if (dispatchCommandShortcut(event, typingTarget)) return;
      if (typingTarget) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      dispatchRegisteredKey(event);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    dispatchCommandShortcut,
    dispatchRegisteredKey,
    commandContext,
    openShortcuts,
    popEscapeLayer,
  ]);

  const value = useMemo<CommandLayerValue>(
    () => ({
      registerKey,
      pushEscapeLayer,
      setWorkspaceSurface,
      openPalette,
      openShortcuts,
      closePalette,
      commandContext,
    }),
    [
      closePalette,
      commandContext,
      openPalette,
      openShortcuts,
      pushEscapeLayer,
      registerKey,
      setWorkspaceSurface,
    ],
  );

  return (
    <CommandLayerContext.Provider value={value}>
      {children}
      <CommandPalette
        initialQuery={paletteQuery}
        open={paletteOpen}
        shortcutsOpen={shortcutsOpen}
        onClose={closePalette}
        commandContext={commandContext}
      />
      {toast && (
        <div className="command-toast applecms" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </CommandLayerContext.Provider>
  );
}

export function useKey(binding: KeyBinding) {
  const layer = useContext(CommandLayerContext);
  const bindingRef = useRef(binding);

  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  useEffect(() => {
    if (!layer) return;
    return layer.registerKey({
      ...binding,
      when: () => bindingRef.current.when?.() ?? true,
      run: () => bindingRef.current.run(),
    });
    // The registered wrapper delegates dynamic behavior through bindingRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);
}

export function useEscapeLayer(
  open: boolean,
  label: string,
  onClose: () => void,
) {
  const layer = useContext(CommandLayerContext);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!layer || !open) return;
    return layer.pushEscapeLayer(label, () => onCloseRef.current());
  }, [label, layer, open]);
}

export function useWorkspaceCommandSurface(
  surface: CommandWorkspaceSurface | null,
) {
  const layer = useContext(CommandLayerContext);

  useEffect(() => {
    if (!layer) return;
    layer.setWorkspaceSurface(surface);
    return () => layer.setWorkspaceSurface(null);
  }, [layer, surface]);
}

export function useCommandContext() {
  return useContext(CommandLayerContext);
}
