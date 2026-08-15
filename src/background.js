// Background wildfire check — lets a standalone build warn about nearby
// fires while the app is closed. iOS/Android schedule these opportunistically
// (BGTaskScheduler / WorkManager): checks run periodically when the system
// allows, typically every few hours, not on an exact timer. Not supported in
// Expo Go — every call here is guarded so Expo Go just skips it.

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

import { clusterDetections, fetchDetections, haversineMiles } from './fires';
import { sendNearbyFireNotification } from './notify';
import { loadAlerted, loadLastCoords, loadSettings, saveAlerted } from './storage';

export const BACKGROUND_TASK_NAME = 'wildfire-background-check';

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const settings = await loadSettings();
    if (!settings.notificationsEnabled) return BackgroundTask.BackgroundTaskResult.Success;

    // Prefer the OS's cached position; fall back to the last position the
    // app saved while open.
    let coords = null;
    try {
      const pos = await Location.getLastKnownPositionAsync({ maxAge: 6 * 3600000 });
      if (pos) coords = pos.coords;
    } catch {
      // fall through to stored coords
    }
    if (!coords) coords = await loadLastCoords();
    if (!coords) return BackgroundTask.BackgroundTaskResult.Success;

    const { detections, anyOk } = await fetchDetections(12000);
    if (!anyOk) return BackgroundTask.BackgroundTaskResult.Failed;

    const incidents = clusterDetections(detections);
    const alerted = await loadAlerted();
    const fresh = incidents
      .map((inc) => ({ inc, dist: haversineMiles(coords.latitude, coords.longitude, inc.lat, inc.lon) }))
      .filter(({ inc, dist }) => dist <= settings.radiusMiles && !alerted[inc.id])
      .sort((a, b) => a.dist - b.dist);

    if (fresh.length > 0) {
      for (const { inc } of fresh) alerted[inc.id] = Date.now();
      await saveAlerted(alerted);
      await sendNearbyFireNotification(fresh[0].dist, null);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Register the periodic check. Safe to call every launch; no-ops where
// background tasks aren't available (Expo Go, or Background App Refresh
// disabled by the user in iOS Settings).
export async function registerBackgroundCheck() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 15, // minutes — the OS decides the real cadence
    });
    return true;
  } catch {
    return false;
  }
}
