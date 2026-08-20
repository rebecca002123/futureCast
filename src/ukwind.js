// UK wind outlook — the model-based half of "is it coming for us?".
//
// A hurricane only matters to the UK once it has become an ex-hurricane
// windstorm, and by then the global weather models have it. Open-Meteo serves
// 16-day daily forecasts for free with no API key, so the app pulls maximum
// gusts for a spread of UK locations and shows the windy days ahead. If an
// ex-hurricane is heading our way, this is where it shows up as real numbers
// rather than an extrapolated track.

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// A spread of UK locations: the strongest gusts from an Atlantic system
// usually arrive in the west and north first.
export const UK_SPOTS = [
  { name: 'Cornwall', lat: 50.26, lon: -5.05 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Cardiff', lat: 51.48, lon: -3.18 },
  { name: 'Norwich', lat: 52.63, lon: 1.3 },
  { name: 'Manchester', lat: 53.48, lon: -2.24 },
  { name: 'Belfast', lat: 54.6, lon: -5.93 },
  { name: 'Glasgow', lat: 55.86, lon: -4.25 },
  { name: 'Aberdeen', lat: 57.15, lon: -2.1 },
  { name: 'Stornoway', lat: 58.21, lon: -6.39 },
];

export const WIND_BANDS = [
  { min: 70, label: 'Damaging gusts', color: '#dc2626' },
  { min: 55, label: 'Gales', color: '#ea580c' },
  { min: 45, label: 'Windy', color: '#d4a72c' },
  { min: 35, label: 'Breezy', color: '#3d8fd1' },
  { min: 0, label: 'Light', color: '#4b8f6f' },
];

export function windBand(gustMph) {
  return WIND_BANDS.find((b) => gustMph >= b.min) || WIND_BANDS[WIND_BANDS.length - 1];
}

// Gust speed at which the app treats a day as an ex-hurricane-style
// windstorm signal worth alerting about.
export const WINDSTORM_GUST_MPH = 55;

function toArray(data) {
  if (Array.isArray(data)) return data;
  return data && typeof data === 'object' ? [data] : [];
}

export async function fetchUKWindOutlook(timeoutMs = 20000) {
  const url =
    `${OPEN_METEO}?latitude=${UK_SPOTS.map((s) => s.lat).join(',')}` +
    `&longitude=${UK_SPOTS.map((s) => s.lon).join(',')}` +
    '&daily=wind_gusts_10m_max,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_sum' +
    '&wind_speed_unit=mph&timezone=Europe%2FLondon&forecast_days=16';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let json;
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const locations = toArray(json);
  const byDate = new Map();

  locations.forEach((loc, i) => {
    const spot = UK_SPOTS[i] || { name: `${loc.latitude?.toFixed?.(1)}, ${loc.longitude?.toFixed?.(1)}` };
    const daily = loc?.daily;
    const times = daily?.time || [];
    times.forEach((iso, d) => {
      const gust = daily.wind_gusts_10m_max?.[d];
      const wind = daily.wind_speed_10m_max?.[d];
      const dir = daily.wind_direction_10m_dominant?.[d];
      const rain = daily.precipitation_sum?.[d];
      if (!isFinite(gust)) return;
      const existing = byDate.get(iso);
      if (!existing) {
        byDate.set(iso, {
          dateISO: iso,
          date: new Date(`${iso}T12:00:00Z`),
          gustMph: gust,
          windMph: isFinite(wind) ? wind : null,
          windDir: isFinite(dir) ? dir : null,
          rainMm: isFinite(rain) ? rain : null,
          worstSpot: spot.name,
        });
      } else if (gust > existing.gustMph) {
        existing.gustMph = gust;
        existing.windMph = isFinite(wind) ? wind : existing.windMph;
        existing.windDir = isFinite(dir) ? dir : existing.windDir;
        existing.worstSpot = spot.name;
        if (isFinite(rain)) existing.rainMm = Math.max(existing.rainMm ?? 0, rain);
      }
    });
  });

  const days = [...byDate.values()].sort((a, b) => a.date - b.date);
  for (const d of days) d.band = windBand(d.gustMph);

  const peak = days.reduce((a, b) => (!a || b.gustMph > a.gustMph ? b : a), null);
  const stormyDays = days.filter((d) => d.gustMph >= WINDSTORM_GUST_MPH);

  return {
    days,
    peak,
    stormyDays,
    locations: locations.length,
    fetchedAt: new Date(),
  };
}
