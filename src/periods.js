// Pay periods: the window the app adds up. Weekly and fortnightly run from a
// chosen weekday; monthly runs from a chosen day of the month, because plenty
// of payrolls run 21st to 20th rather than calendar months.

import {
  addDaysISO,
  addMonthsISO,
  compareISO,
  DAY_NAMES,
  daysBetween,
  daysInMonth,
  fmtDateShort,
  MONTH_NAMES,
  dateFromISO,
  startOfWeekISO,
  todayISO,
} from './time';

export const PERIOD_TYPES = [
  { id: 'weekly', label: 'Weekly', periodsPerYear: 52 },
  { id: 'fortnightly', label: 'Fortnightly', periodsPerYear: 26 },
  { id: 'monthly', label: 'Monthly', periodsPerYear: 12 },
];

export function periodsPerYear(payPeriod) {
  return PERIOD_TYPES.find((t) => t.id === payPeriod?.type)?.periodsPerYear || 52;
}

function monthlyStart(iso, startDay) {
  const date = dateFromISO(iso);
  const day = Math.min(Math.max(1, startDay || 1), 28);
  const firstOfMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  const thisMonthStart = addDaysISO(firstOfMonth, day - 1);
  return compareISO(iso, thisMonthStart) >= 0 ? thisMonthStart : addMonthsISO(thisMonthStart, -1);
}

// The pay period containing a given date.
export function periodContaining(iso, payPeriod) {
  const type = payPeriod?.type || 'weekly';
  const weekStart = payPeriod?.weekStart ?? 1;

  if (type === 'monthly') {
    const start = monthlyStart(iso, payPeriod?.monthStartDay ?? 1);
    const end = addDaysISO(addMonthsISO(start, 1), -1);
    return { start, end, type };
  }

  const weekBegin = startOfWeekISO(iso, weekStart);
  if (type === 'fortnightly') {
    const anchor = startOfWeekISO(payPeriod?.anchor || weekBegin, weekStart);
    const weeksFromAnchor = Math.floor(daysBetween(anchor, weekBegin) / 7);
    const start = addDaysISO(anchor, (weeksFromAnchor - (((weeksFromAnchor % 2) + 2) % 2)) * 7);
    return { start, end: addDaysISO(start, 13), type };
  }

  return { start: weekBegin, end: addDaysISO(weekBegin, 6), type };
}

export function currentPeriod(payPeriod) {
  return periodContaining(todayISO(), payPeriod);
}

export function shiftPeriod(period, payPeriod, delta) {
  if (!delta) return period;
  if (period.type === 'monthly') {
    const start = addMonthsISO(period.start, delta);
    return { start, end: addDaysISO(addMonthsISO(start, 1), -1), type: period.type };
  }
  const step = period.type === 'fortnightly' ? 14 : 7;
  const start = addDaysISO(period.start, delta * step);
  return { start, end: addDaysISO(start, step - 1), type: period.type };
}

export function inPeriod(iso, period) {
  return compareISO(iso, period.start) >= 0 && compareISO(iso, period.end) <= 0;
}

export function filterToPeriod(shifts, period) {
  return (shifts || []).filter((shift) => inPeriod(shift.date, period));
}

export function periodLabel(period) {
  if (period.type === 'monthly') {
    const start = dateFromISO(period.start);
    const startsFirst = start.getDate() === 1;
    if (startsFirst) return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
    return `${fmtDateShort(period.start)} – ${fmtDateShort(period.end)}`;
  }
  return `${fmtDateShort(period.start)} – ${fmtDateShort(period.end)}`;
}

export function periodSubtitle(period, payPeriod) {
  const type = PERIOD_TYPES.find((t) => t.id === period.type)?.label || 'Weekly';
  if (period.type === 'monthly') {
    const day = payPeriod?.monthStartDay ?? 1;
    return day === 1 ? 'Calendar month' : `Monthly, from the ${ordinal(day)}`;
  }
  return `${type}, ${DAY_NAMES[payPeriod?.weekStart ?? 1]} to ${DAY_NAMES[((payPeriod?.weekStart ?? 1) + 6) % 7]}`;
}

export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
}

export function daysLeftInPeriod(period, iso = todayISO()) {
  if (compareISO(iso, period.end) > 0) return 0;
  if (compareISO(iso, period.start) < 0) return daysBetween(period.start, period.end) + 1;
  return daysBetween(iso, period.end) + 1;
}

export const monthLength = daysInMonth;
