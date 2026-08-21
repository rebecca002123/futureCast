// The plain-text version of a pay period, for the Share button — something
// you can paste into a message when a payslip doesn't match.

import { fmtHours, fmtMoney } from './format';
import { periodLabel } from './periods';
import { fmtDateShort, fmtTime } from './time';

export function shiftLine(result, settings) {
  const { shift } = result;
  const times = `${fmtTime(result.startMin, settings.clock24)}–${fmtTime(result.endMin, settings.clock24)}`;
  const breakNote = result.breakMins ? ` (−${result.breakMins}m break)` : '';
  const job = settings.jobs.length > 1 && result.job ? ` · ${result.job.name}` : '';
  return `${fmtDateShort(shift.date)}  ${times}${breakNote}  ${fmtHours(result.hours)}  ${fmtMoney(result.gross, settings.currency)}${job}`;
}

export function buildSummaryText({ period, results, totals, deductions, settings }) {
  const lines = [];
  lines.push(`Shift Pay — ${periodLabel(period)}`);
  lines.push('');

  for (const result of results) lines.push(shiftLine(result, settings));
  if (!results.length) lines.push('No shifts logged.');

  lines.push('');
  lines.push(`Shifts: ${totals.count}`);
  lines.push(`Hours:  ${fmtHours(totals.hours)}`);
  lines.push(`Gross:  ${fmtMoney(totals.gross, settings.currency)}`);

  if (totals.segments.length > 1) {
    lines.push('');
    lines.push('Made up of:');
    for (const seg of totals.segments) {
      lines.push(`  ${seg.label} @ ${fmtMoney(seg.hourly, settings.currency)}/h — ${fmtHours(seg.hours)} = ${fmtMoney(seg.pay, settings.currency)}`);
    }
  }

  if (settings.holiday?.enabled && totals.holidayHours > 0) {
    lines.push('');
    lines.push(`Holiday accrued: ${fmtHours(totals.holidayHours)} (${fmtMoney(totals.holidayPay, settings.currency)})`);
  }

  if (deductions) {
    lines.push('');
    lines.push(`Estimated take-home: ${fmtMoney(deductions.net, settings.currency)}`);
    if (deductions.pension > 0) lines.push(`  Pension:         −${fmtMoney(deductions.pension, settings.currency)}`);
    lines.push(`  Income tax:      −${fmtMoney(deductions.incomeTax, settings.currency)}`);
    lines.push(`  National Ins.:   −${fmtMoney(deductions.nationalInsurance, settings.currency)}`);
    if (deductions.studentLoan > 0) lines.push(`  Student loan:    −${fmtMoney(deductions.studentLoan, settings.currency)}`);
    lines.push(`  (estimate only, ${deductions.taxYear} rates)`);
  }

  return lines.join('\n');
}

// A CSV of everything, for anyone who wants their shifts in a spreadsheet.
export function buildCsv(results, settings) {
  const rows = [['Date', 'Start', 'End', 'Break (mins)', 'Paid hours', 'Job', 'Rate', 'Gross', 'Note']];
  for (const result of results) {
    rows.push([
      result.shift.date,
      fmtTime(result.startMin),
      fmtTime(result.endMin),
      String(result.breakMins),
      (Math.round(result.hours * 100) / 100).toFixed(2),
      result.job?.name || '',
      result.rate.toFixed(2),
      result.gross.toFixed(2),
      result.shift.note || '',
    ]);
  }
  return rows
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n');
}
