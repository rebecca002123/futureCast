// Live flood warnings for England from the Environment Agency's real-time
// flood-monitoring API — free, keyless, updated every 15 minutes. An
// ex-hurricane usually brings its worst damage as rain and flooding, so this
// sits alongside the wind picture.
//
// Honest limitation, shown in-app: the feed covers England only. Wales is
// Natural Resources Wales, Scotland is SEPA, and neither has a comparable
// keyless feed.

const FLOODS_URL =
  'https://environment.data.gov.uk/flood-monitoring/id/floods?min-severity=3';

// severityLevel: 1 = severe flood warning (danger to life), 2 = flood
// warning (act now), 3 = flood alert (be prepared), 4 = no longer in force.
const SEVERITIES = {
  1: { label: 'Severe flood warning', short: 'Severe', color: '#d43c3c', rank: 3 },
  2: { label: 'Flood warning', short: 'Warning', color: '#e08a3c', rank: 2 },
  3: { label: 'Flood alert', short: 'Alert', color: '#d4b93c', rank: 1 },
};

export function parseFloods(data, now = new Date()) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const floods = items
    .map((item) => {
      const sev = SEVERITIES[item.severityLevel];
      if (!sev) return null;
      return {
        id: String(item.floodAreaID || item['@id'] || item.description || Math.random()),
        severityLevel: item.severityLevel,
        ...sev,
        area: item.description || item.eaAreaName || 'England',
        region: item.eaAreaName || null,
        raised: item.timeRaised ? new Date(item.timeRaised) : null,
        message: (item.message || '').slice(0, 400),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.rank - a.rank);

  const counts = { severe: 0, warning: 0, alert: 0 };
  for (const f of floods) {
    if (f.severityLevel === 1) counts.severe++;
    else if (f.severityLevel === 2) counts.warning++;
    else counts.alert++;
  }
  return { floods, counts, fetchedAt: now };
}

export async function fetchFloods(timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(FLOODS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFloods(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
