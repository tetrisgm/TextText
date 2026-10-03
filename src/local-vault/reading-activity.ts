/** Calendar-based activity from completed stories, in the reader's local time zone. */
export function readingActivity(readAt: readonly string[], now = new Date()): { daysThisWeek: number; streak: number } {
  const days = new Set(readAt.flatMap((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() <= now.getTime()
      ? [`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`] : [];
  }));
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let daysThisWeek = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    if (days.has(key(day))) daysThisWeek += 1;
    day.setDate(day.getDate() - 1);
  }
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (streak < days.size && days.has(key(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { daysThisWeek, streak };
}
