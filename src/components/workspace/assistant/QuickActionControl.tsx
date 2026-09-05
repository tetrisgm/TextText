"use client";

import { QUICK_ACTION_LANGUAGES, type NativeQuickActionId } from "@/lib/ai/quick-actions";

export function QuickActionControl({ action, className, disabled, onRun }: {
  action: { id: NativeQuickActionId; label: string; description?: string };
  className: string;
  disabled?: boolean;
  onRun: (id: NativeQuickActionId, language?: string) => unknown;
}) {
  if (action.id === "translate") {
    return (
      <select className={className} disabled={disabled} value=""
        aria-label="Translate to a language" title={action.description ?? `${action.label} with your AI provider`}
        onChange={(event) => { if (event.target.value) void onRun("translate", event.target.value); }}>
        <option value="" disabled>Translate</option>
        {QUICK_ACTION_LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
      </select>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled}
      title={action.description ?? `${action.label} with your AI provider`} onClick={() => void onRun(action.id)}>
      {action.label}
    </button>
  );
}
