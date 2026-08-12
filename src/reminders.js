import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Schedule local reminders ahead of each eclipse milestone at this location.
// Returns { scheduled: n } or { error: message }.
export async function scheduleEclipseReminders(result) {
  if (!result || !result.visible) return { error: 'No eclipse here.' };
  if (Platform.OS === 'web') {
    return { error: 'Reminders are only available on the phone app.' };
  }
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      return { error: 'Notification permission was denied.' };
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    const now = Date.now();
    const plan = [
      {
        at: result.partialStart.getTime() - 30 * 60000,
        title: '🌘 30 minutes to first contact',
        body: 'The Moon starts crossing the Sun soon. Glasses ready, camera set up, west horizon clear?',
      },
      {
        at: result.partialStart.getTime() - 5 * 60000,
        title: '🌘 5 minutes — eclipse about to start',
        body: 'Put your eclipse glasses on and look up.',
      },
      result.isTotal
        ? {
            at: result.total.start.getTime() - 10 * 60000,
            title: '🌑 10 minutes to TOTALITY',
            body: 'Find your spot. The light is about to get strange.',
          }
        : {
            at: result.maximum.getTime() - 10 * 60000,
            title: '☀️ 10 minutes to maximum eclipse',
            body: 'The deepest point of the eclipse is coming up.',
          },
      result.isTotal
        ? {
            at: result.total.start.getTime() - 60000,
            title: '🌑 ONE MINUTE — totality!',
            body: 'Glasses off when the Sun disappears. Look up. Enjoy it.',
          }
        : null,
    ].filter(Boolean);

    let scheduled = 0;
    for (const r of plan) {
      if (r.at <= now) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: r.title, body: r.body, sound: true },
        trigger: { type: 'date', date: new Date(r.at) },
      });
      scheduled += 1;
    }
    if (scheduled === 0) {
      return { error: 'All reminder times are already past.' };
    }
    return { scheduled };
  } catch (e) {
    return {
      error:
        'Could not schedule reminders on this device' +
        (e?.message ? ` (${e.message})` : '') +
        '.',
    };
  }
}
