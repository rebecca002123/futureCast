import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';

import { clusterDetections, fetchDetections, haversineMiles, hoursAgo, KM_PER_MILE, timeAgoLabel } from './src/fires';
import { fetchFireWeather } from './src/weather';
import {
  ensureNotificationPermission,
  sendNearbyFireNotification,
  setupAndroidChannel,
} from './src/notify';
import { DEFAULT_SETTINGS, loadAlerted, loadSettings, saveAlerted, saveLastCoords, saveSettings } from './src/storage';
import { registerBackgroundCheck } from './src/background';

// react-native-maps is native-only; guard so `expo start --web` still runs.
let MapView = null;
let Marker = null;
let Circle = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Circle = maps.Circle;
}

const REFRESH_MS = 5 * 60 * 1000; // re-check feeds every 5 minutes while open
const STALE_MS = 2 * 60 * 1000; // refresh on returning to foreground if older
const RADIUS_OPTIONS = [5, 15, 30, 60]; // miles

const UK_REGION = {
  latitude: 54.6,
  longitude: -4.0,
  latitudeDelta: 11.5,
  longitudeDelta: 13.0,
};

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [coords, setCoords] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [detectionCount, setDetectionCount] = useState(0);
  const [sources, setSources] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [weather, setWeather] = useState(null);
  const [placeNames, setPlaceNames] = useState({});
  const [now, setNow] = useState(new Date());

  const alertedRef = useRef({});
  const settingsRef = useRef(settings);
  const coordsRef = useRef(null);
  const lastFetchRef = useRef(0);
  const geocodeCacheRef = useRef({});
  const popupShownRef = useRef(false);

  settingsRef.current = settings;
  coordsRef.current = coords;

  const refreshFires = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const { detections, sources: srcs, fetchedAt: at, anyOk } = await fetchDetections();
      if (!anyOk) {
        setFetchError('Could not reach the NASA FIRMS fire feeds. Check your connection and pull down to retry.');
      } else {
        setFetchError(null);
      }
      if (anyOk) {
        const clustered = clusterDetections(detections);
        setIncidents(clustered);
        setDetectionCount(detections.length);
        setFetchedAt(at);
        lastFetchRef.current = Date.now();
        checkProximity(clustered);
        geocodeIncidents(clustered);
      }
      setSources(srcs);
    } catch (e) {
      setFetchError(`Fire data error: ${e.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Warn about incidents inside the alert radius that we haven't already
  // alerted about (per-incident, expires after 24h).
  const checkProximity = useCallback(async (clustered) => {
    const pos = coordsRef.current;
    const { radiusMiles, notificationsEnabled } = settingsRef.current;
    if (!pos) return;

    const fresh = clustered
      .map((inc) => ({ inc, dist: haversineMiles(pos.latitude, pos.longitude, inc.lat, inc.lon) }))
      .filter(({ inc, dist }) => dist <= radiusMiles && !alertedRef.current[inc.id])
      .sort((a, b) => a.dist - b.dist);
    if (fresh.length === 0) return;

    for (const { inc } of fresh) alertedRef.current[inc.id] = Date.now();
    saveAlerted(alertedRef.current);

    const nearest = fresh[0];
    const place = await placeNameFor(nearest.inc);
    if (notificationsEnabled) {
      const granted = await ensureNotificationPermission();
      if (granted) await sendNearbyFireNotification(nearest.dist, place);
    }
    if (!popupShownRef.current) {
      popupShownRef.current = true;
      Alert.alert(
        '🔥 Wildfire detected nearby',
        `Satellite has detected an active fire${place ? ` near ${place}` : ''}, ` +
          `about ${Math.round(nearest.dist)} miles from your location.\n\n` +
          'If you can see fire or smoke, call 999 and ask for the Fire Service.',
        [{ text: 'OK', onPress: () => (popupShownRef.current = false) }]
      );
    }
  }, []);

  const placeNameFor = useCallback(async (inc) => {
    const cache = geocodeCacheRef.current;
    if (cache[inc.id] !== undefined) return cache[inc.id];
    try {
      const res = await Location.reverseGeocodeAsync({ latitude: inc.lat, longitude: inc.lon });
      const g = res && res[0];
      const name = g
        ? [g.city || g.district || g.subregion || g.name, g.region].filter(Boolean).join(', ')
        : '';
      cache[inc.id] = name;
      return name;
    } catch {
      cache[inc.id] = '';
      return '';
    }
  }, []);

  // Best-effort place names for the list (top incidents only, sequential).
  const geocodeIncidents = useCallback(async (clustered) => {
    const top = clustered.slice(0, 12);
    for (const inc of top) {
      const name = await placeNameFor(inc);
      if (name) setPlaceNames((prev) => (prev[inc.id] === name ? prev : { ...prev, [inc.id]: name }));
    }
  }, [placeNameFor]);

  // Boot: settings, alert history, notification channel, location, first fetch.
  useEffect(() => {
    (async () => {
      const [s, alerted] = await Promise.all([loadSettings(), loadAlerted()]);
      setSettings(s);
      settingsRef.current = s;
      alertedRef.current = alerted;
      await setupAndroidChannel();
      // Ask for notification permission up front so nearby-fire alerts can
      // actually be delivered when the first one happens.
      if (s.notificationsEnabled) ensureNotificationPermission();
      // Periodic checks while the app is closed (standalone builds only).
      registerBackgroundCheck();

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCoords(pos.coords);
          coordsRef.current = pos.coords;
          saveLastCoords(pos.coords);
          fetchFireWeather(pos.coords.latitude, pos.coords.longitude)
            .then(setWeather)
            .catch(() => {});
        } else {
          setLocationDenied(true);
        }
      } catch {
        setLocationDenied(true);
      }

      refreshFires();
    })();

    const interval = setInterval(() => refreshFires(), REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastFetchRef.current > STALE_MS) {
        refreshFires();
      }
    });
    return () => {
      clearInterval(interval);
      clearInterval(tick);
      sub.remove();
    };
  }, [refreshFires]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      saveSettings(next);
      return next;
    });
  }, []);

  const withDistance = useMemo(() => {
    const list = incidents.map((inc) => ({
      ...inc,
      distanceMiles: coords
        ? haversineMiles(coords.latitude, coords.longitude, inc.lat, inc.lon)
        : null,
    }));
    list.sort((a, b) => {
      if (a.distanceMiles != null && b.distanceMiles != null) return a.distanceMiles - b.distanceMiles;
      return b.latestTime - a.latestTime;
    });
    return list;
  }, [incidents, coords]);

  const nearest = withDistance.length && withDistance[0].distanceMiles != null ? withDistance[0] : null;

  const banner = useMemo(() => {
    if (loading) return { color: '#2a3140', icon: '🛰', title: 'Checking satellites…', body: 'Fetching the latest fire detections for the UK.' };
    if (fetchError && incidents.length === 0)
      return { color: '#6b3030', icon: '⚠️', title: 'Fire data unavailable', body: fetchError };
    if (!coords) {
      return {
        color: '#4a4530',
        icon: '📍',
        title: locationDenied ? 'Location is off' : 'Finding your location…',
        body: locationDenied
          ? 'Enable location in Settings to get warnings when a fire is detected near you. Fires across the UK are still shown below.'
          : 'Proximity warnings will activate once your location is found.',
      };
    }
    if (nearest && nearest.distanceMiles <= settings.radiusMiles) {
      return {
        color: '#8c2f23',
        icon: '🔥',
        title: `Wildfire ${fmtDist(nearest.distanceMiles)} away`,
        body:
          `Active fire detected ${placeNames[nearest.id] ? `near ${placeNames[nearest.id]}, ` : ''}` +
          `${timeAgoLabel(nearest.latestTime, now)}. If you see fire or smoke, call 999.`,
      };
    }
    if (nearest && nearest.distanceMiles <= settings.radiusMiles * 2) {
      return {
        color: '#7a5a20',
        icon: '⚠️',
        title: `Nearest fire ${fmtDist(nearest.distanceMiles)} away`,
        body: `Outside your ${settings.radiusMiles} mile alert radius, but worth keeping an eye on.`,
      };
    }
    return {
      color: '#1f4a33',
      icon: '✅',
      title: `No wildfires within ${settings.radiusMiles} miles`,
      body: nearest
        ? `Nearest UK detection is ${fmtDist(nearest.distanceMiles)} away.`
        : 'No active fire detections in the UK in the last 24 hours.',
    };
  }, [loading, fetchError, incidents.length, coords, locationDenied, nearest, settings.radiusMiles, placeNames, now]);

  const markerColor = (inc) => {
    const h = hoursAgo(inc.latestTime, now);
    if (h <= 3) return '#ff3b30';
    if (h <= 12) return '#ff9500';
    return '#ffcc00';
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => refreshFires(true)} tintColor="#fff" />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>🔥 UK Wildfire Watch</Text>
          <Text style={styles.subtitle}>
            Live satellite fire detections · {fetchedAt ? `updated ${timeAgoLabel(fetchedAt, now)}` : 'loading…'}
          </Text>
        </View>

        <View style={[styles.banner, { backgroundColor: banner.color }]}>
          <Text style={styles.bannerIcon}>{banner.icon}</Text>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerBody}>{banner.body}</Text>
          </View>
        </View>

        {locationDenied && (
          <Pressable style={styles.linkBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.linkBtnText}>Open phone settings to enable location</Text>
          </Pressable>
        )}

        {MapView ? (
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={UK_REGION} showsUserLocation>
              {coords && Circle && (
                <Circle
                  center={{ latitude: coords.latitude, longitude: coords.longitude }}
                  radius={settings.radiusMiles * KM_PER_MILE * 1000}
                  strokeColor="rgba(120,180,255,0.8)"
                  fillColor="rgba(120,180,255,0.08)"
                />
              )}
              {incidents.map((inc) => (
                <Marker
                  key={inc.id}
                  coordinate={{ latitude: inc.lat, longitude: inc.lon }}
                  pinColor={markerColor(inc)}
                  title={placeNames[inc.id] || `Fire at ${inc.lat.toFixed(2)}, ${inc.lon.toFixed(2)}`}
                  description={`${inc.count} detection${inc.count > 1 ? 's' : ''} · ${timeAgoLabel(inc.latestTime, now)} · ${inc.confidence} confidence`}
                />
              ))}
            </MapView>
            <View style={styles.legend}>
              <LegendDot color="#ff3b30" label="< 3h" />
              <LegendDot color="#ff9500" label="< 12h" />
              <LegendDot color="#ffcc00" label="< 24h" />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>Map view is available on iOS/Android (open in Expo Go).</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <Stat label="Active fires" value={loading ? '…' : String(incidents.length)} />
          <Stat label="Detections 24h" value={loading ? '…' : String(detectionCount)} />
          <Stat label="Alert radius" value={`${settings.radiusMiles} mi`} />
        </View>

        {weather && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Fire weather at your location</Text>
              <View style={[styles.ratingPill, { backgroundColor: weather.rating.color }]}>
                <Text style={styles.ratingText}>{weather.rating.level}</Text>
              </View>
            </View>
            <Text style={styles.cardBody}>
              {Math.round(weather.temp)}°C · {Math.round(weather.rh)}% humidity · wind {Math.round(weather.windMph)} mph
              {weather.gustMph ? ` (gusts ${Math.round(weather.gustMph)})` : ''} ·{' '}
              {weather.daysSinceRain === 0
                ? 'rain today'
                : `${weather.daysSinceRain}+ day${weather.daysSinceRain > 1 ? 's' : ''} since rain`}
            </Text>
            <Text style={styles.smallNote}>
              Indicative conditions rating from live Open-Meteo weather (hot, dry, windy and no recent rain raise it). Not an official fire severity warning.
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>
          {incidents.length ? 'Detected fires (last 24h)' : loading ? 'Loading detections…' : 'No active fires detected 🎉'}
        </Text>
        {!loading && incidents.length === 0 && !fetchError && (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              No satellite fire detections in the UK or Ireland in the last 24 hours. Pull down to re-check any time.
            </Text>
          </View>
        )}
        {withDistance.map((inc) => (
          <View key={inc.id} style={styles.fireCard}>
            <View style={styles.fireCardTop}>
              <Text style={styles.fireName}>
                {placeNames[inc.id] || `${inc.lat.toFixed(3)}, ${inc.lon.toFixed(3)}`}
              </Text>
              {inc.distanceMiles != null && (
                <Text
                  style={[
                    styles.fireDist,
                    inc.distanceMiles <= settings.radiusMiles ? styles.fireDistNear : null,
                  ]}
                >
                  {fmtDist(inc.distanceMiles)}
                </Text>
              )}
            </View>
            <Text style={styles.fireMeta}>
              {timeAgoLabel(inc.latestTime, now)} · {inc.count} detection{inc.count > 1 ? 's' : ''} ·{' '}
              {inc.confidence} confidence
              {inc.maxFrp ? ` · intensity ${inc.maxFrp.toFixed(0)} MW` : ''}
            </Text>
            <Text style={styles.fireSources}>Seen by: {inc.sources.join(', ')}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Alert settings</Text>
        <View style={styles.card}>
          <Text style={styles.cardBody}>Warn me when a fire is detected within:</Text>
          <View style={styles.chipRow}>
            {RADIUS_OPTIONS.map((mi) => (
              <Pressable
                key={mi}
                onPress={() => updateSettings({ radiusMiles: mi })}
                style={[styles.chip, settings.radiusMiles === mi && styles.chipActive]}
              >
                <Text style={[styles.chipText, settings.radiusMiles === mi && styles.chipTextActive]}>
                  {mi} mi
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.toggleRow}
            onPress={() => updateSettings({ notificationsEnabled: !settings.notificationsEnabled })}
          >
            <Text style={styles.cardBody}>Notifications</Text>
            <Text style={styles.toggleValue}>{settings.notificationsEnabled ? 'On 🔔' : 'Off 🔕'}</Text>
          </Pressable>
          <Text style={styles.smallNote}>
            Fire data refreshes automatically every 5 minutes while the app is open, and again each
            time you come back to it. The installed (TestFlight) app also checks periodically while
            closed — iOS decides the exact timing, so keep Background App Refresh on in Settings. In
            Expo Go, checks only run while the app is open.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Data sources</Text>
        <View style={styles.card}>
          {sources.map((s) => (
            <Text key={s.id} style={styles.sourceLine}>
              {s.ok ? '🟢' : '🔴'} NASA FIRMS · {s.id}
              {s.ok ? ` — ${s.count} UK detection${s.count === 1 ? '' : 's'}` : ' — unavailable'}
            </Text>
          ))}
          <Text style={styles.smallNote}>
            Detections come from NASA's FIRMS system (VIIRS 375 m and MODIS 1 km sensors), updated as
            satellites pass over the UK — typically every 1–3 hours, with a further 1–3 h processing
            delay. Small, brief or smouldering fires can be missed, and hot industrial sites
            occasionally appear as false positives. Weather from Open-Meteo.
          </Text>
          <Text style={[styles.smallNote, styles.emergency]}>
            This app is informational and not an official warning service. In an emergency, or if you
            see fire or smoke, call 999.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function fmtDist(miles) {
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function LegendDot({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#12161f' },
  scroll: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 48 },
  header: { marginBottom: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#8b93a3', fontSize: 13, marginTop: 4 },

  banner: { flexDirection: 'row', borderRadius: 14, padding: 14, alignItems: 'center' },
  bannerIcon: { fontSize: 28, marginRight: 12 },
  bannerText: { flex: 1 },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bannerBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 3, lineHeight: 18 },

  linkBtn: { marginTop: 8, alignSelf: 'flex-start' },
  linkBtnText: { color: '#7db4ff', fontSize: 13, textDecorationLine: 'underline' },

  mapWrap: { marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  map: { width: '100%', height: 320 },
  legend: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    backgroundColor: 'rgba(10,14,20,0.75)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 4 },
  legendText: { color: '#dbe1ea', fontSize: 11 },

  statsRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  stat: { flex: 1, backgroundColor: '#1b2230', borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#8b93a3', fontSize: 11, marginTop: 3, textAlign: 'center' },

  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: '#1b2230', borderRadius: 14, padding: 14, marginTop: 8 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  cardBody: { color: '#c6ccd8', fontSize: 14, lineHeight: 20 },
  smallNote: { color: '#77808f', fontSize: 12, lineHeight: 17, marginTop: 10 },
  emergency: { color: '#e0958a' },

  ratingPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  ratingText: { color: '#101418', fontSize: 12, fontWeight: '800' },

  fireCard: { backgroundColor: '#241d1a', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#3a2c24' },
  fireCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fireName: { color: '#ffd9c2', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  fireDist: { color: '#c6ccd8', fontSize: 14, fontWeight: '700' },
  fireDistNear: { color: '#ff6b57' },
  fireMeta: { color: '#b3a89e', fontSize: 13, marginTop: 5, lineHeight: 18 },
  fireSources: { color: '#77808f', fontSize: 11, marginTop: 5 },

  chipRow: { flexDirection: 'row', marginTop: 10, gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#252e40' },
  chipActive: { backgroundColor: '#e05a3c' },
  chipText: { color: '#c6ccd8', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  toggleValue: { color: '#fff', fontSize: 14, fontWeight: '700' },

  sourceLine: { color: '#c6ccd8', fontSize: 13, lineHeight: 22 },
});
