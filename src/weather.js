// Fire-weather conditions from Open-Meteo (free, no API key).
// Current temperature / humidity / wind plus recent rainfall, condensed into
// an *indicative* fire-conditions rating. This is a simplified heuristic in
// the spirit of fire-weather indices (hot + dry + windy + no recent rain =
// higher risk), NOT an official Met Office fire severity rating.

export async function fetchFireWeather(lat, lon) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation' +
    '&daily=precipitation_sum&past_days=7&forecast_days=1' +
    '&wind_speed_unit=mph&timezone=auto';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const cur = data.current || {};
    const daily = data.daily || {};
    const sums = daily.precipitation_sum || [];

    // Days since a day with meaningful rain (>1 mm), scanning back from today.
    // past_days=7 + forecast_days=1 → last entry is today.
    let daysSinceRain = null;
    for (let i = sums.length - 1, d = 0; i >= 0; i--, d++) {
      if ((sums[i] ?? 0) > 1) {
        daysSinceRain = d;
        break;
      }
    }
    if (daysSinceRain === null) daysSinceRain = sums.length; // no rain all week

    const temp = cur.temperature_2m;
    const rh = cur.relative_humidity_2m;
    const wind = cur.wind_speed_10m;
    const gusts = cur.wind_gusts_10m;

    return {
      temp,
      rh,
      windMph: wind,
      gustMph: gusts,
      daysSinceRain,
      rating: fireConditionsRating({ temp, rh, windMph: wind, daysSinceRain }),
      fetchedAt: new Date(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function fireConditionsRating({ temp, rh, windMph, daysSinceRain }) {
  let score = 0;
  if (temp >= 28) score += 3;
  else if (temp >= 23) score += 2;
  else if (temp >= 18) score += 1;

  if (rh <= 30) score += 3;
  else if (rh <= 40) score += 2;
  else if (rh <= 55) score += 1;

  if (windMph >= 20) score += 2;
  else if (windMph >= 12) score += 1;

  if (daysSinceRain >= 7) score += 3;
  else if (daysSinceRain >= 3) score += 2;
  else if (daysSinceRain >= 1) score += 1;

  if (score <= 2) return { level: 'Low', color: '#4caf7d' };
  if (score <= 4) return { level: 'Moderate', color: '#d4b93c' };
  if (score <= 6) return { level: 'High', color: '#e08a3c' };
  if (score <= 8) return { level: 'Very High', color: '#e05a3c' };
  return { level: 'Extreme', color: '#d43c3c' };
}
