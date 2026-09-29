type NativeDownloadResult = CustomEvent<{ filename?: string; saved?: boolean }>;

/** A native recovery export is safe to acknowledge only after WebKit finishes saving it. */
export async function downloadJsonCopy(filename: string, value: unknown): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  const native = (window as typeof window & { __TEXTTEXT_APP__?: boolean }).__TEXTTEXT_APP__ === true;

  if (!native) {
    try {
      link.click();
      return true;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return new Promise<boolean>((resolve) => {
    const finish = (saved: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("texttext:native-download-result", onResult);
      URL.revokeObjectURL(url);
      resolve(saved);
    };
    const onResult = (event: Event) => {
      const detail = (event as NativeDownloadResult).detail;
      if (detail?.filename === filename) finish(detail.saved === true);
    };
    window.addEventListener("texttext:native-download-result", onResult);
    const timer = setTimeout(() => finish(false), 60_000);
    try {
      link.click();
    } catch {
      finish(false);
    }
  });
}
