// The shape of the app's settings, and the defaults a brand-new install
// starts from. Kept apart from storage.js so the maths can be reasoned about
// (and tested) without touching the device.

import { startOfWeekISO, todayISO } from './time';

export const JOB_COLORS = ['#3ddc97', '#5aa9ff', '#f4a259', '#c77dff', '#ff7a90', '#59d2e0'];

export const DEFAULT_SETTINGS = {
  currency: '£',
  clock24: true,
  // The National Living Wage from April 2025 — a sane starting point that
  // the user is meant to change in Settings.
  jobs: [{ id: 'job-1', name: 'My job', rate: 12.21, color: JOB_COLORS[0] }],
  defaultJobId: 'job-1',
  defaultStart: '09:00',
  defaultEnd: '17:00',
  defaultBreakMins: 30,
  payPeriod: {
    type: 'weekly', // 'weekly' | 'fortnightly' | 'monthly'
    weekStart: 1, // 0 = Sunday ... 6 = Saturday
    anchor: null, // start of a known fortnight, filled in on first load
    monthStartDay: 1,
  },
  overtime: {
    weekStart: 1,
    dailyEnabled: false,
    dailyAfterHours: 8,
    dailyMultiplier: 1.5,
    weeklyEnabled: false,
    weeklyAfterHours: 40,
    weeklyMultiplier: 1.5,
  },
  night: { enabled: false, start: '22:00', end: '06:00', mode: 'plus', value: 1.5 },
  weekend: { enabled: false, days: [0, 6], mode: 'multiply', value: 1.5 },
  // 12.07% is the standard accrual for hours worked — 5.6 weeks' holiday
  // spread over the 46.4 weeks you actually work.
  holiday: { enabled: true, percent: 12.07 },
  takeHome: { enabled: false, region: 'uk', pensionPercent: 0, studentLoan: 'none' },
};

const NESTED_KEYS = ['payPeriod', 'overtime', 'night', 'weekend', 'holiday', 'takeHome'];

export function mergeSettings(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  for (const key of NESTED_KEYS) {
    merged[key] = { ...DEFAULT_SETTINGS[key], ...(stored?.[key] || {}) };
  }
  if (!Array.isArray(merged.jobs) || merged.jobs.length === 0) {
    merged.jobs = DEFAULT_SETTINGS.jobs.map((job) => ({ ...job }));
  }
  if (!merged.jobs.some((job) => job.id === merged.defaultJobId)) {
    merged.defaultJobId = merged.jobs[0].id;
  }
  // Fortnights need a fixed starting point, or "every other week" has no
  // meaning. Pin it to the week this app was first opened.
  if (!merged.payPeriod.anchor) {
    merged.payPeriod.anchor = startOfWeekISO(todayISO(), merged.payPeriod.weekStart);
  }
  return merged;
}

let counter = 0;
export function newId(prefix = 'shift') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function blankShift(settings, date = todayISO()) {
  return {
    id: newId(),
    date,
    start: settings.defaultStart,
    end: settings.defaultEnd,
    breakMins: settings.defaultBreakMins,
    jobId: settings.defaultJobId,
    rate: null,
    note: '',
  };
}
