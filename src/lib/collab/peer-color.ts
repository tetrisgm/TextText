/** Contrast-safe ink on an opaque peer label, independent of the page theme. */
export function peerLabelInk(color: string): "#000" | "#fff" {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#000";
  const channels = color.slice(1).match(/../g)!.map((c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000" : "#fff";
}
