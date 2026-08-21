// Reading and writing the two things the app keeps: the shifts and the
// settings. Everything lives on the phone in AsyncStorage — no account, no
// server, no sync. Deleting the app deletes the lot.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { mergeSettings } from './settings';

const SHIFTS_KEY = 'shiftpay.shifts.v1';
const SETTINGS_KEY = 'shiftpay.settings.v1';

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return mergeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return mergeSettings(null);
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: the in-memory settings still apply for this session.
  }
}

export async function loadShifts() {
  try {
    const raw = await AsyncStorage.getItem(SHIFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((shift) => shift && shift.id && shift.date) : [];
  } catch {
    return [];
  }
}

export async function saveShifts(shifts) {
  try {
    await AsyncStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts));
  } catch {
    // Non-fatal, but the next save may well work.
  }
}
