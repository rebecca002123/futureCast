import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'storms.settings.v1';
const ALERTED_KEY = 'storms.alerted.v1';
const SNAPSHOT_KEY = 'storms.snapshot.v1';
const MUTED_KEY = 'storms.muted.v1';

export const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  // Lowest UK risk band that triggers an alert: 'Watch' | 'Elevated' | 'High'
  alertBand: 'Watch',
  // Alert when a new named Atlantic storm forms, or an area of disturbed
  // weather reaches a high chance of developing.
  formationAlerts: true,
  // Alert when the UK 16-day forecast picks up a gale/storm-force day.
  windAlerts: true,
  // Hold non-urgent alerts overnight (23:00–07:00). A storm at High risk
  // still comes through — that's the whole point of the app.
  quietHours: true,
};

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // non-fatal
  }
}

// Keys we've already notified about (a storm reaching a risk band, a new
// named storm, a windy day appearing in the outlook), so alerts don't repeat
// on every refresh. Entries expire after 10 days — longer than any storm's
// life, short enough that next season starts clean.
export async function loadAlerted() {
  try {
    const raw = await AsyncStorage.getItem(ALERTED_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const cutoff = Date.now() - 10 * 24 * 3600000;
    const fresh = {};
    for (const [id, ts] of Object.entries(map)) {
      if (ts > cutoff) fresh[id] = ts;
    }
    return fresh;
  } catch {
    return {};
  }
}

export async function saveAlerted(map) {
  try {
    await AsyncStorage.setItem(ALERTED_KEY, JSON.stringify(map));
  } catch {
    // non-fatal
  }
}

// Last successful fetch, so the app opens showing the previous picture (and
// says how old it is) instead of an empty screen when offline.
export async function saveSnapshot(snapshot) {
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    // non-fatal
  }
}

export async function loadSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // Anything older than a day is more misleading than useful.
    if (!snap.savedAt || Date.now() - snap.savedAt > 24 * 3600000) return null;
    return snap;
  } catch {
    return null;
  }
}

// Storms the user has muted from a notification's "Mute for 24h" button.
export async function loadMuted() {
  try {
    const raw = await AsyncStorage.getItem(MUTED_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    const live = {};
    for (const [id, until] of Object.entries(map)) {
      if (until > now) live[id] = until;
    }
    return live;
  } catch {
    return {};
  }
}

export async function muteStorm(stormId, hours = 24) {
  try {
    const muted = await loadMuted();
    muted[stormId] = Date.now() + hours * 3600000;
    await AsyncStorage.setItem(MUTED_KEY, JSON.stringify(muted));
    return muted;
  } catch {
    return {};
  }
}

export async function unmuteStorm(stormId) {
  try {
    const muted = await loadMuted();
    delete muted[stormId];
    await AsyncStorage.setItem(MUTED_KEY, JSON.stringify(muted));
    return muted;
  } catch {
    return {};
  }
}
