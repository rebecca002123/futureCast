// Money and hours, formatted the way a payslip reads.

export function fmtMoney(amount, currency = '£', { decimals = 2 } = {}) {
  const value = Number.isFinite(amount) ? amount : 0;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currency}${grouped}${fraction ? `.${fraction}` : ''}`;
}

// 7.5 -> '7h 30m'. Rounded to the minute, because that's the resolution
// every shift is entered at.
export function fmtHours(hours) {
  const total = Math.round((Number.isFinite(hours) ? hours : 0) * 60);
  const h = Math.floor(Math.abs(total) / 60);
  const m = Math.abs(total) % 60;
  const sign = total < 0 ? '-' : '';
  if (total === 0) return '0h';
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

// The same duration as a decimal, which is what most rotas and timesheets
// quote ('7.5 hours').
export function fmtDecimalHours(hours) {
  const value = Number.isFinite(hours) ? hours : 0;
  return `${(Math.round(value * 100) / 100).toFixed(2)} h`;
}

export function fmtRate(rate, currency = '£') {
  return `${fmtMoney(rate, currency)}/h`;
}

export function fmtMultiplier(mult) {
  const rounded = Math.round(mult * 1000) / 1000;
  return `${rounded}×`;
}

export function fmtPercent(value, decimals = 1) {
  const v = Number.isFinite(value) ? value : 0;
  return `${(Math.round(v * 10 ** decimals) / 10 ** decimals).toFixed(decimals)}%`;
}
