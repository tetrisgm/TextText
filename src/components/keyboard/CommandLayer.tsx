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
import { CommandPalette } from "@/components/keyboard/CommandPalette";
import {
  availableWorkspaceCommands,
  shortcutList,
  shortcutMatches,
} from "@/lib/commands/workspace";
import type {
  CommandContext,
  CommandShortcut,
  CommandWorkspaceSurface,
} from "@/lib/commands/types";
import { useWorkspacePool } from "@/lib/pool/store";

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

type CommandLayerValue = {
  registerKey: (binding: KeyBinding) => () => void;
  pushEscapeLayer: (label: string, close: () => void) => () => void;
  setWorkspaceSurface: (surface: CommandWorkspaceSurface | null) => void;
  openPalette: (query?: string) => void;
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

export function CommandLayer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { pool } = useWorkspacePool();
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  const openPalette = useCallback((query = "") => {
    setPaletteQuery(query);
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
      closePalette,
      toast: showToast,
    }),
    [closePalette, openPalette, router, showToast],
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
    return () => {
      escapeStackRef.current = escapeStackRef.current.filter(
        (candidate) => candidate.id !== layer.id,
      );
    };
  }, []);

  const popEscapeLayer = useCallback(() => {
    const layer = escapeStackRef.current.at(-1);
    if (!layer) return false;
    escapeStackRef.current = escapeStackRef.current.slice(0, -1);
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
    (event: KeyboardEvent) => {
      const ctx = commandContext();
      for (const command of availableWorkspaceCommands(ctx)) {
        if (
          !shortcutList(command).some((shortcut) =>
            shortcutMatches(shortcut, event),
          )
        ) {
          continue;
        }
        event.preventDefault();
        runCommand(() => command.run(ctx));
        return true;
      }
      return false;
    },
    [commandContext],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const key = event.key.toLowerCase();
      const commandK =
        key === "k" && (event.metaKey || event.ctrlKey) && !event.altKey;
      if (commandK) {
        event.preventDefault();
        openPalette();
        return;
      }

      if (event.key === "Escape") {
        if (popEscapeLayer()) {
          event.preventDefault();
          return;
        }
        if (document.querySelector(".is-edit-workspace-shell")) return;
        event.preventDefault();
        if (dispatchRegisteredKey(event)) return;
        if (workspaceSurfaceRef.current?.navigateUp()) return;
        if (isTypingTarget(event.target) && event.target instanceof HTMLElement) {
          event.target.blur();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (dispatchCommandShortcut(event)) return;
      dispatchRegisteredKey(event);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    dispatchCommandShortcut,
    dispatchRegisteredKey,
    openPalette,
    popEscapeLayer,
  ]);

  const value = useMemo<CommandLayerValue>(
    () => ({
      registerKey,
      pushEscapeLayer,
      setWorkspaceSurface,
      openPalette,
      closePalette,
      commandContext,
    }),
    [
      closePalette,
      commandContext,
      openPalette,
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
