import type { ReactNode } from "react";
import { DocsNavigation } from "@/components/docs/DocsNavigation";
import "@/styles/connect.css";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="applecms docs-frame">
      <DocsNavigation />
      <div className="docs-frame-content">{children}</div>
    </div>
  );
}
