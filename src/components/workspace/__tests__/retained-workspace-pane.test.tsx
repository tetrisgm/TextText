import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RetainedWorkspacePane } from "../RetainedWorkspacePane";

describe("lazy workspace destinations", () => {
  it("does not render an unvisited hidden destination", () => {
    let renders = 0;
    function Content() { renders++; return <p>News</p>; }
    const html = renderToStaticMarkup(<RetainedWorkspacePane active={false}><Content /></RetainedWorkspacePane>);
    expect(html).toBe("");
    expect(renders).toBe(0);
  });
  it("renders the active destination on first paint", () => {
    expect(renderToStaticMarkup(<RetainedWorkspacePane active><p>Home capture</p></RetainedWorkspacePane>)).toContain("Home capture");
  });
});
