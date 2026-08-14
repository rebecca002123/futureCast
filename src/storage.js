import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'christmas-lockbox/v1';

export async function loadVault() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function saveVault(state) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // Persistence is best-effort; the in-memory state stays authoritative.
  }
}

export async function clearVault() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    // ignore
  }
}
