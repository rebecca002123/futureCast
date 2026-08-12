// Local circumstances for the total solar eclipse of 12 August 2026,
// computed from the NASA/Espenak Besselian elements.
//
// Reference frame: t is in hours from t0 = 18:00 TDT on 2026-08-12.
// All angles in the elements are degrees; x, y, l1, l2 are in Earth radii.

const DEG = Math.PI / 180;

export const ELEMENTS = {
  t0TDTHours: 18.0, // 18:00 TDT, 2026 Aug 12
  deltaT: 75.4, // seconds (TDT - UT)
  x: [0.475514, 0.5189249, -0.0000773, -0.000008],
  y: [0.771183, -0.230168, -0.0001246, 0.0000038],
  d: [14.79667, -0.012065, -0.000003],
  l1: [0.537955, 0.0000939, -0.0000121],
  l2: [-0.008142, 0.0000935, -0.0000121],
  mu: [88.747787, 15.00309],
  tanF1: 0.0046141,
  tanF2: 0.0045911,
};

function poly(coeffs, t) {
  let v = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) v = v * t + coeffs[i];
  return v;
}

function polyDeriv(coeffs, t) {
  let v = 0;
  for (let i = coeffs.length - 1; i >= 1; i--) v = v * t + i * coeffs[i];
  return v;
}

// Observer-dependent quantities at time t (hours from t0, TDT scale).
// latitude/longitude in degrees, longitude east-positive, height in metres.
function circumstances(t, lat, lon, height = 0) {
  const e = ELEMENTS;
  const x = poly(e.x, t);
  const y = poly(e.y, t);
  const d = poly(e.d, t) * DEG;
  const mu = poly(e.mu, t);
  const l1 = poly(e.l1, t);
  const l2 = poly(e.l2, t);

  const dx = polyDeriv(e.x, t);
  const dy = polyDeriv(e.y, t);
  const dd = polyDeriv(e.d, t) * DEG;
  const dmu = polyDeriv(e.mu, t);

  // Geocentric observer coordinates (WGS84 flattening).
  const F = 0.99664719;
  const u = Math.atan(F * Math.tan(lat * DEG));
  const hEr = height / 6378137;
  const rhoSin = F * Math.sin(u) + hEr * Math.sin(lat * DEG);
  const rhoCos = Math.cos(u) + hEr * Math.cos(lat * DEG);

  // Local hour angle of the shadow axis. The elements are on the TDT
  // timescale, so the Earth has rotated 1.002738 * dT less than mu implies.
  const H = (mu + lon - 0.00417807 * e.deltaT) * DEG;

  const xi = rhoCos * Math.sin(H);
  const eta = rhoSin * Math.cos(d) - rhoCos * Math.cos(H) * Math.sin(d);
  const zeta = rhoSin * Math.sin(d) + rhoCos * Math.cos(H) * Math.cos(d);

  const dxi = DEG * dmu * rhoCos * Math.cos(H);
  const deta = DEG * (dmu * xi * Math.sin(d) - zeta * dd / DEG);

  const U = x - xi;
  const V = y - eta;
  const dU = dx - dxi;
  const dV = dy - deta;

  const L1 = l1 - zeta * e.tanF1; // penumbral radius at observer plane
  const L2 = l2 - zeta * e.tanF2; // umbral radius at observer plane

  const m = Math.hypot(U, V);
  const n = Math.hypot(dU, dV);

  // Sun altitude: the shadow axis points at the Sun, so zeta = cos(zenith dist).
  const sunAltitude = Math.asin(Math.max(-1, Math.min(1, zeta))) / DEG;

  return { t, U, V, dU, dV, L1, L2, m, n, zeta, sunAltitude };
}

// One Newton step toward maximum eclipse.
function stepToMax(c) {
  return -(c.U * c.dU + c.V * c.dV) / (c.n * c.n);
}

// Newton steps toward a contact where m = L (sign = -1 first contact, +1 last).
function stepToContact(c, L, sign) {
  const tm = -(c.U * c.dU + c.V * c.dV) / (c.n * c.n);
  const w = (c.U * c.dV - c.V * c.dU) / (c.n * L);
  // |L| so the step direction is not flipped for the umbra (L2 < 0).
  const q = (Math.abs(L) / c.n) * Math.sqrt(Math.max(0, 1 - w * w));
  return tm + sign * q;
}

