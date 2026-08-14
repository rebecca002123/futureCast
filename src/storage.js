import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'wildfire.settings.v1';
const ALERTED_KEY = 'wildfire.alerted.v1';

export const DEFAULT_SETTINGS = {
  radiusMiles: 30,
  notificationsEnabled: true,
};

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // Migrate from the km-based setting of v1.0.
    if (stored.radiusKm && !stored.radiusMiles) {
      stored.radiusMiles = Math.round(stored.radiusKm * 0.621371);
      delete stored.radiusKm;
    }
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

// Incident ids we've already notified about, so alerts don't repeat on every
// refresh. Entries expire after 24h (matching the 24h detection window).
export async function loadAlerted() {
  try {
    const raw = await AsyncStorage.getItem(ALERTED_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const cutoff = Date.now() - 24 * 3600000;
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
