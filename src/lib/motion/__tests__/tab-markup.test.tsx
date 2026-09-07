import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MotionTab } from "../tabs";

it("server-renders only the selected tab highlight visible before hydration", () => {
  const selected = renderToStaticMarkup(<MotionTab shown selected onExited={vi.fn()}>A</MotionTab>);
  const inactive = renderToStaticMarkup(<MotionTab shown selected={false} onExited={vi.fn()}>B</MotionTab>);
  expect(selected).toContain('class="motion-tab-highlight" style="opacity:1"');
  expect(inactive).toContain('class="motion-tab-highlight" style="opacity:0"');
});
