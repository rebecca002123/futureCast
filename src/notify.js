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
    await Notifications.setNotificationChannelAsync('wildfire-alerts', {
      name: 'Wildfire proximity alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#ff5722',
    });
  } catch {
    // non-fatal
  }
}

export async function sendNearbyFireNotification(distanceMiles, placeName) {
  try {
    const where = placeName ? ` near ${placeName}` : '';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔥 Wildfire detected nearby',
        body:
          `Satellite has detected a fire${where}, about ${Math.round(distanceMiles)} miles from you. ` +
          'Open the app for details. If you see fire or smoke, call 999.',
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'wildfire-alerts' } : null),
      },
      trigger: null, // deliver immediately
    });
  } catch {
    // Notifications can be limited in Expo Go — the in-app banner still shows.
  }
}
