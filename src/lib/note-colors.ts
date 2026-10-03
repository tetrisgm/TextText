/** A small, validated palette stored in the note TextPack rather than arbitrary CSS. */
export const NOTE_COLORS = ["default", "blue", "green", "orange", "pink", "purple", "red", "yellow"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export function noteColor(value: unknown): NoteColor {
  return typeof value === "string" && NOTE_COLORS.some(color => color === value) ? value as NoteColor : "default";
}
