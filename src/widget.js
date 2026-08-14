import { Platform } from 'react-native';
import { balanceMinor, projectedAtUnlockMinor, windowState } from './vault';

function isoDay(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Push a snapshot of the lockbox to the iOS home-screen widget. No-ops
// everywhere the native module doesn't exist (web, Android, Expo Go).
export function pushWidgetData(state) {
  if (Platform.OS !== 'ios') return;
  let setWidgetData;
  try {
    // eslint-disable-next-line global-require
    ({ setWidgetData } = require('@bittingz/expo-widgets'));
  } catch (e) {
    return;
  }
  try {
    const now = new Date();
    const w = windowState(state.config.unlockDay, now);
    setWidgetData(
      JSON.stringify({
        balanceMinor: balanceMinor(state),
        symbol: state.config.symbol,
        open: w.open,
        unlockISO: isoDay(w.opensAt),
        closesISO: isoDay(w.closesAt),
        projectedMinor: projectedAtUnlockMinor(state, now),
        goalMinor: state.config.goalMinor ?? null,
      })
    );
  } catch (e) {
    // The widget is decorative — never let it break the app.
  }
}
