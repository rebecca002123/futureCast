// The pay engine: turns a logged shift into money, and shows its working.
//
// Every shift is chopped into runs of minutes that share the same hourly
// rate. Two things can change the rate of a minute:
//
//   * a premium — night or weekend — which is a property of *when* the
//     minute falls, and
//   * overtime — daily or weekly — which is a property of *how many* hours
//     came before it.
//
// Premiums don't stack: if a Saturday night is both, the more generous of
// the two applies. Overtime multiplies whatever the minute was already
// worth, so a night hour worked in overtime pays the night rate × 1.5.

import { MIN_PER_DAY, compareISO, parseTimeInput, startOfWeekISO, weekdayOf } from './time';

export const KEY_BASIC = 'basic';
export const KEY_NIGHT = 'night';
export const KEY_WEEKEND = 'weekend';

const PREMIUM_NAMES = {
  [KEY_BASIC]: 'Basic',
  [KEY_NIGHT]: 'Night',
  [KEY_WEEKEND]: 'Weekend',
};

const EPS = 1e-6;

export function jobFor(shift, settings) {
  const jobs = settings.jobs || [];
  return jobs.find((j) => j.id === shift?.jobId) || jobs.find((j) => j.id === settings.defaultJobId) || jobs[0] || null;
}

// A per-shift rate overrides the job's rate — for the odd cover shift paid
// differently from everything else.
export function rateFor(shift, settings) {
  const override = Number(shift?.rate);
  if (Number.isFinite(override) && override > 0) return override;
  const job = jobFor(shift, settings);
  const rate = Number(job?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

// Wall-clock times to minutes. An end time at or before the start means the
// shift ran past midnight, which is normal for nights.
export function shiftTimes(shift) {
  const startMin = parseTimeInput(shift?.start) ?? 0;
  const parsedEnd = parseTimeInput(shift?.end);
  const endMin = parsedEnd == null ? startMin : parsedEnd;
  let spanMins = endMin - startMin;
  if (spanMins < 0) spanMins += MIN_PER_DAY;
  return { startMin, endMin, spanMins, crossesMidnight: endMin < startMin };
}

export function breakMinsFor(shift, spanMins) {
  const raw = Number(shift?.breakMins);
  const mins = Number.isFinite(raw) && raw > 0 ? raw : 0;
  return Math.min(mins, spanMins);
}

function applyPremium(rate, premium) {
  if (!premium?.enabled) return rate;
  const value = Number(premium.value);
  if (!Number.isFinite(value)) return rate;
  return premium.mode === 'plus' ? rate + value : rate * value;
}

function inNightWindow(minuteOfDay, night) {
  const start = parseTimeInput(night?.start);
  const end = parseTimeInput(night?.end);
  if (start == null || end == null || start === end) return false;
  // The window normally wraps midnight (22:00–06:00), but 00:00–06:00 is a
  // perfectly ordinary way to write it too.
  return start > end ? minuteOfDay >= start || minuteOfDay < end : minuteOfDay >= start && minuteOfDay < end;
}

// The best-paid premium that applies to one minute.
function premiumAt(minuteOfDay, dow, rate, settings) {
  let best = { key: KEY_BASIC, hourly: rate };
  if (settings.night?.enabled && inNightWindow(minuteOfDay, settings.night)) {
    const hourly = applyPremium(rate, settings.night);
    if (hourly > best.hourly + EPS) best = { key: KEY_NIGHT, hourly };
  }
  if (settings.weekend?.enabled && (settings.weekend.days || []).includes(dow)) {
    const hourly = applyPremium(rate, settings.weekend);
    if (hourly > best.hourly + EPS) best = { key: KEY_WEEKEND, hourly };
  }
  return best;
}

// Walk the shift a minute at a time and collect runs of equal-rate minutes.
// A minute is cheap and it means a 21:00–07:00 night is split exactly where
// the night window starts and ends, whatever hours anyone works.
function premiumRuns(shift, rate, settings) {
  const { startMin, spanMins } = shiftTimes(shift);
  const dow0 = weekdayOf(shift.date);
  const runs = [];
  for (let i = 0; i < spanMins; i++) {
    const abs = startMin + i;
    const minuteOfDay = abs % MIN_PER_DAY;
    const dow = (dow0 + Math.floor(abs / MIN_PER_DAY)) % 7;
    const { key, hourly } = premiumAt(minuteOfDay, dow, rate, settings);
    const last = runs[runs.length - 1];
    if (last && last.key === key && Math.abs(last.hourly - hourly) < EPS) last.mins += 1;
    else runs.push({ key, hourly, mins: 1 });
  }
  return runs;
}

// An unpaid break comes out of the shift, but it has to come out of
// *something*: it's shared across the rate bands in proportion to how much
// of the shift each band covers. A 30-minute break on a shift that's half
// night takes 15 minutes off each.
function applyBreak(runs, spanMins, paidMins) {
  if (spanMins <= 0 || paidMins <= 0) return [];
  if (paidMins >= spanMins) return runs;
  const factor = paidMins / spanMins;
  return runs.map((run) => ({ ...run, mins: run.mins * factor }));
}

function overtimeSplit(runs, weekMinsBefore, overtime) {
  const dailyLimit = overtime?.dailyEnabled ? Math.max(0, Number(overtime.dailyAfterHours) || 0) * 60 : Infinity;
  const weeklyLimit = overtime?.weeklyEnabled ? Math.max(0, Number(overtime.weeklyAfterHours) || 0) * 60 : Infinity;
  const dailyMult = Math.max(1, Number(overtime?.dailyMultiplier) || 1);
  const weeklyMult = Math.max(1, Number(overtime?.weeklyMultiplier) || 1);

  const pieces = [];
  let intoShift = 0;
  for (const run of runs) {
    let remaining = run.mins;
    while (remaining > EPS) {
      const weekPos = weekMinsBefore + intoShift;
      const isDaily = intoShift >= dailyLimit - EPS;
      const isWeekly = weekPos >= weeklyLimit - EPS;
      const otMult = Math.max(isDaily ? dailyMult : 1, isWeekly ? weeklyMult : 1);

      // Only run as far as the next threshold, so the crossing lands on the
      // exact minute rather than the end of the run.
      let take = remaining;
      if (!isDaily && Number.isFinite(dailyLimit)) take = Math.min(take, dailyLimit - intoShift);
      if (!isWeekly && Number.isFinite(weeklyLimit)) take = Math.min(take, weeklyLimit - weekPos);
      if (!(take > EPS)) take = remaining;

      pieces.push({ key: run.key, hourly: run.hourly, otMult, mins: take });
      intoShift += take;
      remaining -= take;
    }
  }
  return pieces;
}

export function segmentLabel(key, otMult) {
  const base = PREMIUM_NAMES[key] || 'Basic';
  if (otMult > 1 + EPS) {
    const mult = Math.round(otMult * 100) / 100;
    return `${base} · overtime ${mult}×`;
  }
  return base;
}

function collapse(pieces) {
  const map = new Map();
  for (const piece of pieces) {
    const id = `${piece.key}|${piece.otMult.toFixed(3)}|${piece.hourly.toFixed(4)}`;
    const existing = map.get(id);
    if (existing) existing.mins += piece.mins;
    else map.set(id, { ...piece });
  }
  return [...map.values()]
    .map((piece) => {
      const effective = piece.hourly * piece.otMult;
      return {
        key: piece.key,
        otMult: piece.otMult,
        hourly: effective,
        baseHourly: piece.hourly,
        mins: piece.mins,
        hours: piece.mins / 60,
        pay: (effective * piece.mins) / 60,
        label: segmentLabel(piece.key, piece.otMult),
      };
    })
    .sort((a, b) => a.hourly - b.hourly || a.key.localeCompare(b.key));
}

export function sortShifts(shifts) {
  return [...shifts].sort((a, b) => compareISO(a.date, b.date) || shiftTimes(a).startMin - shiftTimes(b).startMin);
}

// Work out every shift in one pass, because weekly overtime depends on what
// came earlier in the same week. Pass in *all* the shifts you have, not just
// the ones on screen, or a week's overtime will be counted from the wrong
// starting point.
export function computeShifts(shifts, settings) {
  const weekMins = new Map();
  return sortShifts(shifts || []).map((shift) => {
    const rate = rateFor(shift, settings);
    const { startMin, endMin, spanMins, crossesMidnight } = shiftTimes(shift);
    const breakMins = breakMinsFor(shift, spanMins);
    const paidMins = Math.max(0, spanMins - breakMins);

    const runs = applyBreak(premiumRuns(shift, rate, settings), spanMins, paidMins);
    const weekKey = startOfWeekISO(shift.date, settings.overtime?.weekStart ?? 1);
    const before = weekMins.get(weekKey) || 0;
    const segments = collapse(overtimeSplit(runs, before, settings.overtime));
    weekMins.set(weekKey, before + paidMins);

    const gross = segments.reduce((sum, seg) => sum + seg.pay, 0);
    const hours = paidMins / 60;
    const holidayPercent = settings.holiday?.enabled ? Math.max(0, Number(settings.holiday.percent) || 0) : 0;
    const holidayHours = (hours * holidayPercent) / 100;

    return {
      id: shift.id,
      shift,
      job: jobFor(shift, settings),
      rate,
      startMin,
      endMin,
      spanMins,
      breakMins,
      paidMins,
      hours,
      crossesMidnight,
      segments,
      gross,
      avgHourly: hours > 0 ? gross / hours : 0,
      // Holiday accrues at what the shift actually paid, premiums included —
      // that's how a week's holiday pay is averaged in the first place.
      holidayHours,
      holidayPay: hours > 0 ? (gross / hours) * holidayHours : 0,
    };
  });
}

export function summarise(results, settings = {}) {
  const totals = {
    count: results.length,
    hours: 0,
    gross: 0,
    holidayHours: 0,
    holidayPay: 0,
    breakMins: 0,
    segments: [],
    byJob: [],
    overtimeHours: 0,
    premiumHours: 0,
  };

  const segMap = new Map();
  const jobMap = new Map();

  for (const result of results) {
    totals.hours += result.hours;
    totals.gross += result.gross;
    totals.holidayHours += result.holidayHours;
    totals.holidayPay += result.holidayPay;
    totals.breakMins += result.breakMins;

    for (const seg of result.segments) {
      if (seg.otMult > 1 + EPS) totals.overtimeHours += seg.hours;
      if (seg.key !== KEY_BASIC) totals.premiumHours += seg.hours;
      const id = `${seg.key}|${seg.otMult.toFixed(3)}|${seg.hourly.toFixed(4)}`;
      const existing = segMap.get(id);
      if (existing) {
        existing.hours += seg.hours;
        existing.pay += seg.pay;
      } else {
        segMap.set(id, { ...seg });
      }
    }

    const jobId = result.job?.id || 'unknown';
    const job = jobMap.get(jobId) || {
      id: jobId,
      name: result.job?.name || 'Unassigned',
      color: result.job?.color,
      hours: 0,
      gross: 0,
      count: 0,
    };
    job.hours += result.hours;
    job.gross += result.gross;
    job.count += 1;
    jobMap.set(jobId, job);
  }

  totals.segments = [...segMap.values()].sort((a, b) => b.pay - a.pay);
  totals.byJob = [...jobMap.values()].sort((a, b) => b.gross - a.gross);
  totals.avgHourly = totals.hours > 0 ? totals.gross / totals.hours : 0;
  return totals;
}

// Absolute minutes since the epoch date, so two shifts can be compared even
// when one runs into the next morning.
function absoluteSpan(shift) {
  const { startMin, spanMins } = shiftTimes(shift);
  const dayStart = new Date(shift.date).getTime() / 60000;
  return { from: dayStart + startMin, to: dayStart + startMin + spanMins };
}

// Two shifts sharing the same hours is nearly always the same shift entered
// twice. Worth a word in the editor rather than a silently doubled payslip.
export function overlappingShifts(shift, others) {
  const a = absoluteSpan(shift);
  if (!(a.to > a.from)) return [];
  return (others || []).filter((other) => {
    if (!other || other.id === shift.id) return false;
    const b = absoluteSpan(other);
    return b.to > a.from && b.from < a.to;
  });
}
