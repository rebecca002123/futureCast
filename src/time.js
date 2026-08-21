// Dates and clock times, with no dependencies and no timezone maths: a shift
// is a local calendar date plus two wall-clock times, which is exactly how
// people read a rota. Everything here works in minutes-from-midnight.

export const MIN_PER_DAY = 1440;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export const pad2 = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' for a Date in the device's own timezone (toISOString would
// shift the date for anyone west of UTC late in the evening).
export function isoFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return isoFromDate(new Date());
}

export function dateFromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDaysISO(iso, days) {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

export function addMonthsISO(iso, months) {
  const date = dateFromISO(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return isoFromDate(date);
}

// 0 = Sunday ... 6 = Saturday, matching Date#getDay.
export function weekdayOf(iso) {
  return dateFromISO(iso).getDay();
}

export function daysBetween(fromISO, toISO) {
  const ms = dateFromISO(toISO).getTime() - dateFromISO(fromISO).getTime();
  return Math.round(ms / 86400000);
}

export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Most recent `weekStart` weekday on or before `iso`.
export function startOfWeekISO(iso, weekStart = 1) {
  const back = (weekdayOf(iso) - weekStart + 7) % 7;
  return addDaysISO(iso, -back);
}

export function startOfMonthISO(iso) {
  const [y, m] = iso.split('-');
  return `${y}-${m}-01`;
}

export function daysInMonth(iso) {
  const date = dateFromISO(iso);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Accepts what people actually type: '9', '930', '9:30', '9.30', '9 30',
// '9pm', '21:05'. Returns minutes from midnight, or null if it isn't a time.
export function parseTimeInput(text) {
  if (text == null) return null;
  const raw = String(text).trim().toLowerCase();
  if (!raw) return null;

  let pm = null;
  let body = raw;
  const suffix = body.match(/(a\.?m\.?|p\.?m\.?)$/);
  if (suffix) {
    pm = suffix[1].startsWith('p');
    body = body.slice(0, suffix.index).trim();
  }

  let hours = null;
  let mins = 0;
  const split = body.match(/^(\d{1,2})\s*[:.h\s]\s*(\d{1,2})$/);
  const digits = body.match(/^(\d{1,4})$/);
  if (split) {
    hours = Number(split[1]);
    mins = Number(split[2]);
  } else if (digits) {
    const d = digits[1];
    if (d.length <= 2) {
      hours = Number(d);
    } else {
      hours = Number(d.slice(0, d.length - 2));
      mins = Number(d.slice(-2));
    }
  } else {
    return null;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (mins > 59) return null;
  if (pm === true && hours < 12) hours += 12;
  if (pm === false && hours === 12) hours = 0;
  if (hours === 24 && mins === 0) return 0;
  if (hours > 23) return null;
  return hours * 60 + mins;
}

export function fmtTime(minutes, use24 = true) {
  const m = ((Math.round(minutes) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (use24) return `${pad2(h)}:${pad2(rest)}`;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return rest === 0 ? `${h12}${suffix}` : `${h12}:${pad2(rest)}${suffix}`;
}

export function fmtDateShort(iso) {
  const d = dateFromISO(iso);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

export function fmtDateLong(iso) {
  const d = dateFromISO(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function fmtDateNumeric(iso) {
  const d = dateFromISO(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

export function relativeDayLabel(iso, today = todayISO()) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return null;
}

export function dayLabel(iso, today = todayISO()) {
  return relativeDayLabel(iso, today) || fmtDateShort(iso);
}

// The UK tax year runs 6 April to 5 April. Used for the year-to-date card.
export function taxYearStartISO(iso = todayISO()) {
  const d = dateFromISO(iso);
  const year = d.getMonth() > 3 || (d.getMonth() === 3 && d.getDate() >= 6)
    ? d.getFullYear()
    : d.getFullYear() - 1;
  return `${year}-04-06`;
}

export function taxYearLabel(iso = todayISO()) {
  const start = dateFromISO(taxYearStartISO(iso));
  const y = start.getFullYear();
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}
