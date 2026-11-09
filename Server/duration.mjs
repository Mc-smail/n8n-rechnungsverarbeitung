const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

function timestamp(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = isoDate.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  // Date.parse normalizes some impossible dates, so validate the calendar first.
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Elapsed seconds rounded to milliseconds; unavailable or reversed times stay null. */
export function documentDurationSeconds(startedAt, finishedAt = Date.now()) {
  const start = timestamp(startedAt);
  const finish = timestamp(finishedAt);
  if (start === null || finish === null || start > finish) return null;
  return Math.round(finish - start) / 1000;
}
