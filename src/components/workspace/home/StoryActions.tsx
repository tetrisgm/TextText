"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import styles from "./Home.module.css";

export function StoryActionIcon({ name }: { name: "less" | "save" | "share" | "hide" | "more" }) {
  return <span className={styles.actionCircle} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {name === "more" ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></> : name === "less" ? <path d="M8 3h11v11h-6l-3 7H7v-7H3V3h5Zm0 0v11" /> : name === "save" ? <path d="M6 3h12v19l-6-4-6 4Z" /> : name === "share" ? <path d="M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3" /> : <><path d="m3 3 18 18M10 5h2c6 0 10 7 10 7a24 24 0 0 1-4 4M6 6a25 25 0 0 0-4 6s4 7 10 7h2" /><path d="M9 9a4 4 0 0 0 6 6" /></>}
  </svg></span>;
}

export function StoryActions({ children, onClose, label = "Article options", placement = "sheet" }: { children: ReactNode; onClose: () => void; label?: string; placement?: "sheet" | "menu" }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  useEscapeLayer(true, label, onClose);
  return createPortal(<div className={`${styles.frame} ${styles.sheetBackdrop} ${placement === "menu" ? styles.profileMenuBackdrop : ""}`} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }} onPointerDown={(event) => event.stopPropagation()}>
    <div className={`${styles.storySheet} ${placement === "menu" ? styles.profileMenu : ""}`} ref={ref} role="dialog" aria-modal="true" aria-label={label}>
      {placement === "sheet" && <><div className={styles.sheetHandle} aria-hidden="true" />
      <button className={styles.sheetClose} aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>×</button></>}
      {children}
    </div>
  </div>, document.body);
}
