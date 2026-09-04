"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { commandTip } from "@/lib/commands/hints";

type TipPosition = { left: number; top: number };

/** One line of a tooltip: what the control does, and what to press instead. */
type TipLine = { label: string; keys?: string | null };

export function ShortcutTooltip({
  label,
  keys,
  command,
  placement = "top",
  className,
  children,
}: {
  label?: string;
  keys?: string | null;
  /**
   * The command or commands this control runs. The label and keys then come
   * from the command table, so a rebind reaches every tooltip at once, and a
   * control with two related actions lists both the way Superhuman's Send
   * tooltip lists Send and Send + Mark Done.
   */
  command?: string | readonly string[];
  placement?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  const ids = command
    ? typeof command === "string"
      ? [command]
      : [...command]
    : [];
  const derived = ids
    .map((id) => commandTip(id))
    .filter((tip): tip is { label: string; keys: string } => tip !== null);
  // An explicit label still wins: some controls are not commands.
  const lines: TipLine[] =
    derived.length > 0 ? derived : label ? [{ label, keys }] : [];

  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TipPosition | null>(null);

  const hide = useCallback(() => {
    setVisible(false);
    setPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!visible || !wrapRef.current || !tipRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const gutter = 16;
    const viewportPadding = 12;
    const desiredLeft = anchor.left + anchor.width / 2 - tip.width / 2;
    const left = Math.min(
      window.innerWidth - tip.width - viewportPadding,
      Math.max(viewportPadding, desiredLeft),
    );
    const preferredTop =
      placement === "bottom"
        ? anchor.bottom + gutter
        : anchor.top - tip.height - gutter;
    const top =
      preferredTop >= viewportPadding &&
      preferredTop + tip.height <= window.innerHeight - viewportPadding
        ? preferredTop
        : placement === "bottom"
          ? Math.max(viewportPadding, anchor.top - tip.height - gutter)
          : Math.min(
              window.innerHeight - tip.height - viewportPadding,
              anchor.bottom + gutter,
            );
    setPosition({ left, top });
  }, [keys, label, lines.length, placement, visible]);

  const style = position
    ? ({ left: position.left, top: position.top } as CSSProperties)
    : undefined;

  return (
    <span
      ref={wrapRef}
      className={`kbd-tip-wrap${className ? ` ${className}` : ""}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={hide}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hide();
      }}
    >
      {children}
      {visible && lines.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tipRef}
              className={`kbd-tip is-fixed${
                lines.length > 1 ? " is-stacked" : ""
              }`}
              role="tooltip"
              style={style}
            >
              {lines.map((line) => (
                <span key={line.label} className="kbd-tip-line">
                  <span className="kbd-tip-label">{line.label}</span>
                  {line.keys ? (
                    <span className="kbd-tip-keys">
                      {line.keys.split(", ").map((chord, index) => (
                        <kbd key={`${line.label}-${index}`} className="kbd-tip-key">
                          {chord}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
                </span>
              ))}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
