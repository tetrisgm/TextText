import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionNotice, WorkspaceConnectionStatus, subscribeToWorkspaceConnectivity } from "../WorkspaceConnectionNotice";

vi.mock("@/lib/pool/store", () => ({ useWorkspacePool: () => ({ refreshing: false, error: "500" }), refreshWorkspacePool: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("shows connectivity only when offline, with a working refresh action", () => {
  expect(renderToStaticMarkup(<WorkspaceConnectionStatus online refreshing={false} onRefresh={vi.fn()} />)).toBe("");
  const refresh = vi.fn();
  const tree = WorkspaceConnectionStatus({ online: false, refreshing: false, onRefresh: refresh });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("You are offline.");
  expect(html).not.toContain("could not reconnect");
  const button = React.Children.toArray(tree!.props.children).find(child => React.isValidElement(child) && child.type === "button") as React.ReactElement<{ onClick: () => void }>;
  button.props.onClick(); expect(refresh).toHaveBeenCalledOnce();
});
it("does not turn an online pool read error into an offline notice", () => {
  expect(renderToStaticMarkup(<WorkspaceConnectionNotice handle="writer" blogId="workspace" />)).toBe("");
});
it("disables repeated connection checks while refreshing", () => {
  const html = renderToStaticMarkup(<WorkspaceConnectionStatus online={false} refreshing onRefresh={vi.fn()} />);
  expect(html).toContain("disabled"); expect(html).toContain("Checking connection");
});
it("cleans up both online and offline listeners, including subscribe-cleanup-subscribe", () => {
  const browser = new EventTarget(); vi.stubGlobal("window", browser);
  const listener = vi.fn();
  const firstCleanup = subscribeToWorkspaceConnectivity(listener); firstCleanup();
  const cleanup = subscribeToWorkspaceConnectivity(listener);
  browser.dispatchEvent(new Event("offline")); browser.dispatchEvent(new Event("online"));
  expect(listener).toHaveBeenCalledTimes(2);
  cleanup(); browser.dispatchEvent(new Event("offline")); browser.dispatchEvent(new Event("online"));
  expect(listener).toHaveBeenCalledTimes(2);
});

const shell = ts.createSourceFile("shell.tsx", readFileSync(new URL("../../PostWorkspaceShell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
it("mounts the production notice inside the shell's scoped scrolling content", () => {
  const notices: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(shell) === "WorkspaceConnectionNotice") notices.push(node);
    ts.forEachChild(node, visit);
  }
  visit(shell); expect(notices).toHaveLength(1);
  const ancestors: string[] = [];
  for (let parent = notices[0].parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) ancestors.push(parent.openingElement.attributes.getText(shell));
  }
  expect(ancestors[0]).toContain("post-editor-content");
  expect(ancestors.some(value => value.includes("post-editor-shell applecms"))).toBe(true);
  const provider = readFileSync(new URL("../../../lib/pool/WorkspaceProvider.tsx", import.meta.url), "utf8");
  expect(provider).not.toContain("WorkspaceConnectionNotice");
});

// Source-level token coverage, not a claim about browser painting. The
// ancestor regression above is what makes these token definitions available.
const css = readFileSync(new URL("../../../styles/apple.css", import.meta.url), "utf8");
const baseTokens = css.slice(css.indexOf(".applecms {"), css.indexOf('/* dark tokens:'));
describe("notice button theme tokens", () => {
  it.each(["light", "dark"])("has every button token in %s", theme => {
    const darkStart = css.indexOf('[data-theme="dark"] .applecms {');
    const darkEnd = css.indexOf("@media (prefers-color-scheme: dark)", darkStart);
    const available = baseTokens + (theme === "dark" ? css.slice(darkStart, darkEnd) : "");
    for (const token of ["--ac-fill-1", "--ac-label", "--ac-h-tbtn", "--ac-radius-control", "--ac-fs-footnote", "--ac-font-text"])
      expect(available).toContain(`${token}:`);
  });
});
