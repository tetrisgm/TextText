/** Stars are a bounded visual treatment, independent of numeric storage limits. */
export const MAX_RATING_STARS = 10;

export function isVisualRatingScale(max: number | undefined): boolean {
  const scale = max ?? 5;
  return Number.isInteger(scale) && scale >= 1 && scale <= MAX_RATING_STARS;
}
