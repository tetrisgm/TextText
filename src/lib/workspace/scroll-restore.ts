/** Lists can arrive asynchronously; their settling window starts after arrival. */
export function scrollRestoreWindow(isItem: boolean, started: number) {
  let reachedAt: number | null = null;
  return (now: number, reached: boolean): boolean => {
    if (isItem) return now - started >= 900;
    if (!reached) reachedAt = null;
    else reachedAt ??= now;
    return now - started >= 2500 || (reachedAt !== null && now - reachedAt >= 250);
  };
}
