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

type TipPosition = { left: number; top: number };

export function ShortcutTooltip({
  label,
  keys,
  placement = "top",
  className,
  children,
}: {
  label: string;
  keys?: string | null;
  placement?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
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
  }, [keys, label, placement, visible]);

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
      {visible && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tipRef}
              className="kbd-tip is-fixed"
              role="tooltip"
              style={style}
            >
              <span className="kbd-tip-label">{label}</span>
              {keys ? <kbd className="kbd-tip-key">{keys}</kbd> : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
