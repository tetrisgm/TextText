import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionGallery } from "@/components/workspace/ConnectionGallery";

describe("connection gallery", () => {
  it("offers an in-product connection proof when an assistant is ready", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionGallery, {
        cloudConfigured: true,
        nativeAvailable: false,
        nativeReady: false,
        clientCount: 1,
        mcpCount: 0,
        onVerify: () => {},
      }),
    );

    expect(html).toContain("Verify connection");
    expect(html).toContain("1 connected client");
    expect(html).toContain("0 connected servers");
    expect(html).not.toContain("Codex with ChatGPT");
    expect(html).not.toContain("never sees provider secrets");
  });

  it("does not offer a proof before any in-app assistant can run it", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionGallery, {
        cloudConfigured: false,
        nativeAvailable: false,
        nativeReady: false,
        clientCount: 0,
        mcpCount: 0,
      }),
    );

    expect(html).not.toContain("Verify connection");
  });

  it("shows the local Codex option only when the standalone app reports it", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionGallery, {
        cloudConfigured: false,
        nativeAvailable: true,
        nativeReady: false,
        clientCount: 0,
        mcpCount: 0,
      }),
    );

    expect(html).toContain("Codex with ChatGPT");
    expect(html).toContain("standalone Mac agent");
  });
});
