export const SYSTEM_JOB_SHOP_DOMAIN = "__system__";
export const SYSTEM_RETENTION_SWEEP_KIND = "system.retention-sweep";
export const SYSTEM_STUCK_JOB_SWEEP_KIND = "system.stuck-job-sweep";
export const SYSTEM_JOB_KINDS = Object.freeze([
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
]);
export const SYSTEM_JOB_MAX_ATTEMPTS = Object.freeze({
  [SYSTEM_RETENTION_SWEEP_KIND]: 5,
  [SYSTEM_STUCK_JOB_SWEEP_KIND]: 1,
});

function addUtcDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function floorToUtcFiveMinuteWindow(date) {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / 5) * 5);
  return copy;
}

function formatJstDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function buildSystemStuckJobSweepDedupeKey(now = new Date()) {
  return `system:stuck-job-sweep:${floorToUtcFiveMinuteWindow(now).toISOString()}`;
}

export function buildSystemRetentionSweepDedupeKeyForDate(windowDate) {
  return `system:retention-sweep:${windowDate}`;
}

export function buildSystemRetentionSweepDedupeKey(now = new Date()) {
  return buildSystemRetentionSweepDedupeKeyForDate(formatJstDate(now));
}

export function parseSystemRetentionSweepWindowDateFromDedupeKey(dedupeKey) {
  const prefix = "system:retention-sweep:";

  if (typeof dedupeKey !== "string" || !dedupeKey.startsWith(prefix)) {
    return null;
  }

  const windowDate = dedupeKey.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(windowDate) ? windowDate : null;
}

export function addDaysToJstDate(windowDate, days) {
  return formatJstDate(addUtcDays(new Date(`${windowDate}T00:00:00+09:00`), days));
}

export function resolveLatestDueSystemRetentionSweepDate(now = new Date()) {
  const currentWindowDate = formatJstDate(now);
  const currentWindowScheduledAt = new Date(`${currentWindowDate}T03:00:00+09:00`);

  if (now >= currentWindowScheduledAt) {
    return currentWindowDate;
  }

  return addDaysToJstDate(currentWindowDate, -1);
}

export function buildSystemRetentionSweepScheduledAt(windowDate) {
  return new Date(`${windowDate}T03:00:00+09:00`);
}

export function buildSystemJobPayload({
  dedupeKey,
  requestedAt = new Date(),
  scheduledAt,
  timeZone,
  windowDate,
  windowStart,
}) {
  return {
    dedupeKey,
    requestedAt: requestedAt.toISOString(),
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(windowDate ? { windowDate } : {}),
    ...(windowStart ? { windowStart } : {}),
  };
}

export function resolveSystemJobMaxAttempts(kind) {
  return SYSTEM_JOB_MAX_ATTEMPTS[kind] ?? 1;
}
