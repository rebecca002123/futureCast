// Home Screen / Lock Screen widget bridge.
//
// The widget extension (targets/storm-widget) is a separate process that can't
// run JavaScript, so the app hands it a small JSON snapshot through a shared
// App Group container every time it refreshes — in the foreground and from the
// background task — and then asks WidgetKit to reload its timelines.
//
// Everything here is a no-op unless the app is a real iOS build with the
// widget extension: in Expo Go, on Android and on web the native module is
// missing and `ExtensionStorage` quietly does nothing.

import { Platform } from 'react-native';

import { fmtDayLabel, ktToMph, saffirSimpson } from './storms';

// Must match `ios.entitlements` in app.json and the widget's
// expo-target.config.js.
export const APP_GROUP = 'group.com.atlanticstormwatch.app';
export const WIDGET_KEY = 'stormWatch';
export const WIDGET_KIND = 'StormWidget';

let storage;
let storageFailed = false;

function getStorage() {
  if (storage || storageFailed) return storage;
  try {
    const { ExtensionStorage } = require('@bacons/apple-targets');
    storage = new ExtensionStorage(APP_GROUP);
    storage.reload = (kind) => ExtensionStorage.reloadWidget(kind);
  } catch {
    storageFailed = true;
  }
  return storage;
}

// The snapshot the Swift widget decodes. Deliberately flat and pre-formatted:
// the widget can't recompute anything, and day labels don't go stale the way
// "in 3 days" would.
export function buildWidgetPayload(picture, now = new Date()) {
  const assessed = picture?.assessed || [];
  const top = assessed[0] || null;
  const wind = picture?.wind || null;
  const areas = picture?.outlook?.areas || [];
  const forming = areas.filter((a) => Math.max(a.chance7 ?? 0, a.chance48 ?? 0) >= 40);

  const payload = {
    updatedAt: Math.round((picture?.fetchedAt?.getTime?.() || now.getTime()) / 1000),
    stormCount: assessed.length,
    hurricaneCount: assessed.filter((a) => a.storm.windKt >= 64).length,
    formingCount: forming.length,
  };

  if (top) {
    const cat = saffirSimpson(top.storm.windKt);
    payload.band = top.risk.band;
    payload.score = top.risk.score;
    payload.bandColor = top.risk.color;
    payload.stormName = top.storm.name;
    payload.stormKind = cat ? `Cat ${cat} hurricane` : classificationShort(top.storm.classification);
    payload.stormWindMph = Math.round(ktToMph(top.storm.windKt)) || 0;
    if (top.risk.closest?.point && top.risk.closest.miles <= 2000) {
      payload.closestMiles = Math.round(top.risk.closest.miles);
      payload.closestPlace = top.risk.closest.place;
      payload.closestDay = fmtDayLabel(top.risk.closest.point.time);
    }
  } else {
    payload.band = 'None';
    payload.score = 0;
    payload.bandColor = '#4b8f6f';
  }

  const warning = picture?.warnings?.top;
  if (warning) {
    payload.warnLevel = warning.level;
    payload.warnType = warning.type;
    payload.warnColor = warning.color;
  }
  if (picture?.warnings?.stormName) payload.namedStorm = picture.warnings.stormName;
  const floods = picture?.floods?.counts;
  if (floods && (floods.severe || floods.warning)) {
    payload.floodCount = floods.severe + floods.warning;
  }

  if (wind?.peak) {
    payload.gustMph = Math.round(wind.peak.gustMph);
    payload.gustDay = fmtDayLabel(wind.peak.date);
    payload.gustPlace = wind.peak.worstSpot;
    payload.stormyDayCount = wind.stormyDays?.length || 0;
  }

  return payload;
}

function classificationShort(code) {
  switch (String(code || '').toUpperCase()) {
    case 'TD':
      return 'Tropical depression';
    case 'TS':
      return 'Tropical storm';
    case 'STD':
    case 'SD':
      return 'Subtropical dep.';
    case 'STS':
    case 'SS':
      return 'Subtropical storm';
    case 'PTC':
      return 'Potential cyclone';
    case 'EX':
    case 'PT':
      return 'Post-tropical';
    default:
      return 'Tropical system';
  }
}

// Write the snapshot and reload the widget. Never throws — a widget that
// doesn't exist must not break a refresh.
export function updateWidget(picture) {
  if (Platform.OS !== 'ios') return false;
  const store = getStorage();
  if (!store) return false;
  try {
    store.set(WIDGET_KEY, JSON.stringify(buildWidgetPayload(picture)));
    store.reload(WIDGET_KIND);
    return true;
  } catch {
    return false;
  }
}
