"use client";

import { useEffect, useState } from "react";

/** Pass null until an operation has actually produced a status. */
export function StatusAnnouncement({ message, delay = 700 }: { message: string | null; delay?: number }) {
  const [announced, setAnnounced] = useState({ text: "", sequence: 0 });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnounced(previous => ({ text: message ?? "", sequence: previous.sequence + 1 }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay, message]);
  // Keep the live region mounted. Replacing its child makes a repeated terminal
  // status observable even when the intervening progress was debounced away.
  return <span className="ac-sr-only" role="status" aria-atomic="true"><span key={announced.sequence}>{message ? announced.text : ""}</span></span>;
}
