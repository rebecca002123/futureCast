// ---------------------------------------------------------------------------
// Christmas Lockbox — vault logic.
//
// All amounts are stored in minor units (pence/cents) to avoid float drift.
// All date maths is done in the device's local time zone.
//
// The vault is "locked" outside the yearly unlock window, which runs from
// December `unlockDay` (default the 1st) until the end of December 26th.
// Money can be added at any time; it can only be taken out while the window
// is open (or after a deliberately slow emergency unlock).
// ---------------------------------------------------------------------------

export const UNLOCK_MONTH = 11; // December (0-based)
export const WINDOW_END_DAY = 26; // window closes at the end of Boxing Day
export const EMERGENCY_WAIT_MS = 72 * 60 * 60 * 1000; // 72 h cooling-off

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

// The deposit lands on `day` of the month, clamped for short months
// (a day-31 deposit lands on Feb 28/29, Apr 30, ...).
export function depositDateFor(year, month0, day) {
  return new Date(year, month0, Math.min(day, daysInMonth(year, month0)));
}

export function newVault(config, now = new Date()) {
  return {
    version: 1,
    config: {
      monthlyMinor: config.monthlyMinor,
      depositDay: config.depositDay,
      unlockDay: config.unlockDay,
      goalMinor: config.goalMinor ?? null,
      symbol: config.symbol ?? '£',
      startISO: now.toISOString(),
    },
    ledger: [],
    // One millisecond before the start of today, so that if today is the
    // chosen deposit day the first deposit is credited immediately.
    lastAccrualMs: startOfDay(now).getTime() - 1,
    emergency: null, // { requestedMs, open }
  };
}

// Credit every monthly deposit that has come due since we last checked.
// Returns a new state (or the same object if nothing was due).
export function accrue(state, now = new Date()) {
  const { depositDay, monthlyMinor } = state.config;
  const last = state.lastAccrualMs;
  const nowMs = now.getTime();
  if (nowMs <= last) return state;

  const due = [];
  let y = new Date(last).getFullYear();
  let m = new Date(last).getMonth();
  const endY = now.getFullYear();
  const endM = now.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const d = depositDateFor(y, m, depositDay);
    if (d.getTime() > last && d.getTime() <= nowMs) due.push(d);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  if (due.length === 0) return { ...state, lastAccrualMs: nowMs };

  const entries = due.map((d) => ({
    id: `dep-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    type: 'deposit',
    amountMinor: monthlyMinor,
    atISO: d.toISOString(),
    note: 'Monthly deposit',
  }));
  return {
    ...state,
    ledger: [...state.ledger, ...entries],
    lastAccrualMs: nowMs,
  };
}

export function balanceMinor(state) {
  return state.ledger.reduce(
    (sum, e) => sum + (e.type === 'spend' ? -e.amountMinor : e.amountMinor),
    0
  );
}

// The unlock window for a given year.
export function windowFor(year, unlockDay) {
  return {
    opensAt: new Date(year, UNLOCK_MONTH, unlockDay),
    closesAt: new Date(year, UNLOCK_MONTH, WINDOW_END_DAY, 23, 59, 59, 999),
  };
}

// Where are we relative to the yearly window?
//   { open: true,  closesAt }            — spending season!
//   { open: false, opensAt }             — locked, counting down
export function windowState(unlockDay, now = new Date()) {
  const w = windowFor(now.getFullYear(), unlockDay);
  if (now >= w.opensAt && now <= w.closesAt) {
    return { open: true, ...w };
  }
  if (now < w.opensAt) return { open: false, ...w };
  const next = windowFor(now.getFullYear() + 1, unlockDay);
  return { open: false, ...next };
}

export function emergencyState(state, now = new Date()) {
  const e = state.emergency;
  if (!e) return { phase: 'none' };
  if (e.open) return { phase: 'open' };
  const readyMs = e.requestedMs + EMERGENCY_WAIT_MS;
  if (now.getTime() >= readyMs) return { phase: 'ready' };
  return { phase: 'waiting', readyAt: new Date(readyMs) };
}

export function isUnlocked(state, now = new Date()) {
  return (
    windowState(state.config.unlockDay, now).open ||
    emergencyState(state, now).phase === 'open'
  );
}

export function daysUntil(date, now = new Date()) {
  return Math.max(
    0,
    Math.round((startOfDay(date) - startOfDay(now)) / 86400000)
  );
}

// Next monthly deposit strictly after `now`'s accrual point.
export function nextDepositDate(state, now = new Date()) {
  const { depositDay } = state.config;
  for (let i = 0; i < 24; i += 1) {
    const base = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const d = depositDateFor(base.getFullYear(), base.getMonth(), depositDay);
    if (d.getTime() > state.lastAccrualMs && d.getTime() > now.getTime()) {
      return d;
    }
  }
  return null;
}

// Balance the vault will hold when the window opens, assuming deposits keep
// coming: current balance + every deposit due before (or on) opening day.
export function projectedAtUnlockMinor(state, now = new Date()) {
  const w = windowState(state.config.unlockDay, now);
  if (w.open) return balanceMinor(state);
  let total = balanceMinor(state);
  let d = nextDepositDate(state, now);
  let m = 0;
  while (d && d.getTime() <= w.opensAt.getTime() && m < 24) {
    total += state.config.monthlyMinor;
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    d = depositDateFor(next.getFullYear(), next.getMonth(), state.config.depositDay);
    m += 1;
  }
  return total;
}

export function addExtra(state, amountMinor, note, now = new Date()) {
  return {
    ...state,
    ledger: [
      ...state.ledger,
      {
        id: `extra-${now.getTime()}`,
        type: 'extra',
        amountMinor,
        atISO: now.toISOString(),
        note: note || 'Extra top-up',
      },
    ],
  };
}

export function spend(state, amountMinor, note, now = new Date()) {
  if (!isUnlocked(state, now)) {
    throw new Error('The lockbox is locked.');
  }
  return {
    ...state,
    ledger: [
      ...state.ledger,
      {
        id: `spend-${now.getTime()}`,
        type: 'spend',
        amountMinor,
        atISO: now.toISOString(),
        note: note || 'Christmas spending',
      },
    ],
  };
}

export function fmtMoney(minor, symbol = '£') {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const units = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${grouped}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
}

export function parseMoney(text) {
  const clean = String(text).replace(/[^0-9.]/g, '');
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function fmtDate(d) {
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
