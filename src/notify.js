import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nextDepositDate, windowState, fmtMoney } from './vault';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Re-plan the two reminders that matter: the next monthly deposit and the
// morning the lockbox opens. Called on every app start / settings change,
// so the schedule stays correct without needing background tasks.
export async function planReminders(state) {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = new Date();
    const { symbol, monthlyMinor, unlockDay } = state.config;

    const dep = nextDepositDate(state, now);
    if (dep) {
      const at = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate(), 9, 0, 0);
      if (at > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🎁 Deposit day',
            body: `${fmtMoney(monthlyMinor, symbol)} just went into your Christmas Lockbox. Don't peek!`,
          },
          trigger: { type: 'date', date: at },
        });
      }
    }

    const w = windowState(unlockDay, now);
    if (!w.open) {
      const at = new Date(
        w.opensAt.getFullYear(),
        w.opensAt.getMonth(),
        w.opensAt.getDate(),
        8, 0, 0
      );
      if (at > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🎄 Your Christmas Lockbox is OPEN!',
            body: 'The wait is over — your savings are unlocked. Go treat everyone.',
          },
          trigger: { type: 'date', date: at },
        });
      }
    }
  } catch (e) {
    // Reminders are a nicety; never let them break the app.
  }
}
