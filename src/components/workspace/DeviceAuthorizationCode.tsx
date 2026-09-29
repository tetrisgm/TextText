"use client";

import { useState } from "react";
import styles from "./DeviceAuthorizationCode.module.css";

export function DeviceAuthorizationCode({ code }: { code: string }) {
  const [result, setResult] = useState<{ code: string; copied: boolean } | null>(null);
  const copied = result?.code === code && result.copied;
  const failed = result?.code === code && !result.copied;

  return <span className={styles.row}>
    <code className={styles.code}>{code}</code>
    <button type="button" className={styles.copy} onClick={async () => {
      try {
        await navigator.clipboard.writeText(code);
        setResult({ code, copied: true });
      } catch {
        setResult({ code, copied: false });
      }
    }}>{copied ? "Copied" : "Copy code"}</button>
    {failed ? <span role="status">Select the code to copy it.</span> : null}
  </span>;
}
