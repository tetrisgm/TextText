"use client";

import { useState } from "react";

async function copyPrompt(prompt: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(prompt);
      return true;
    }
  } catch {
    // Fall through to the selection-based browser API.
  }

  const textarea = document.createElement("textarea");
  textarea.value = prompt;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export function PromptCopyButton({ prompt }: { prompt: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      type="button"
      className="docs-prompt-copy"
      onClick={() => {
        void copyPrompt(prompt).then(
          (copied) => {
            if (!copied) {
              setState("failed");
              return;
            }
            setState("copied");
            window.setTimeout(() => setState("idle"), 1800);
          },
          () => setState("failed"),
        );
      }}
    >
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed"
          : "Copy prompt"}
    </button>
  );
}
