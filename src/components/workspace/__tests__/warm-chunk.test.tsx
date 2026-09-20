import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ instance: "cold", slots: new Map<string, unknown>() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  // One state slot per simulated mount; returned elements expose the child
  // identity React uses to decide whether the editor must be unmounted.
  useState: (initial: () => unknown) => {
    if (!hooks.slots.has(hooks.instance)) hooks.slots.set(hooks.instance, initial());
    return [hooks.slots.get(hooks.instance), vi.fn()];
  },
}));
vi.mock("next/dynamic", () => ({ default: () => function Lazy() { return null; } }));
import { warmChunk } from "../warm-chunk";

it("keeps a cold editor mounted when warming finishes, while future opens take the direct path", async () => {
  function Editor({ label }: { label: string }) { return <input aria-label={label} />; }
  const chunk = warmChunk(async () => Editor);
  const render = chunk.Component as (props: { label: string }) => ReactElement;
  const before = render({ label: "Before typing" });
  chunk.warm();
  await Promise.resolve();
  const after = render({ label: "After typing" });
  expect(after.type).toBe(before.type);
  expect(after.props).toEqual({ label: "After typing" });
  hooks.instance = "next-open";
  expect(render({ label: "Next note" }).type).toBe(Editor);
});
