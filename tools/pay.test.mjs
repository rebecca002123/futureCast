import { computeShifts, summarise, overlappingShifts } from '../src/pay.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings.js';

const base = mergeSettings({ jobs: [{ id: 'j', name: 'Job', rate: 12 }], defaultJobId: 'j' });
const s = (over) => ({ id: Math.random().toString(36), jobId: 'j', breakMins: 0, rate: null, ...over });
let fails = 0;
const near = (label, got, want, tol = 0.005) => {
  const ok = Math.abs(got - want) < tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: got ${got.toFixed(3)} want ${want}`);
};

// 1. Plain day shift, 30 min unpaid break.
let r = computeShifts([s({ date: '2026-08-17', start: '09:00', end: '17:00', breakMins: 30 })], base)[0];
near('day shift hours', r.hours, 7.5);
near('day shift pay', r.gross, 90);

// 2. Night shift crossing midnight with a +1.50 night premium.
const night = mergeSettings({ ...base, night: { enabled: true, start: '22:00', end: '06:00', mode: 'plus', value: 1.5 } });
r = computeShifts([s({ date: '2026-08-17', start: '22:00', end: '06:00', breakMins: 30 })], night)[0];
near('night hours', r.hours, 7.5);
near('night pay (all premium)', r.gross, 7.5 * 13.5);

// 3. Part-night shift: 18:00-02:00 = 4h basic + 4h night, 30 min break shared.
r = computeShifts([s({ date: '2026-08-17', start: '18:00', end: '02:00', breakMins: 30 })], night)[0];
near('part-night pay', r.gross, 3.75 * 12 + 3.75 * 13.5);
near('part-night segments', r.segments.length, 2);

// 4. Daily overtime after 8h at 1.5x.
const dailyOT = mergeSettings({ ...base, overtime: { ...DEFAULT_SETTINGS.overtime, dailyEnabled: true, dailyAfterHours: 8, dailyMultiplier: 1.5 } });
r = computeShifts([s({ date: '2026-08-17', start: '08:00', end: '20:00' })], dailyOT)[0];
near('daily OT pay', r.gross, 8 * 12 + 4 * 18);

// 5. Weekly overtime after 40h: five 9h days.
const weeklyOT = mergeSettings({ ...base, overtime: { ...DEFAULT_SETTINGS.overtime, weekStart: 1, weeklyEnabled: true, weeklyAfterHours: 40, weeklyMultiplier: 1.5 } });
const week = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'].map((date) =>
  s({ date, start: '09:00', end: '18:00' }));
let results = computeShifts(week, weeklyOT);
let totals = summarise(results, weeklyOT);
near('weekly hours', totals.hours, 45);
near('weekly OT pay', totals.gross, 40 * 12 + 5 * 18);
near('weekly OT hours', totals.overtimeHours, 5);
// The following week starts clean.
const nextWeek = computeShifts([...week, s({ date: '2026-08-24', start: '09:00', end: '18:00' })], weeklyOT);
near('new week resets OT', nextWeek[5].gross, 9 * 12);

// 6. Weekend premium x1.5 on a Saturday (2026-08-22).
const weekend = mergeSettings({ ...base, weekend: { enabled: true, days: [0, 6], mode: 'multiply', value: 1.5 } });
r = computeShifts([s({ date: '2026-08-22', start: '10:00', end: '16:00' })], weekend)[0];
near('weekend pay', r.gross, 6 * 18);
// A Friday night that runs into Saturday gets the premium only after midnight.
r = computeShifts([s({ date: '2026-08-21', start: '22:00', end: '02:00' })], weekend)[0];
near('friday into saturday', r.gross, 2 * 12 + 2 * 18);

// 7. Night AND weekend both apply -> the better one wins, not both.
const both = mergeSettings({
  ...base,
  night: { enabled: true, start: '22:00', end: '06:00', mode: 'plus', value: 1.5 },
  weekend: { enabled: true, days: [0, 6], mode: 'multiply', value: 1.5 },
});
r = computeShifts([s({ date: '2026-08-22', start: '23:00', end: '01:00' })], both)[0];
near('premiums do not stack', r.gross, 2 * 18);

// 8. Overtime multiplies the premium rate.
const nightOT = mergeSettings({
  ...base,
  night: { enabled: true, start: '22:00', end: '06:00', mode: 'plus', value: 1.5 },
  overtime: { ...DEFAULT_SETTINGS.overtime, dailyEnabled: true, dailyAfterHours: 2, dailyMultiplier: 1.5 },
});
r = computeShifts([s({ date: '2026-08-17', start: '22:00', end: '02:00' })], nightOT)[0];
near('night + overtime', r.gross, 2 * 13.5 + 2 * 13.5 * 1.5);

// 9. Holiday accrual at 12.07% of hours, valued at what the shift paid.
r = computeShifts([s({ date: '2026-08-17', start: '09:00', end: '17:00', breakMins: 30 })], base)[0];
near('holiday hours', r.holidayHours, 7.5 * 0.1207);
near('holiday pay', r.holidayPay, 7.5 * 0.1207 * 12);

// 10. Per-shift rate override beats the job rate.
r = computeShifts([s({ date: '2026-08-17', start: '09:00', end: '13:00', rate: 20 })], base)[0];
near('rate override', r.gross, 80);

// 11. Break longer than the shift can't make pay negative.
r = computeShifts([s({ date: '2026-08-17', start: '09:00', end: '10:00', breakMins: 120 })], base)[0];
near('over-long break', r.gross, 0);
near('over-long break hours', r.hours, 0);

// 12. Overlap detection.
const a = s({ date: '2026-08-17', start: '09:00', end: '17:00' });
const b = s({ date: '2026-08-17', start: '16:00', end: '20:00' });
const c = s({ date: '2026-08-17', start: '17:00', end: '20:00' });
near('overlap found', overlappingShifts(a, [b]).length, 1);
near('touching is not overlap', overlappingShifts(a, [c]).length, 0);
near('overnight overlap', overlappingShifts(s({ date: '2026-08-17', start: '22:00', end: '06:00' }), [s({ date: '2026-08-18', start: '05:00', end: '09:00' })]).length, 1);

// 13. Summary totals across jobs.
const two = mergeSettings({ jobs: [{ id: 'j', name: 'A', rate: 12 }, { id: 'k', name: 'B', rate: 15 }], defaultJobId: 'j' });
totals = summarise(computeShifts([
  s({ date: '2026-08-17', start: '09:00', end: '17:00' }),
  { ...s({ date: '2026-08-18', start: '09:00', end: '17:00' }), jobId: 'k' },
], two), two);
near('two-job gross', totals.gross, 8 * 12 + 8 * 15);
near('two-job count', totals.byJob.length, 2);

console.log(fails === 0 ? '\nAll pay engine checks passed.' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
