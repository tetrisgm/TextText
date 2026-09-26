import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/editor/ai-config-actions", () => ({ saveWorkspaceAiSettingsAction: vi.fn() }));
import { ItemTypeAgentSetup } from "../ItemTypeAgentSetup";

describe("setup inside a customization request", () => {
  it("does not advertise account setup in an edition that cannot run it", () => {
    const html = renderToStaticMarkup(<ItemTypeAgentSetup handle="writer" nativeAvailable={false}
      preferredConnection="api-key" settings={null} onChooseConnection={() => {}} onReady={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Account connection is unavailable in this edition");
    expect(html).toContain("Check and continue");
    expect(html).toContain("Cancel setup, keep draft");
    expect(html).not.toContain("Continue with ChatGPT");
    expect(html).toContain('type="password"');
  });

  it("offers supported account authorization while preserving the document request", () => {
    const html = renderToStaticMarkup(<ItemTypeAgentSetup handle="writer" nativeAvailable
      preferredConnection="native" settings={null} onChooseConnection={() => {}} onReady={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Continue with ChatGPT");
    expect(html).toContain("Your request and preview are saved here");
    expect(html).toContain("Advanced: provider key");
    expect(html).not.toContain('type="password"');
  });
});
