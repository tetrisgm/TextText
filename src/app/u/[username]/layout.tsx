import type { ReactNode } from "react";
import { CommandLayer } from "@/components/keyboard/CommandLayer";

export default function UsernameWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CommandLayer>{children}</CommandLayer>;
}