function iterate(tStart, lat, lon, height, stepFn, iterations = 8) {
  let t = tStart;
  for (let i = 0; i < iterations; i++) {
    const c = circumstances(t, lat, lon, height);
    const dt = stepFn(c);
    t += dt;
    if (Math.abs(dt) < 1e-8) break;
  }
  return t;
}

// Fraction of the Sun's area covered by the Moon (obscuration), given the
// separation m and penumbral/umbral radii L1, L2.
function obscurationFrom(m, L1, L2) {
  const rs = (L1 + L2) / 2; // apparent solar radius (fundamental-plane units)
  const rm = (L1 - L2) / 2; // apparent lunar radius
  if (m >= rs + rm) return 0;
  if (m <= Math.abs(rm - rs)) {
    // Total (moon covers sun) or annular (sun ring remains).
    return rm >= rs ? 1 : (rm * rm) / (rs * rs);
  }
  // Lens area of two overlapping circles.
  const a =
    Math.acos((m * m + rs * rs - rm * rm) / (2 * m * rs));
  const b =
    Math.acos((m * m + rm * rm - rs * rs) / (2 * m * rm));
  const area =
    rs * rs * (a - Math.sin(a) * Math.cos(a)) +
    rm * rm * (b - Math.sin(b) * Math.cos(b));
  return area / (Math.PI * rs * rs);
}

// Convert t (hours from t0 TDT) to a JS Date in UTC.
export function tToDate(t) {
  const e = ELEMENTS;
  const utHours = e.t0TDTHours + t - e.deltaT / 3600;
  const ms = Date.UTC(2026, 7, 12) + utHours * 3600 * 1000;
  return new Date(ms);
}

// Inverse of tToDate: JS Date -> hours from t0 on the TDT scale.
export function dateToT(date) {
  return (date.getTime() - tToDate(0).getTime()) / 3600000;
}

// Moon centre offset relative to Sun centre in sun-radius units, plus sizes,
// for drawing the simulation at time t.
export function diskGeometry(t, lat, lon, height = 0) {
  const c = circumstances(t, lat, lon, height);
  const rs = (c.L1 + c.L2) / 2;
  const rm = (c.L1 - c.L2) / 2;
  return {
    sep: c.m / rs, // centre separation in solar radii
    moonSize: rm / rs, // lunar radius in solar radii
    dirX: c.U / (c.m || 1),
    dirY: c.V / (c.m || 1),
    obscuration: obscurationFrom(c.m, c.L1, c.L2),
    sunAltitude: c.sunAltitude,
  };
}

// Full local circumstances for an observer.
export function computeLocalCircumstances(lat, lon, height = 0) {
  // Locate maximum eclipse.
  const tMax = iterate(0, lat, lon, height, stepToMax);
  const cMax = circumstances(tMax, lat, lon, height);

  const magnitude = (cMax.L1 - cMax.m) / (cMax.L1 + cMax.L2);
  if (magnitude <= 0) {
    return { visible: false };
  }

  const t1 = iterate(tMax - 1, lat, lon, height, (c) =>
    stepToContact(c, c.L1, -1)
  );
  const t4 = iterate(tMax + 1, lat, lon, height, (c) =>
    stepToContact(c, c.L1, +1)
  );

  let total = null;
  if (cMax.m < Math.abs(cMax.L2) && cMax.L2 < 0) {
    const t2 = iterate(tMax - 0.05, lat, lon, height, (c) =>
      stepToContact(c, c.L2, -1)
    );
    const t3 = iterate(tMax + 0.05, lat, lon, height, (c) =>
      stepToContact(c, c.L2, +1)
    );
    total = {
      start: tToDate(t2),
      end: tToDate(t3),
      durationSeconds: (t3 - t2) * 3600,
      tStart: t2,
      tEnd: t3,
    };
  }

  const obscuration = obscurationFrom(cMax.m, cMax.L1, cMax.L2);

  const altAt = (t) => circumstances(t, lat, lon, height).sunAltitude;

  return {
    visible: true,
    isTotal: total !== null,
    magnitude,
    obscuration,
    total,
    partialStart: tToDate(t1),
    maximum: tToDate(tMax),
    partialEnd: tToDate(t4),
    tStart: t1,
    tMax,
    tEnd: t4,
    sunAltitudeAtStart: altAt(t1),
    sunAltitudeAtMax: cMax.sunAltitude,
    sunAltitudeAtEnd: altAt(t4),
  };
}
