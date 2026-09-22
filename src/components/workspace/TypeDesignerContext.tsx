"use client";

import { createContext, useContext } from "react";
import { readItemTypeForEditAction } from "@/app/editor/item-type-actions";

/** Resolves when the designer closes so its caller can restore its library. */
export const TypeDesignerContext = createContext<((templateId: string, folderPath?: string) => Promise<void>) | null>(null);
export const useTypeDesigner = () => useContext(TypeDesignerContext);

export async function readEditableType(handle: string, templateId: string) {
  const result = await readItemTypeForEditAction(handle, templateId);
  if (!result.ok) throw new Error(result.error);
  if (result.retired) throw new Error("This type has been retired.");
  if (!result.blueprint) throw new Error(
    result.state === "needs-migration"
      ? "This type uses an older designer version and cannot be edited here yet."
      : result.state === "unreadable"
        ? "This type's saved design could not be read."
        : "This type has no editable design. Create a new type from a starting point.",
  );
  return { templateId, baseVersion: result.version, blueprint: result.blueprint };
}
