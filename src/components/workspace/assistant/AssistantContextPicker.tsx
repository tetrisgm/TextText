"use client";

import { useEffect, useId, useState } from "react";
import { MAX_PERSON_CONTEXT_ITEMS, type AssistantContextChoice } from "@/lib/ai/context-choice";
import type { AssistantWorkspaceContextItem } from "./AssistantSidebar";
import styles from "./AssistantSidebar.module.css";

/** Same title and folder search used by the rail's original item picker. */
export function contextItemChoices(items: readonly AssistantWorkspaceContextItem[], selected: readonly string[], query: string) {
  const term = query.trim().toLowerCase();
  return items.filter((item) => !selected.includes(item.id) &&
    (!term || `${item.name} ${item.detail}`.toLowerCase().includes(term))).slice(0, 8);
}

export function AssistantContextSearch({ items, selected, onAdd, onClose }: {
  items: readonly AssistantWorkspaceContextItem[]; selected: readonly string[];
  onAdd: (item: AssistantWorkspaceContextItem) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const id = useId();
  const choices = contextItemChoices(items, selected, query);
  const active = Math.max(0, choices.findIndex((item) => item.id === activeId));
  const activeChoiceId = choices[active]?.id;
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [id, active, query, activeChoiceId]);
  const add = (item: AssistantWorkspaceContextItem) => { onAdd(item); onClose(); };
  return <div className={styles.contextPickerPanel} role="dialog" aria-label="Add TextText context"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <input autoFocus role="combobox" aria-label="Search TextText items by title or folder"
      aria-expanded="true" aria-autocomplete="list" aria-controls={id}
      aria-activedescendant={choices[active] ? `${id}-${active}` : undefined}
      placeholder="Search titles or folders" value={query}
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
    {!choices.length && <span className={styles.contextPickerEmpty} role="status">No matching items</span>}
  </div>;
}

export function AssistantContextPicker({ choice, onChange, items, hasItem, hasSelection, disabled, focusComposer, open = false, onOpenChange }: {
  choice: AssistantContextChoice; onChange: (choice: AssistantContextChoice) => void;
  items: readonly AssistantWorkspaceContextItem[]; hasItem: boolean; hasSelection: boolean;
  disabled?: boolean; focusComposer: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
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
      const name = items.find((item) => item.id === id)?.name ?? "Unavailable item";
      return <button key={id} type="button" disabled={disabled} aria-label={`Remove context ${name}`}
        title={name} onClick={() => onChange({ ...choice, itemIds: choice.itemIds.filter((itemId) => itemId !== id) })}>
        <span>{name}</span><span aria-hidden="true">×</span>
      </button>;
    })}
    <button type="button" disabled={disabled} aria-pressed={choice.workspaceIndex}
      title="Include a bounded index of up to 12 recent readable items, not every document body"
      onClick={() => onChange({ ...choice, workspaceIndex: !choice.workspaceIndex })}>Whole workspace index</button>
    <div className={styles.contextPicker}>
      <button type="button" disabled={disabled || choice.itemIds.length >= MAX_PERSON_CONTEXT_ITEMS}
        aria-label="Add TextText context" aria-haspopup="dialog" aria-expanded={open}
        title={`Add up to ${MAX_PERSON_CONTEXT_ITEMS} items`} onClick={() => onOpenChange?.(!open)}>Add</button>
      {open && !disabled && choice.itemIds.length < MAX_PERSON_CONTEXT_ITEMS && <AssistantContextSearch
        items={items} selected={choice.itemIds} onClose={close}
        onAdd={(item) => onChange({ ...choice, itemIds: [...choice.itemIds, item.id] })} />}
    </div>
  </div>;
}
