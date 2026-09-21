"use client";

import { useMotionPresence, useSurfaceMotion } from "@/lib/motion/react";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { MAX_PERSON_CONTEXT_ITEMS, type AssistantContextChoice } from "@/lib/ai/context-choice";
import type { AssistantWorkspaceContextItem } from "./AssistantSidebar";
import { fetchContextSources } from "./context-source-client";
import styles from "./AssistantSidebar.module.css";

/** Same title and folder search used by the rail's original item picker. */
export function contextItemChoices(items: readonly AssistantWorkspaceContextItem[], selected: readonly string[], query: string) {
  const term = query.trim().toLowerCase();
  return items.filter((item) => !selected.includes(item.id) &&
    (!term || `${item.name} ${item.detail}`.toLowerCase().includes(term))).slice(0, 8);
}

export function AssistantContextSearch({ items, selected, onAdd, onClose, motionOpen = true, motionOnRest, trigger, workspaceHandle }: {
  workspaceHandle?: string;
  items: readonly AssistantWorkspaceContextItem[]; selected: readonly string[];
  onAdd: (item: AssistantWorkspaceContextItem) => void; onClose: () => void;
  motionOpen?: boolean; motionOnRest?: (shown: boolean) => void; trigger?: RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useSurfaceMotion(panel, motionOpen, { origin: trigger, onRest: motionOnRest });
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const id = useId();
  const [remote, setRemote] = useState<{ query: string; handle: string; items: AssistantWorkspaceContextItem[]; error?: boolean }>({ query: "", handle: "", items: [] });
  useEffect(() => {
    if (!workspaceHandle || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchContextSources(workspaceHandle, { query: query.trim().slice(0, 200) }, controller.signal)
        .then((items) => { if (!controller.signal.aborted) { setRemote({ query, handle: workspaceHandle, items }); } })
        .catch(() => { if (!controller.signal.aborted) setRemote({ query, handle: workspaceHandle, items: [], error: true }); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceHandle, query]);
  const local = contextItemChoices(items, selected, query);
  const settled = remote.query === query && remote.handle === workspaceHandle;
  const searchStatus = !workspaceHandle || query.trim().length < 2 ? "" : !settled ? "Searching sources…" : remote.error ? "Could not search sources. Try another search." : "";
  const remoteItems = settled ? remote.items : [];
  const choices = [...new Map([...local, ...remoteItems.filter((item) => !selected.includes(item.id))].map((item) => [item.id, item])).values()].slice(0, 8);
  const active = Math.max(0, choices.findIndex((item) => item.id === activeId));
  const activeChoiceId = choices[active]?.id;
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [id, active, query, activeChoiceId]);
  const add = (item: AssistantWorkspaceContextItem) => { onAdd(item); onClose(); };
  return <div ref={panel} inert={!motionOpen} aria-hidden={!motionOpen} className={styles.contextPickerPanel} role="dialog" aria-label="Add TextText context"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <input autoFocus role="combobox" aria-label="Search TextText items by title or folder"
      aria-expanded="true" aria-autocomplete="list" aria-controls={id}
      aria-activedescendant={choices[active] ? `${id}-${active}` : undefined}
      placeholder="Search titles or folders" maxLength={200} value={query}
      onChange={(event) => { setQuery(event.target.value); setActiveId(null); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActiveId(choices[Math.max(0, Math.min(choices.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)))]?.id ?? null);
        } else if (event.key === "Enter") {
          event.preventDefault(); event.stopPropagation();
          if (choices[active]) add(choices[active]);
        }
      }} />
    <div id={id} role="listbox" aria-label="Matching TextText items" className={styles.contextPickerResults}>
      {choices.map((item, index) => <button key={item.id} id={`${id}-${index}`} type="button"
        role="option" aria-selected={index === active} onClick={() => add(item)}>
        <span>{item.name}</span><small>{item.detail}</small>
      </button>)}
    </div>
    {workspaceHandle && query.trim().length >= 2 && searchStatus && <span role="status">{searchStatus}</span>}
    {!choices.length && !searchStatus && <span className={styles.contextPickerEmpty} role="status">No matching items</span>}
  </div>;
}

export function AssistantContextPicker({ choice, onChange, items, hasItem, hasSelection, disabled, focusComposer, open = false, onOpenChange, workspaceHandle }: {
  workspaceHandle?: string;
  choice: AssistantContextChoice; onChange: (choice: AssistantContextChoice) => void;
  items: readonly AssistantWorkspaceContextItem[]; hasItem: boolean; hasSelection: boolean;
  disabled?: boolean; focusComposer: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [resolved, setResolved] = useState<{ handle: string; ids: string; items: AssistantWorkspaceContextItem[] }>({ handle: "", ids: "", items: [] });
  const unresolved = choice.itemIds.filter((id) => !items.some((item) => item.id === id)).join(",");
  useEffect(() => {
    if (!workspaceHandle || !unresolved) return;
    const controller = new AbortController();
    void fetchContextSources(workspaceHandle, { ids: unresolved.split(",") }, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setResolved({ handle: workspaceHandle, ids: unresolved, items }); })
      .catch(() => { /* Unavailable sources keep removable, explicitly named fallback chips. */ });
    return () => controller.abort();
  }, [workspaceHandle, unresolved]);
  const namedItems = [...items, ...(resolved.handle === workspaceHandle && resolved.ids === unresolved ? resolved.items : [])];
  const trigger = useRef<HTMLButtonElement>(null);
  const motionOpen = open && !disabled && choice.itemIds.length < MAX_PERSON_CONTEXT_ITEMS;
  const presence = useMotionPresence(motionOpen);
  const close = () => { onOpenChange?.(false); focusComposer(); };
  return <div className={styles.contextRow} role="group" aria-label="Context for the next turn"
    title="Controls context supplied with the next turn. Earlier conversation remains available, and the assistant can use workspace tools when needed."
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <span>Context</span>
    {hasItem && <button type="button" disabled={disabled} aria-pressed={choice.includeItem}
      onClick={() => onChange({ ...choice, includeItem: !choice.includeItem })}>This item</button>}
    {hasSelection && <button type="button" disabled={disabled} aria-pressed={choice.includeSelection}
      onClick={() => onChange({ ...choice, includeSelection: !choice.includeSelection })}>Selection</button>}
    {choice.itemIds.map((id) => {
      const name = namedItems.find((item) => item.id === id)?.name ?? "Unavailable item";
      return <button key={id} type="button" disabled={disabled} aria-label={`Remove context ${name}`}
        title={name} onClick={() => {
          focusComposer();
          onChange({ ...choice, itemIds: choice.itemIds.filter((itemId) => itemId !== id) });
        }}>
        <span>{name}</span><span aria-hidden="true">×</span>
      </button>;
    })}
    <button type="button" disabled={disabled} aria-pressed={choice.workspaceIndex}
      title="Include a bounded index of up to 12 recent readable items, not every document body"
      onClick={() => onChange({ ...choice, workspaceIndex: !choice.workspaceIndex })}>Whole workspace index</button>
    <div className={styles.contextPicker}>
      <button ref={trigger} type="button" disabled={disabled || choice.itemIds.length >= MAX_PERSON_CONTEXT_ITEMS}
        aria-label="Add TextText context" aria-haspopup="dialog" aria-expanded={open}
        title={`Add up to ${MAX_PERSON_CONTEXT_ITEMS} items`} onClick={() => onOpenChange?.(!open)}>Add</button>
      {presence.present && <AssistantContextSearch
        motionOpen={motionOpen} motionOnRest={presence.onRest} trigger={trigger}
        workspaceHandle={workspaceHandle} items={items} selected={choice.itemIds} onClose={close}
        onAdd={(item) => onChange({ ...choice, itemIds: [...choice.itemIds, item.id] })} />}
    </div>
  </div>;
}
