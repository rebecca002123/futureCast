import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const CHANNEL_ID = 'storm-alerts';

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

async function notify(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null),
      },
      trigger: null, // deliver immediately
    });
  } catch {
    // Notifications can be limited in Expo Go — the in-app banner still shows.
  }
}

export function sendRiskNotification(storm, risk) {
  const where = risk.closest?.place ? ` ${Math.round(risk.closest.miles)} miles from ${risk.closest.place}` : '';
  return notify(
    `🌀 ${storm.name}: UK risk ${risk.band.toLowerCase()}`,
    `Its track now passes${where}. Open the app for the forecast and how confident it is.`
  );
}

export function sendNewStormNotification(storm) {
  return notify(
    `🌀 ${storm.name} has formed in the Atlantic`,
    'A new named system is being tracked. Open the app to see whether it has any UK potential.'
  );
}

export function sendFormationNotification(area) {
  const chance = Math.max(area.chance7 ?? 0, area.chance48 ?? 0);
  return notify(
    '🌊 New system likely to develop',
    `${area.title} — ${chance}% chance of forming within 7 days (NHC outlook).`
  );
}

export function sendWindNotification(day) {
  return notify(
    '💨 Windy spell in the UK forecast',
    `Gusts around ${Math.round(day.gustMph)} mph forecast for ${day.dateISO} (${day.worstSpot}). Check Met Office warnings nearer the time.`
  );
}
