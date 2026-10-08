"use client";

import { useMemo } from "react";
import { AiProviderSettings, type AiSettingsActions } from "./AiProviderSettings";

export function WebAiSettings({ handle }: { handle: string }) {
  const actions = useMemo<AiSettingsActions>(() => {
    const request = async (body?: Record<string, unknown>) => {
      const response = await fetch(`/api/ai/settings?handle=${encodeURIComponent(handle)}`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error("AI settings are unavailable.");
      return response.json();
    };
    return { read: () => request(), save: (provider, model, apiKey) => request({ action: "save", provider, model, apiKey }), remove: () => request({ action: "remove" }) };
  }, [handle]);
  return <AiProviderSettings key={handle} actions={actions} />;
}
