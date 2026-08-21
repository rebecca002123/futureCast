// An *estimate* of what lands in the bank: PAYE income tax, Class 1 National
// Insurance, a workplace pension and a student loan, worked out on one pay
// period in isolation.
//
// Real PAYE is cumulative across the tax year, so a quiet month after a busy
// one gets a refund this can't see, and a tax code that isn't the standard
// one changes the allowance. Treat the number as "roughly what to expect",
// not as a payslip. Everything here is labelled as such in the app.

export const TAX_YEAR = '2025/26';

const UK_BANDS = [
  { upTo: 37700, rate: 0.2, name: 'Basic rate 20%' },
  { upTo: 125140 - 12570, rate: 0.4, name: 'Higher rate 40%' },
  { upTo: Infinity, rate: 0.45, name: 'Additional rate 45%' },
];

// Scottish rates apply to earned income for Scottish taxpayers; the personal
// allowance and National Insurance are the same UK-wide.
const SCOTLAND_BANDS = [
  { upTo: 2827, rate: 0.19, name: 'Starter rate 19%' },
  { upTo: 14921, rate: 0.2, name: 'Scottish basic rate 20%' },
  { upTo: 31092, rate: 0.21, name: 'Intermediate rate 21%' },
  { upTo: 62430, rate: 0.42, name: 'Higher rate 42%' },
  { upTo: 125140 - 12570, rate: 0.45, name: 'Advanced rate 45%' },
  { upTo: Infinity, rate: 0.48, name: 'Top rate 48%' },
];

export const PERSONAL_ALLOWANCE = 12570;
const ALLOWANCE_TAPER_FROM = 100000;

const NI_PRIMARY_THRESHOLD = 12570;
const NI_UPPER_LIMIT = 50270;
const NI_MAIN_RATE = 0.08;
const NI_UPPER_RATE = 0.02;

export const STUDENT_LOAN_PLANS = [
  { id: 'none', label: 'None', threshold: Infinity, rate: 0 },
  { id: 'plan1', label: 'Plan 1', threshold: 26065, rate: 0.09 },
  { id: 'plan2', label: 'Plan 2', threshold: 28470, rate: 0.09 },
  { id: 'plan4', label: 'Plan 4 (Scotland)', threshold: 32745, rate: 0.09 },
  { id: 'plan5', label: 'Plan 5', threshold: 25000, rate: 0.09 },
  { id: 'pgl', label: 'Postgraduate', threshold: 21000, rate: 0.06 },
];

export const REGIONS = [
  { id: 'uk', label: 'England / Wales / NI' },
  { id: 'scotland', label: 'Scotland' },
];

function bandsFor(region) {
  return region === 'scotland' ? SCOTLAND_BANDS : UK_BANDS;
}

function incomeTaxOnAnnual(annual, region) {
  const allowance = annual > ALLOWANCE_TAPER_FROM
    ? Math.max(0, PERSONAL_ALLOWANCE - (annual - ALLOWANCE_TAPER_FROM) / 2)
    : PERSONAL_ALLOWANCE;
  let taxable = Math.max(0, annual - allowance);
  let tax = 0;
  const bands = [];
  let floor = 0;
  for (const band of bandsFor(region)) {
    const width = band.upTo - floor;
    const slice = Math.min(taxable, width);
    if (slice > 0) {
      tax += slice * band.rate;
      bands.push({ name: band.name, amount: slice, tax: slice * band.rate });
      taxable -= slice;
    }
    floor = band.upTo;
    if (taxable <= 0) break;
  }
  return { tax, allowance, bands };
}

function nationalInsuranceOnAnnual(annual) {
  if (annual <= NI_PRIMARY_THRESHOLD) return 0;
  const main = Math.min(annual, NI_UPPER_LIMIT) - NI_PRIMARY_THRESHOLD;
  const upper = Math.max(0, annual - NI_UPPER_LIMIT);
  return main * NI_MAIN_RATE + upper * NI_UPPER_RATE;
}

function studentLoanOnAnnual(annual, planId) {
  const plan = STUDENT_LOAN_PLANS.find((p) => p.id === planId);
  if (!plan || !Number.isFinite(plan.threshold) || annual <= plan.threshold) return 0;
  return (annual - plan.threshold) * plan.rate;
}

// Gross for one pay period -> the deductions for that period. Thresholds are
// divided by the number of periods in a year, which is what a payslip does
// for a non-cumulative ("week 1 / month 1") code.
export function estimateDeductions(gross, periodsPerYear, options = {}) {
  const periods = periodsPerYear > 0 ? periodsPerYear : 52;
  const pensionPercent = Math.max(0, Number(options.pensionPercent) || 0);
  const pension = (gross * pensionPercent) / 100;

  // A workplace pension under a net-pay arrangement comes off before income
  // tax but not before National Insurance.
  const taxablePay = Math.max(0, gross - pension);
  const annualTaxable = taxablePay * periods;
  const annualGross = gross * periods;

  const { tax, allowance, bands } = incomeTaxOnAnnual(annualTaxable, options.region);
  const incomeTax = tax / periods;
  const nationalInsurance = nationalInsuranceOnAnnual(annualGross) / periods;
  const studentLoan = studentLoanOnAnnual(annualGross, options.studentLoan) / periods;

  const net = gross - pension - incomeTax - nationalInsurance - studentLoan;
  return {
    gross,
    pension,
    pensionPercent,
    incomeTax,
    nationalInsurance,
    studentLoan,
    net,
    annualisedGross: annualGross,
    periodAllowance: allowance / periods,
    bands: bands.map((b) => ({ ...b, amount: b.amount / periods, tax: b.tax / periods })),
    taxYear: TAX_YEAR,
  };
}
