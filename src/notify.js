import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const CHANNEL_ID = 'storm-alerts';

// iOS notification category: taps open the app, and a storm alert also offers
// a "Mute for 24h" button so a system that sits over the Atlantic for a week
// doesn't keep pinging.
export const STORM_CATEGORY = 'storm-alert';
export const MUTE_ACTION = 'mute-storm-24h';

export async function ensureNotificationPermission() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

// Status for the settings screen, so the app can say *why* alerts aren't
// arriving instead of silently failing.
export async function getPermissionStatus() {
  try {
    const perms = await Notifications.getPermissionsAsync();
    return {
      granted: !!perms.granted,
      canAskAgain: perms.canAskAgain !== false,
      status: perms.status || 'undetermined',
    };
  } catch {
    return { granted: false, canAskAgain: true, status: 'unknown' };
  }
}

export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Atlantic storm alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#38bdf8',
    });
  } catch {
    // non-fatal
  }
}

export async function setupNotificationCategories() {
  try {
    await Notifications.setNotificationCategoryAsync(STORM_CATEGORY, [
      {
        identifier: MUTE_ACTION,
        buttonTitle: 'Mute for 24h',
        options: { opensAppToForeground: false },
      },
    ]);
  } catch {
    // Categories aren't available everywhere (and are iOS-only in practice).
  }
}

export async function clearBadge() {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // non-fatal
  }
}

// `urgent` maps to iOS's time-sensitive interruption level, which breaks
// through Focus modes and the summary — reserved for a storm that's actually
// coming our way, never for background noise.
async function notify({ title, body, urgent, data, category }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: data || {},
        interruptionLevel: urgent ? 'timeSensitive' : 'active',
        ...(category ? { categoryIdentifier: category } : null),
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null),
      },
      trigger: null, // deliver immediately
    });
    return true;
  } catch {
    // Notifications can be limited in Expo Go — the in-app banner still shows.
    return false;
  }
}

export function sendRiskNotification(storm, risk) {
  const where = risk.closest?.place
    ? ` about ${Math.round(risk.closest.miles)} miles from ${risk.closest.place}`
    : '';
  return notify({
    title: `🌀 ${storm.name}: UK risk ${risk.band.toLowerCase()}`,
    body: `Its forecast track now passes${where}. Open the app for the track and how confident it is.`,
    urgent: risk.band === 'High' || risk.band === 'Elevated',
    data: { type: 'risk', stormId: storm.id, stormName: storm.name },
    category: STORM_CATEGORY,
  });
}

export function sendNewStormNotification(storm) {
  return notify({
    title: `🌀 ${storm.name} has formed in the Atlantic`,
    body: 'A new named system is being tracked. Open the app to see whether it has any UK potential.',
    urgent: false,
    data: { type: 'new-storm', stormId: storm.id, stormName: storm.name },
    category: STORM_CATEGORY,
  });
}

export function sendFormationNotification(area) {
  const chance = Math.max(area.chance7 ?? 0, area.chance48 ?? 0);
  return notify({
    title: '🌊 New system likely to develop',
    body: `${area.title} — ${chance}% chance of forming within 7 days (NHC outlook).`,
    urgent: false,
    data: { type: 'formation', areaId: area.id },
  });
}

export function sendWindNotification(day) {
  return notify({
    title: '💨 Gales in the UK forecast',
    body: `Gusts around ${Math.round(day.gustMph)} mph forecast for ${day.dateISO} (${day.worstSpot}). Check Met Office warnings nearer the time.`,
    urgent: day.gustMph >= 70,
    data: { type: 'wind', date: day.dateISO },
  });
}

// Fired from the settings screen so alerts can be proved to work without
// waiting for a hurricane.
export function sendTestNotification(picture) {
  const top = picture?.assessed?.[0];
  const body = top
    ? `Alerts are working. Right now the highest UK risk is ${top.storm.name} (${top.risk.band.toLowerCase()}, ${top.risk.score}/100).`
    : 'Alerts are working. No Atlantic storms are active right now.';
  return notify({
    title: '🔔 Storm alerts are on',
    body,
    urgent: false,
    data: { type: 'test' },
  });
}
