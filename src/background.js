// Background storm check — lets a standalone build warn about a storm turning
// towards the UK while the app is closed. iOS/Android schedule these
// opportunistically (BGTaskScheduler / WorkManager): checks run periodically
// when the system allows, typically every few hours, not on an exact timer.
// Not supported in Expo Go — every call here is guarded so Expo Go just skips
// it.

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  sendFloodNotification,
  sendFormationNotification,
  sendNewStormNotification,
  sendRiskNotification,
  sendWarningNotification,
  sendWindNotification,
} from './notify';
import { loadSeasonLog, updateSeasonLog } from './season';
import { loadAlerted, loadMuted, loadSettings, saveAlerted, saveSnapshot } from './storage';
import { evaluateAlerts, fetchStormPicture } from './watch';
import { updateWidget } from './widget';

export const BACKGROUND_TASK_NAME = 'storm-background-check';

// Shorter timeout than the foreground refresh — background execution windows
// are tight, especially on iOS.
const BACKGROUND_TIMEOUT_MS = 12000;

export async function runStormCheck(timeoutMs = BACKGROUND_TIMEOUT_MS) {
  const settings = await loadSettings();

  const picture = await fetchStormPicture(timeoutMs, settings.place || null);
  if (!picture.stormsOk && !picture.wind) return { failed: true };

  await saveSnapshot(snapshotOf(picture));
  loadSeasonLog().then((log) => updateSeasonLog(log, picture.assessed));
  // Refresh the Home Screen widget even when notifications are off — a widget
  // showing yesterday's storm is worse than no widget.
  updateWidget(picture);
  if (!settings.notificationsEnabled) return { skipped: true, widget: true };

  const [alerted, muted] = await Promise.all([loadAlerted(), loadMuted()]);
  const { events, alerted: nextAlerted } = evaluateAlerts(picture, settings, alerted, muted);
  await saveAlerted(nextAlerted);

  // One notification per check, most important first, so a busy season
  // doesn't turn into a burst of alerts.
  const event = pickMostImportant(events);
  if (event) await notifyFor(event);
  return { events: events.length, notified: !!event };
}

function pickMostImportant(events) {
  const order = { warning: 0, flood: 1, risk: 2, 'new-storm': 3, formation: 4, wind: 5 };
  return [...events].sort((a, b) => {
    const byType = (order[a.type] ?? 9) - (order[b.type] ?? 9);
    if (byType !== 0) return byType;
    return (b.risk?.score || 0) - (a.risk?.score || 0);
  })[0];
}

export async function notifyFor(event) {
  switch (event.type) {
    case 'risk':
      return sendRiskNotification(event.storm, event.risk);
    case 'new-storm':
      return sendNewStormNotification(event.storm);
    case 'formation':
      return sendFormationNotification(event.area);
    case 'wind':
      return sendWindNotification(event.day);
    case 'warning':
      return sendWarningNotification(event.warning, event.stormName);
    case 'flood':
      return sendFloodNotification(event.flood);
    default:
      return null;
  }
}

// Trimmed copy of a refresh, small enough to keep in AsyncStorage.
export function snapshotOf(picture) {
  return {
    fetchedAt: picture.fetchedAt?.toISOString?.() || null,
    storms: picture.assessed.map(({ storm, risk }) => ({
      id: storm.id,
      name: storm.name,
      classification: storm.classification,
      windKt: storm.windKt,
      lat: storm.lat,
      lon: storm.lon,
      score: risk.score,
      band: risk.band,
      closestMiles: risk.closest?.miles ?? null,
    })),
    peakGustMph: picture.wind?.peak?.gustMph ?? null,
    peakGustDate: picture.wind?.peak?.dateISO ?? null,
    topWarning: picture.warnings?.top
      ? { level: picture.warnings.top.level, type: picture.warnings.top.type, area: picture.warnings.top.area }
      : null,
  };
}

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const result = await runStormCheck();
    return result?.failed
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
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
      minimumInterval: 60, // minutes — advisories are 6-hourly; the OS decides
    });
    return true;
  } catch {
    return false;
  }
}
