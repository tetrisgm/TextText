export function nativeOcr(imageBase64: string): Promise<{ text: string }> {
  const bridge = (
    window as Window & {
      writeNativeOCR?: {
        recognize: (imageBase64: string) => Promise<{ text: string }>;
      };
    }
  ).writeNativeOCR;
  if (!bridge) return Promise.reject(new Error("Native OCR is unavailable"));
  return bridge.recognize(imageBase64);
}
