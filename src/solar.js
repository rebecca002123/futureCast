// Solar position (azimuth/altitude) for a given time and place.
// Low-precision Meeus algorithm, accurate to well under 0.1 degrees,
// which is plenty for pointing a phone at the sky.

const DEG = Math.PI / 180;

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Returns { azimuth, altitude } in degrees.
// Azimuth is measured from true north, clockwise (N=0, E=90, S=180, W=270).
// Altitude includes atmospheric refraction near the horizon.
export function sunPosition(date, lat, lon) {
  const jd = julianDay(date);
  const T = (jd - 2451545.0) / 36525;

  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * DEG) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M * DEG) +
    0.000289 * Math.sin(3 * M * DEG);
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const eps =
    23.4392911 - 0.0130042 * T + 0.00256 * Math.cos(omega * DEG);

  const ra = Math.atan2(
    Math.cos(eps * DEG) * Math.sin(lambda * DEG),
    Math.cos(lambda * DEG)
  );
  const dec = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));

  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  let H = ((gmst + lon) * DEG - ra) % (2 * Math.PI);
  if (H < 0) H += 2 * Math.PI;

  const sinAlt =
    Math.sin(lat * DEG) * Math.sin(dec) +
    Math.cos(lat * DEG) * Math.cos(dec) * Math.cos(H);
  let alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;

  const az =
    (Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(lat * DEG) -
        Math.tan(dec) * Math.cos(lat * DEG)
    ) /
      DEG +
      180) %
    360;

  // Bennett refraction formula (degrees), only meaningful near/above horizon.
  if (alt > -2) {
    const r =
      1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * DEG) / 60;
    alt += Math.max(0, r);
  }

  return { azimuth: az, altitude: alt };
}

// Compass point ("W", "WNW", ...) for a degrees-from-north azimuth.
export function compassPoint(az) {
  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  return points[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

// Smallest signed angle a->b in degrees, in [-180, 180).
export function angleDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}
