import { useEffect, useRef } from "react";
const layers: { close: () => void }[] = [];
export function useEscapeLayer(open: boolean, _label: string, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const layer = { close: () => close.current() }; layers.push(layer);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]") && layers.at(-1) === layer) { event.preventDefault(); event.stopImmediatePropagation(); layer.close(); } };
    window.addEventListener("keydown", key, true);
    return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); window.removeEventListener("keydown", key, true); };
  }, [open]);
}
