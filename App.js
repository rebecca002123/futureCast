import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import {
  classificationLabel,
  compassPoint,
  fmtDayLabel,
  intensityLabel,
  ktToMph,
  leadTimeLabel,
  OUTLOOK_GRAPHIC_URL,
  saffirSimpson,
  stormColor,
  timeAgoLabel,
} from './src/storms';
import { outlookWatchLevel, UK_CENTRE } from './src/ukrisk';
import { searchTowns } from './src/places';
import { buildRadarHtml } from './src/radar';
import {
  climatologyToDate,
  daysToPeak,
  HISTORIC_UK_STORMS,
  loadSeasonLog,
  seasonActivityLabel,
  seasonStormNumber,
  updateSeasonLog,
} from './src/season';
import { WINDSTORM_GUST_MPH } from './src/ukwind';
import { evaluateAlerts, fetchStormPicture, inQuietHours, summarise } from './src/watch';
import {
  clearBadge,
  ensureNotificationPermission,
  getPermissionStatus,
  MUTE_ACTION,
  sendTestNotification,
  setupAndroidChannel,
  setupNotificationCategories,
} from './src/notify';
import {
  DEFAULT_SETTINGS,
  loadAlerted,
  loadMuted,
  loadSettings,
  loadSnapshot,
  muteStorm,
  saveAlerted,
  saveSettings,
  saveSnapshot,
  unmuteStorm,
} from './src/storage';
import { notifyFor, registerBackgroundCheck, snapshotOf } from './src/background';
import { updateWidget } from './src/widget';

// react-native-maps and the WebView are native-only; guard so
// `expo start --web` still runs (the radar falls back to an iframe there).
let MapView = null;
let Marker = null;
let Polyline = null;
let WebView = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  // Older installed builds don't contain the WebView native module — an OTA
  // update must degrade gracefully there, never crash.
  try {
    WebView = require('react-native-webview').WebView;
  } catch {
    WebView = null;
  }
}

const REFRESH_MS = 10 * 60 * 1000; // advisories are 6-hourly; re-check every 10 min
const STALE_MS = 5 * 60 * 1000; // refresh on foreground if older than this
const ALERT_BANDS = ['Watch', 'Elevated', 'High'];

// The whole hurricane highway: the tropical Atlantic through to the UK.
const ATLANTIC_REGION = {
  latitude: 40.0,
  longitude: -42.0,
  latitudeDelta: 46.0,
  longitudeDelta: 90.0,
};

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [picture, setPicture] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [muted, setMuted] = useState({});
  const [townQuery, setTownQuery] = useState('');
  const [seasonLog, setSeasonLog] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [permission, setPermission] = useState(null);
  const [testSent, setTestSent] = useState(false);
  const [now, setNow] = useState(new Date());

  const alertedRef = useRef({});
  const mutedRef = useRef({});
  const pictureRef = useRef(null);
  const settingsRef = useRef(settings);
  const lastFetchRef = useRef(0);
  settingsRef.current = settings;

  const refresh = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const next = await fetchStormPicture(20000, settingsRef.current.place || null);
      setPicture(next);
      pictureRef.current = next;
      lastFetchRef.current = Date.now();
      if (next.stormsOk) {
        loadSeasonLog()
          .then((log) => updateSeasonLog(log, next.assessed))
          .then(setSeasonLog)
          .catch(() => {});
      }

      if (next.stormsOk || next.wind) {
        saveSnapshot(snapshotOf(next));
        updateWidget(next);
        const { events, alerted } = evaluateAlerts(next, settingsRef.current, alertedRef.current, mutedRef.current);
        alertedRef.current = alerted;
        saveAlerted(alerted);
        if (settingsRef.current.notificationsEnabled && events.length) {
          const granted = await ensureNotificationPermission();
          if (granted) {
            // Foreground alerts are the same ones the background check sends.
            for (const event of events.slice(0, 3)) await notifyFor(event);
          }
        }
      }
    } catch (e) {
      setPicture((prev) => prev || { assessed: [], outlook: { areas: [] }, wind: null, errors: [String(e.message || e)], stormsOk: false, fetchedAt: new Date() });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [s, alerted, snap, mutedMap] = await Promise.all([
        loadSettings(),
        loadAlerted(),
        loadSnapshot(),
        loadMuted(),
      ]);
      setSettings(s);
      settingsRef.current = s;
      alertedRef.current = alerted;
      mutedRef.current = mutedMap;
      setMuted(mutedMap);
      setSnapshot(snap);
      loadSeasonLog().then(setSeasonLog).catch(() => {});
      await setupAndroidChannel();
      await setupNotificationCategories();
      if (s.notificationsEnabled) await ensureNotificationPermission();
      setPermission(await getPermissionStatus());
      clearBadge();
      registerBackgroundCheck();
      refresh();
    })();

    const interval = setInterval(() => refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), 60000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearBadge();
      if (Date.now() - lastFetchRef.current > STALE_MS) refresh();
    });

    // "Mute for 24h" on a storm alert, tapped from the notification itself.
    let responseSub = null;
    try {
      responseSub = Notifications.addNotificationResponseReceivedListener(async (response) => {
        const { actionIdentifier, notification } = response || {};
        const stormId = notification?.request?.content?.data?.stormId;
        if (actionIdentifier === MUTE_ACTION && stormId) {
          const next = await muteStorm(stormId, 24);
          mutedRef.current = next;
          setMuted(next);
        }
      });
    } catch {
      // Notification responses aren't available on every platform.
    }

    return () => {
      clearInterval(interval);
      clearInterval(tick);
      sub.remove();
      responseSub?.remove();
    };
  }, [refresh]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      saveSettings(next);
      return next;
    });
  }, []);

  const sendTest = useCallback(async () => {
    const granted = await ensureNotificationPermission();
    const status = await getPermissionStatus();
    setPermission(status);
    if (!granted) return;
    await sendTestNotification(pictureRef.current);
    setTestSent(true);
    setTimeout(() => setTestSent(false), 5000);
  }, []);

  const unmute = useCallback(async (stormId) => {
    const next = await unmuteStorm(stormId);
    mutedRef.current = next;
    setMuted(next);
  }, []);

  const summary = useMemo(() => summarise(picture), [picture]);
  const assessed = picture?.assessed || [];
  const areas = picture?.outlook?.areas || [];
  const wind = picture?.wind || null;
  const dataDown = picture && !picture.stormsOk;

  const banner = useMemo(() => {
    if (loading && !picture) {
      return { color: '#25304a', icon: '🛰', title: 'Checking the Atlantic…', body: 'Fetching the latest National Hurricane Center advisories.' };
    }
    if (dataDown && assessed.length === 0) {
      return {
        color: '#5d2a2a',
        icon: '⚠️',
        title: 'Storm data unavailable',
        body: snapshot
          ? `Couldn't reach the NHC. Showing what was last known${snapshot.fetchedAt ? ` (${timeAgoLabel(new Date(snapshot.fetchedAt), now)})` : ''}. Pull down to retry.`
          : "Couldn't reach the National Hurricane Center. Check your connection and pull down to retry.",
      };
    }
    const warn = summary.topWarning;
    if (warn && warn.rank >= 3) {
      return {
        color: '#8c1d1d',
        icon: '🔴',
        title: `RED ${warn.type.toLowerCase()} warning${summary.stormName ? ` — Storm ${summary.stormName}` : ''}`,
        body: `The Met Office has a red warning for ${warn.area}. Dangerous conditions expected — follow official advice.`,
      };
    }
    const top = summary.top;
    if (top && top.risk.score >= 60) {
      return {
        color: top.risk.score >= 80 ? '#8c1d1d' : '#8a3d16',
        icon: '🌀',
        title: `${top.storm.name} — UK risk ${top.risk.band.toLowerCase()}`,
        body:
          `Its track comes within about ${Math.round(top.risk.closest.miles)} miles of ${top.risk.closest.place} ` +
          `${leadTimeLabel(top.risk.closest.point.time, now)}. ${confidenceSentence(top.risk)}`,
      };
    }
    if (top && top.risk.score >= 38) {
      return {
        color: '#6b5a19',
        icon: '👀',
        title: `${top.storm.name} is worth watching`,
        body:
          `Recurving towards the north-east Atlantic — closest approach about ${Math.round(top.risk.closest.miles)} miles ` +
          `from ${top.risk.closest.place} ${leadTimeLabel(top.risk.closest.point.time, now)}. ${confidenceSentence(top.risk)}`,
      };
    }
    if (warn && warn.rank >= 2) {
      return {
        color: '#8a3d16',
        icon: '⚠️',
        title: `Amber ${warn.type.toLowerCase()} warning${summary.stormName ? ` — Storm ${summary.stormName}` : ''}`,
        body: `In force for ${warn.area}. ${assessed.length ? 'Storm details below.' : 'Check the Met Office for timing and impacts.'}`,
      };
    }
    if (wind?.stormyDays?.length) {
      const d = wind.stormyDays[0];
      return {
        color: '#6b5a19',
        icon: '💨',
        title: `Windy spell forecast for ${fmtDayLabel(d.date)}`,
        body:
          `Gusts near ${Math.round(d.gustMph)} mph around ${d.worstSpot}. ` +
          (assessed.length
            ? 'No Atlantic storm is currently forecast towards us, so this is ordinary UK weather.'
            : 'Not linked to any active tropical system.'),
      };
    }
    if (assessed.length) {
      return {
        color: '#1f4a3f',
        icon: '✅',
        title: `${assessed.length} Atlantic system${assessed.length > 1 ? 's' : ''}, none aimed at the UK`,
        body: `Nearest track stays about ${Math.round(summary.top.risk.closest.miles)} miles away. ${
          summary.forming ? `${summary.forming} area${summary.forming > 1 ? 's' : ''} of disturbed weather could still develop.` : ''
        }`.trim(),
      };
    }
    return {
      color: '#1f4a3f',
      icon: '✅',
      title: 'No active Atlantic storms',
      body: summary.forming
        ? `The NHC is watching ${summary.forming} area${summary.forming > 1 ? 's' : ''} that could develop — see the formation watch below.`
        : 'Nothing tropical to track right now. Pull down any time to re-check.',
    };
  }, [loading, picture, dataDown, assessed.length, summary, wind, snapshot, now]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor="#fff" />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🌀 Atlantic Storm Watch</Text>
          <Text style={styles.subtitle}>
            Live NHC hurricane data + UK outlook ·{' '}
            {picture?.fetchedAt ? `updated ${timeAgoLabel(picture.fetchedAt, now)}` : 'loading…'}
          </Text>
        </View>

        <View style={[styles.banner, { backgroundColor: banner.color }]}>
          <Text style={styles.bannerIcon}>{banner.icon}</Text>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerBody}>{banner.body}</Text>
          </View>
        </View>

        {MapView ? (
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={ATLANTIC_REGION} mapType="mutedStandard">
              {(picture?.lows?.lows || []).map((low) => (
                <React.Fragment key={low.id}>
                  {Polyline && low.points.length > 1 && (
                    <Polyline
                      coordinates={low.points.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
                      strokeColor="#8899bb"
                      strokeWidth={2}
                      lineDashPattern={[4, 6]}
                    />
                  )}
                  <Marker
                    coordinate={{ latitude: low.current.lat, longitude: low.current.lon }}
                    title={`${low.exName ? `Ex-${low.exName} · ` : ''}${low.minPressure} hPa low`}
                    description={`Model estimate · gusts ${low.maxGust} mph · ${low.threat.label}`}
                    pinColor="#8899bb"
                  />
                </React.Fragment>
              ))}
              <Marker
                coordinate={{ latitude: UK_CENTRE.lat, longitude: UK_CENTRE.lon }}
                title="United Kingdom"
                description="Distances and risk are measured to the nearest UK coast"
                pinColor="#4dabf7"
              />
              {assessed.map(({ storm, risk }) => (
                <React.Fragment key={storm.id}>
                  {Polyline && risk.official.length > 1 && (
                    <Polyline
                      coordinates={risk.official.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
                      strokeColor={stormColor(storm)}
                      strokeWidth={3}
                    />
                  )}
                  {Polyline && risk.official.length > 0 && risk.projected.length > 1 && (
                    <Polyline
                      coordinates={[risk.official[risk.official.length - 1], ...risk.projected].map((p) => ({
                        latitude: p.lat,
                        longitude: p.lon,
                      }))}
                      strokeColor={stormColor(storm)}
                      strokeWidth={2}
                      lineDashPattern={[8, 8]}
                    />
                  )}
                  <Marker
                    coordinate={{ latitude: storm.lat, longitude: storm.lon }}
                    title={`${storm.name} · ${intensityLabel(storm)}`}
                    description={`${Math.round(ktToMph(storm.windKt))} mph winds · UK risk ${risk.band}`}
                    pinColor={saffirSimpson(storm.windKt) ? '#ff3b30' : '#ffcc00'}
                  />
                </React.Fragment>
              ))}
            </MapView>
            <View style={styles.legend}>
              <Text style={styles.legendText}>— NHC forecast   ┈ app extrapolation</Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>The map is available on iOS/Android (open in Expo Go).</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Live wind radar</Text>
        <WindRadar assessed={assessed} lows={picture?.lows?.lows} />
        <Text style={styles.smallNote}>
          Model wind for the next 4 days — drag the timeline to watch systems move, and touch the map to read the
          wind speed anywhere. Colours are sustained wind in mph; the white streaks flow with the wind.
        </Text>

        <View style={styles.statsRow}>
          <Stat label="Active systems" value={loading && !picture ? '…' : String(assessed.length)} />
          <Stat label="Hurricanes" value={loading && !picture ? '…' : String(summary.hurricanes)} />
          <Stat label="Could form" value={loading && !picture ? '…' : String(areas.length)} />
          <Stat
            label="UK risk"
            value={assessed.length ? summary.top.risk.band : '—'}
            color={assessed.length ? summary.top.risk.color : undefined}
          />
        </View>

        <Text style={styles.sectionTitle}>Official UK weather warnings</Text>
        {picture?.warnings ? (
          picture.warnings.warnings.length ? (
            <View style={styles.card}>
              {summary.stormName ? (
                <Text style={[styles.cardBody, styles.namedStorm]}>
                  🌀 The Met Office has named this storm: Storm {summary.stormName}
                </Text>
              ) : null}
              {picture.warnings.warnings.slice(0, 8).map((w) => (
                <View key={w.id} style={styles.warningRow}>
                  <View style={[styles.warnPill, { backgroundColor: w.color }]}>
                    <Text style={styles.warnPillText}>{w.level.toUpperCase()}</Text>
                  </View>
                  <View style={styles.warningTextWrap}>
                    <Text style={styles.cardBody}>
                      {w.icon} {w.type} — {w.area}
                    </Text>
                    <Text style={styles.warnMeta}>
                      {w.active ? 'In force now' : w.onset ? `From ${fmtDayLabel(w.onset)}` : ''}
                      {w.expires ? ` until ${fmtDayLabel(w.expires)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
              <Pressable onPress={() => Linking.openURL('https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings')}>
                <Text style={styles.linkBtnText}>Full details on the Met Office site ↗</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardBody}>✅ No weather warnings in force for the UK right now.</Text>
              <Text style={styles.smallNote}>
                Live from MeteoAlarm, which republishes the Met Office's yellow/amber/red warnings.
              </Text>
            </View>
          )
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>Warnings feed unavailable — pull down to retry.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>
          {assessed.length ? 'Active Atlantic storms' : loading && !picture ? 'Loading storms…' : 'Active Atlantic storms'}
        </Text>
        {!assessed.length && !loading && (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              The National Hurricane Center is not tracking any Atlantic tropical cyclones right now. The
              formation watch below shows anything that might spin up over the next week.
            </Text>
          </View>
        )}
        {assessed.map(({ storm, risk }) => (
          <StormCard
            key={storm.id}
            storm={storm}
            risk={risk}
            now={now}
            muted={muted[storm.id] > now.getTime()}
            open={!!expanded[storm.id]}
            onToggle={() => setExpanded((p) => ({ ...p, [storm.id]: !p[storm.id] }))}
          />
        ))}

        <Text style={styles.sectionTitle}>Atlantic lows radar</Text>
        {picture?.lows?.gridOk ? (
          picture.lows.lows.length ? (
            <>
              {picture.lows.lows.slice(0, 4).map((low) => (
                <View key={low.id} style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle}>
                      {low.exName ? `Ex-${low.exName} · ` : ''}
                      {low.minPressure} hPa low
                      {low.startsInFuture ? ' (forecast to form)' : ''}
                    </Text>
                    <View style={[styles.ratingPill, { backgroundColor: low.threat.color }]}>
                      <Text style={styles.ratingText}>{low.threat.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardBody}>
                    {fmtLatLon(low.current.lat, low.current.lon)}
                    {low.headingLabel ? ` · moving ${low.headingLabel}${low.speedMph ? ` at ${low.speedMph} mph` : ''}` : ' · slow-moving'}
                    {` · gusts near the centre up to ${low.maxGust} mph`}
                  </Text>
                  <Text style={styles.cardBody}>
                    Closest to the UK: ~{Math.round(low.closest.miles).toLocaleString()} miles from {low.closest.place}{' '}
                    {leadTimeLabel(low.closest.point.time, now)}
                  </Text>
                </View>
              ))}
              <Text style={styles.smallNote}>
                Every deep low the global weather model sees in the North Atlantic over the next 7 days — including
                ex-hurricanes after the NHC stops tracking them, and ordinary windstorms that were never tropical.
                Positions are model estimates on a coarse grid, not official advisories.
              </Text>
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardBody}>
                ✅ No deep low-pressure systems in the North Atlantic forecast for the next 7 days.
              </Text>
              <Text style={styles.smallNote}>
                This scan catches ex-hurricanes after the NHC stops advising on them, plus non-tropical windstorms.
              </Text>
            </View>
          )
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>Atlantic lows scan unavailable — pull down to retry.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Risk for my location</Text>
        <View style={styles.card}>
          {settings.place ? (
            <>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>📍 {settings.place.name}</Text>
                <Pressable onPress={() => updateSettings({ place: null })}>
                  <Text style={styles.changeLink}>Change</Text>
                </Pressable>
              </View>
              {picture?.local?.storms?.length ? (
                picture.local.storms.slice(0, 2).map(({ storm, closest }) => (
                  <Text key={storm.id} style={styles.cardBody}>
                    🌀 {storm.name}: track passes ~{Math.round(closest.miles).toLocaleString()} miles from you
                    {closest.point?.time ? ` ${leadTimeLabel(closest.point.time, now)}` : ''}
                    {closest.point?.extrapolated ? ' (extrapolated)' : ' (NHC forecast)'}
                  </Text>
                ))
              ) : (
                <Text style={styles.cardBody}>
                  {assessed.length
                    ? 'No storm track currently passes anywhere near you.'
                    : 'No active storms to measure from.'}
                </Text>
              )}
              {picture?.local?.wind?.peak ? (
                <Text style={[styles.cardBody, { marginTop: 8 }]}>
                  💨 Windiest day for you: {Math.round(picture.local.wind.peak.gustMph)} mph gusts on{' '}
                  {fmtDayLabel(picture.local.wind.peak.date)}
                  {picture.local.wind.stormyDays.length
                    ? ` · ${picture.local.wind.stormyDays.length} gale-force day${picture.local.wind.stormyDays.length > 1 ? 's' : ''} in the next 16`
                    : ' — nothing gale-force in the next 16 days'}
                </Text>
              ) : null}
              <Text style={styles.smallNote}>
                Distances are to your town from each storm's forecast track; wind is the 16-day Open-Meteo forecast for
                your coordinates.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.cardBody}>
                Pick your town to see how close each storm's track comes to you and your own 16-day wind outlook.
              </Text>
              <TextInput
                style={styles.townInput}
                placeholder="Start typing your town…"
                placeholderTextColor="#63708a"
                value={townQuery}
                onChangeText={setTownQuery}
                autoCorrect={false}
              />
              {searchTowns(townQuery).map((town) => (
                <Pressable
                  key={town.name}
                  style={styles.townRow}
                  onPress={() => {
                    updateSettings({ place: town });
                    setTownQuery('');
                    refresh();
                  }}
                >
                  <Text style={styles.cardBody}>📍 {town.name}</Text>
                </Pressable>
              ))}
              <Text style={styles.smallNote}>
                Stored only on your phone. No GPS permission needed — and you can change it any time.
              </Text>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Formation watch (next 7 days)</Text>
        {areas.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              {picture?.outlook?.body
                ? 'No areas of disturbed weather are being highlighted — tropical cyclone formation is not expected during the next 7 days.'
                : 'Formation outlook unavailable — pull down to retry.'}
            </Text>
          </View>
        ) : (
          areas.map((area) => <OutlookCard key={area.id} area={area} />)
        )}
        {picture?.outlook?.issuedAt && (
          <Pressable onPress={() => Linking.openURL(OUTLOOK_GRAPHIC_URL)}>
            <Text style={styles.linkBtnText}>
              NHC tropical weather outlook, issued {timeAgoLabel(picture.outlook.issuedAt, now)} — view the map ↗
            </Text>
          </Pressable>
        )}

        <Text style={styles.sectionTitle}>UK wind outlook (16 days)</Text>
        {wind && wind.peak ? (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              {wind.stormyDays.length
                ? `Gales or worse currently forecast on ${wind.stormyDays.length} day${wind.stormyDays.length > 1 ? 's' : ''}. `
                : 'Nothing stormy in the forecast yet. '}
              Peak gust {Math.round(wind.peak.gustMph)} mph on {fmtDayLabel(wind.peak.date)} near {wind.peak.worstSpot}.
            </Text>
            <View style={styles.windRows}>
              {wind.days.map((d) => (
                <View key={d.dateISO} style={styles.windRow}>
                  <Text style={styles.windDay}>{fmtDayLabel(d.date)}</Text>
                  <View style={styles.windBarTrack}>
                    <View
                      style={[
                        styles.windBarFill,
                        { width: `${Math.min(100, (d.gustMph / 90) * 100)}%`, backgroundColor: d.band.color },
                      ]}
                    />
                  </View>
                  <Text style={styles.windValue}>{Math.round(d.gustMph)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.smallNote}>
              Highest forecast gust (mph) anywhere in {`${wind.locations}`} UK locations, from the Open-Meteo global
              model. This is where an ex-hurricane actually shows up for us: once a storm is being pulled across the
              Atlantic, the models put the wind into this chart days before it arrives. Gusts above {WINDSTORM_GUST_MPH}{' '}
              mph are gale/storm force. Always check Met Office warnings for the official picture.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>UK wind outlook unavailable — pull down to retry.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Flood warnings (England)</Text>
        {picture?.floods ? (
          picture.floods.floods.length ? (
            <View style={styles.card}>
              <Text style={styles.cardBody}>
                {picture.floods.counts.severe ? `🚨 ${picture.floods.counts.severe} severe · ` : ''}
                {picture.floods.counts.warning} warning{picture.floods.counts.warning === 1 ? '' : 's'} ·{' '}
                {picture.floods.counts.alert} alert{picture.floods.counts.alert === 1 ? '' : 's'}
              </Text>
              {picture.floods.floods.slice(0, 6).map((f) => (
                <View key={f.id} style={styles.warningRow}>
                  <View style={[styles.warnPill, { backgroundColor: f.color }]}>
                    <Text style={styles.warnPillText}>{f.short.toUpperCase()}</Text>
                  </View>
                  <View style={styles.warningTextWrap}>
                    <Text style={styles.cardBody}>{f.area}</Text>
                    {f.region ? <Text style={styles.warnMeta}>{f.region}</Text> : null}
                  </View>
                </View>
              ))}
              {picture.floods.floods.length > 6 ? (
                <Text style={styles.smallNote}>…and {picture.floods.floods.length - 6} more.</Text>
              ) : null}
              <Pressable onPress={() => Linking.openURL('https://check-for-flooding.service.gov.uk/')}>
                <Text style={styles.linkBtnText}>Check your area on gov.uk ↗</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardBody}>✅ No flood alerts or warnings in force in England.</Text>
              <Text style={styles.smallNote}>
                Live from the Environment Agency (England only — Wales and Scotland publish theirs separately at
                Natural Resources Wales and SEPA).
              </Text>
            </View>
          )
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardBody}>Flood feed unavailable — pull down to retry.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>This hurricane season</Text>
        <View style={styles.card}>
          <SeasonStats assessed={assessed} seasonLog={seasonLog} now={now} />
          {Object.keys(seasonLog).length ? (
            <>
              <Text style={styles.detailHeading}>Systems tracked this season</Text>
              {Object.entries(seasonLog)
                .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
                .slice(0, 8)
                .map(([id, entry]) => (
                  <Text key={id} style={styles.detailLine}>
                    🌀 {entry.name} — peaked {Math.round(ktToMph(entry.maxWindKt))} mph
                    {isFinite(entry.minUKMiles)
                      ? ` · track came within ${Math.round(entry.minUKMiles).toLocaleString()} mi of the UK`
                      : ''}
                  </Text>
                ))}
            </>
          ) : null}
          <Pressable onPress={() => setShowHistory((v) => !v)}>
            <Text style={styles.linkBtnText}>
              {showHistory ? 'Hide' : 'Show'} ex-hurricanes that reached the UK {showHistory ? '▴' : '▾'}
            </Text>
          </Pressable>
          {showHistory
            ? HISTORIC_UK_STORMS.map((h) => (
                <Text key={`${h.year}-${h.name}`} style={styles.detailLine}>
                  <Text style={styles.bold}>{h.name} ({h.year})</Text> — {h.note}
                </Text>
              ))
            : null}
        </View>

        <Text style={styles.sectionTitle}>Alerts</Text>
        <View style={styles.card}>
          <Text style={styles.cardBody}>Notify me when a storm's UK risk reaches:</Text>
          <View style={styles.chipRow}>
            {ALERT_BANDS.map((band) => (
              <Pressable
                key={band}
                onPress={() => updateSettings({ alertBand: band })}
                style={[styles.chip, settings.alertBand === band && styles.chipActive]}
              >
                <Text style={[styles.chipText, settings.alertBand === band && styles.chipTextActive]}>{band}</Text>
              </Pressable>
            ))}
          </View>
          <Toggle
            label="Notifications"
            value={settings.notificationsEnabled}
            onPress={() => updateSettings({ notificationsEnabled: !settings.notificationsEnabled })}
          />
          <Toggle
            label="New storms & formation alerts"
            value={settings.formationAlerts}
            onPress={() => updateSettings({ formationAlerts: !settings.formationAlerts })}
          />
          <Toggle
            label="UK gale-force wind alerts"
            value={settings.windAlerts}
            onPress={() => updateSettings({ windAlerts: !settings.windAlerts })}
          />
          <Toggle
            label="Amber/red weather warnings"
            value={settings.warningAlerts !== false}
            onPress={() => updateSettings({ warningAlerts: settings.warningAlerts === false })}
          />
          <Toggle
            label="Flood warnings (England)"
            value={settings.floodAlerts !== false}
            onPress={() => updateSettings({ floodAlerts: settings.floodAlerts === false })}
          />
          <Toggle
            label="Quiet overnight"
            hint="Holds routine alerts between 11pm and 7am. A storm at Elevated or High risk still comes straight through."
            value={settings.quietHours}
            onPress={() => updateSettings({ quietHours: !settings.quietHours })}
          />

          {settings.notificationsEnabled && permission && !permission.granted ? (
            <View style={styles.warnRow}>
              <Text style={styles.warnText}>
                Notifications are turned off for this app in your phone's settings, so alerts can't be delivered.
              </Text>
              <Pressable onPress={() => Linking.openSettings()}>
                <Text style={styles.linkBtnText}>Open phone settings ↗</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable style={styles.testBtn} onPress={sendTest}>
            <Text style={styles.testBtnText}>
              {testSent ? '✅ Test notification sent' : '🔔 Send a test notification'}
            </Text>
          </Pressable>

          {Object.keys(muted).length ? (
            <View style={styles.mutedWrap}>
              <Text style={styles.detailHeading}>Muted storms</Text>
              {Object.entries(muted).map(([id, until]) => {
                const storm = assessed.find((a) => a.storm.id === id)?.storm;
                return (
                  <Pressable key={id} style={styles.mutedRow} onPress={() => unmute(id)}>
                    <Text style={styles.cardBody}>
                      {storm ? storm.name : id.toUpperCase()} · quiet until{' '}
                      {new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.toggleValue}>Unmute</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.smallNote}>
            Storm alerts arrive as time-sensitive notifications when a storm is at Elevated or High risk, so they break
            through Focus modes; everything else is a normal alert. Each storm alert has a "Mute for 24h" button if a
            system is lingering{inQuietHours(now, settings) ? ' · quiet hours are active right now' : ''}.
          </Text>
          <Text style={styles.smallNote}>
            Data refreshes every 10 minutes while the app is open and each time you come back to it. The installed
            (TestFlight) app also checks periodically while closed — iOS decides the exact timing, so keep Background
            App Refresh on. In Expo Go, checks only run while the app is open.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Home Screen widget</Text>
        <View style={styles.card}>
          <Text style={styles.cardBody}>
            Add the Atlantic Storm Watch widget to see the highest UK risk without opening the app: long-press your
            Home Screen → <Text style={styles.bold}>+</Text> → search for Storm Watch. The small size shows the risk
            band and the storm behind it, the medium size adds the closest approach and the next windy UK day, and
            there are Lock Screen versions too.
          </Text>
          <Text style={styles.smallNote}>
            The widget shows whatever the app last worked out. It updates every time the app refreshes — including the
            background checks while the app is closed — so keep Background App Refresh on to stop it going stale.
            Widgets need the installed build; they don't appear in Expo Go.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>How the UK prediction works</Text>
        <View style={styles.card}>
          <Text style={styles.cardBody}>
            Each storm's official NHC forecast track (out to 5 days) is extended along the heading and speed of its
            final leg — the path a storm follows once the jet stream picks it up. The app then measures how close that
            combined path comes to the UK, how well it is aimed at us, whether it is recurving north-east, and how
            strong it is, and turns that into the risk score.
          </Text>
          <Text style={styles.smallNote}>
            The dashed part of every track, and anything beyond day 5, is the app's own extrapolation — not an NHC
            forecast. Storms that reach us have almost always stopped being hurricanes by then and arrive as
            ex-hurricane windstorms: strong wind and rain rather than a hurricane landfall. Treat the score as "how
            much attention is this worth today", not a forecast of what will happen.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Data sources</Text>
        <View style={styles.card}>
          <SourceLine
            ok={!!picture?.stormsOk}
            label="NHC CurrentStorms.json — active storm positions & intensity"
          />
          <SourceLine
            ok={assessed.some((a) => a.track)}
            label="NHC forecast/advisory (TCM) — official 5-day forecast tracks"
          />
          <SourceLine ok={areas.length > 0 || !!picture?.outlook?.body} label="NHC tropical weather outlook — formation chances" />
          <SourceLine ok={!!wind} label="Open-Meteo — 16-day UK wind and gust forecast" />
          <SourceLine ok={!!picture?.warnings} label="MeteoAlarm — official Met Office weather warnings" />
          <SourceLine ok={!!picture?.floods} label="Environment Agency — live flood warnings (England)" />
          <SourceLine ok={!!picture?.lows?.gridOk} label="Open-Meteo grid scan — deep Atlantic lows & ex-hurricanes" />
          {picture?.errors?.length ? (
            <Text style={styles.smallNote}>Last refresh issues: {picture.errors.slice(0, 3).join(' · ')}</Text>
          ) : null}
          <Text style={styles.smallNote}>
            Advisories are issued every 6 hours (03/09/15/21 UTC) with intermediate updates in between, so positions
            can be up to ~3 hours old.
          </Text>
          <Text style={[styles.smallNote, styles.emergency]}>
            Not an official warning service. For UK weather warnings use the Met Office; for tropical cyclone
            advisories use the National Hurricane Center. In an emergency call 999.
          </Text>
          <Pressable onPress={() => Linking.openURL('https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings')}>
            <Text style={styles.linkBtnText}>Met Office UK weather warnings ↗</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function confidenceSentence(risk) {
  if (risk.confidence === 'high') return 'This is inside the official NHC forecast.';
  if (risk.confidence === 'medium') return "That part of the track is the app's own extrapolation, so it could easily shift.";
  return 'Very low confidence at this range — worth watching, nothing more.';
}

function StormCard({ storm, risk, now, open, onToggle, muted }) {
  const cat = saffirSimpson(storm.windKt);
  const accent = stormColor(storm);
  const closestTime = risk.closest?.point?.time;
  return (
    <Pressable onPress={onToggle} style={[styles.stormCard, { borderColor: accent }]}>
      <View style={styles.stormTop}>
        <View style={styles.stormNameWrap}>
          <Text style={styles.stormName}>{storm.name}</Text>
          <Text style={styles.stormType}>
            {cat ? `Category ${cat} hurricane` : classificationLabel(storm.classification)}
            {muted ? ' · 🔕 muted' : ''}
          </Text>
        </View>
        <View style={[styles.riskPill, { backgroundColor: risk.color }]}>
          <Text style={styles.riskPillText}>UK {risk.band}</Text>
        </View>
      </View>

      <Text style={styles.stormMeta}>
        {Math.round(ktToMph(storm.windKt))} mph sustained
        {storm.pressureMb ? ` · ${storm.pressureMb} mb` : ''}
        {storm.movementDir != null && storm.movementSpeedKt
          ? ` · moving ${compassPoint(storm.movementDir)} at ${Math.round(ktToMph(storm.movementSpeedKt))} mph`
          : ''}
      </Text>
      <Text style={styles.stormMeta}>
        {fmtLatLon(storm.lat, storm.lon)} · {Math.round(risk.currentDistanceMiles).toLocaleString()} miles from the UK
        {storm.lastUpdate ? ` · ${timeAgoLabel(storm.lastUpdate, now)}` : ''}
      </Text>

      <View style={styles.scoreRow}>
        <View style={styles.scoreTrack}>
          <View style={[styles.scoreFill, { width: `${Math.max(3, risk.score)}%`, backgroundColor: risk.color }]} />
        </View>
        <Text style={styles.scoreText}>{risk.score}/100</Text>
      </View>
      <Text style={styles.stormBlurb}>
        {risk.blurb}
        {closestTime && risk.closest.miles <= 2000
          ? ` · closest approach ~${Math.round(risk.closest.miles).toLocaleString()} mi from ${risk.closest.place} ${leadTimeLabel(closestTime, now)}`
          : ''}
      </Text>

      {open ? (
        <View style={styles.stormDetail}>
          <Text style={styles.detailHeading}>Why this score</Text>
          {risk.reasons.map((r, i) => (
            <Text key={i} style={styles.detailLine}>
              • {r}
            </Text>
          ))}
          <Text style={styles.detailHeading}>
            Official NHC forecast track{risk.confidence === 'low' && !risk.official.length ? ' (unavailable)' : ''}
          </Text>
          {risk.official.map((p, i) => (
            <Text key={i} style={styles.detailLine}>
              {p.hour === 0 ? 'now' : `+${p.hour}h`} · {fmtLatLon(p.lat, p.lon)}
              {isFinite(p.windKt) ? ` · ${Math.round(ktToMph(p.windKt))} mph` : ''}
              {p.note ? ` · ${p.note.toLowerCase()}` : ''}
              {p.extrapolated ? ' · estimated' : ''}
            </Text>
          ))}
          {risk.projected.length ? (
            <Text style={styles.detailLine}>
              {'\n'}Then extrapolated by the app to {fmtLatLon(risk.projected[risk.projected.length - 1].lat, risk.projected[risk.projected.length - 1].lon)} by{' '}
              {fmtDayLabel(risk.projected[risk.projected.length - 1].time)}.
            </Text>
          ) : null}
          {storm.advisoryUrl ? (
            <Pressable onPress={() => Linking.openURL(storm.advisoryUrl)}>
              <Text style={styles.linkBtnText}>Read the full NHC advisory ↗</Text>
            </Pressable>
          ) : null}
          {storm.conePngUrl ? (
            <Pressable onPress={() => Linking.openURL(storm.conePngUrl)}>
              <Text style={styles.linkBtnText}>Official forecast cone graphic ↗</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.tapHint}>Tap for the forecast track and how this was worked out</Text>
      )}
    </Pressable>
  );
}

function OutlookCard({ area }) {
  const level = outlookWatchLevel(area);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>{area.title}</Text>
        <View style={[styles.ratingPill, { backgroundColor: level.color }]}>
          <Text style={styles.ratingText}>{Math.max(area.chance7 ?? 0, area.chance48 ?? 0)}%</Text>
        </View>
      </View>
      <ChanceBar label="Next 2 days" value={area.chance48} />
      <ChanceBar label="Next 7 days" value={area.chance7} />
      <Text style={styles.cardBody} numberOfLines={6}>
        {area.text}
      </Text>
      <Text style={styles.smallNote}>
        {area.ukRelevant
          ? `${area.region} — systems that develop here are the ones that can later recurve towards Europe, though most do not.`
          : `${area.region} — systems here almost always stay well to our west.`}
      </Text>
    </View>
  );
}

function ChanceBar({ label, value }) {
  if (value == null) return null;
  const color = value >= 70 ? '#dc2626' : value >= 40 ? '#ea580c' : value >= 20 ? '#d4a72c' : '#4b8f6f';
  return (
    <View style={styles.chanceRow}>
      <Text style={styles.chanceLabel}>{label}</Text>
      <View style={styles.chanceTrack}>
        <View style={[styles.chanceFill, { width: `${Math.max(2, value)}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.chanceValue}>{value}%</Text>
    </View>
  );
}

// The Windy-style wind radar. The page is self-contained (it fetches its own
// wind grid), so the app only hands it the storm/low positions to overlay.
function WindRadar({ assessed, lows }) {
  const html = useMemo(() => {
    const overlays = [
      ...(assessed || []).map(({ storm }) => ({
        lat: storm.lat,
        lon: storm.lon,
        label: storm.name,
        kind: 'storm',
      })),
      ...((lows || [])
        .filter((low) => !assessed?.some((a) => a.storm.name === low.exName))
        .map((low) => ({
          lat: low.current.lat,
          lon: low.current.lon,
          label: low.exName ? `Ex-${low.exName}` : `${low.minPressure} hPa`,
          kind: 'low',
        }))),
    ];
    return buildRadarHtml(overlays);
  }, [assessed, lows]);

  if (WebView) {
    return (
      <View style={styles.radarWrap}>
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.radar}
          scrollEnabled={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
        />
      </View>
    );
  }
  if (Platform.OS === 'web') {
    // Web preview: same page in an iframe.
    return (
      <View style={styles.radarWrap}>
        {React.createElement('iframe', {
          srcDoc: html,
          style: { border: 0, width: '100%', height: 460, borderRadius: 14, display: 'block' },
          title: 'Wind radar',
        })}
      </View>
    );
  }
  // Native build without the WebView module (an old binary running new JS).
  return (
    <View style={styles.card}>
      <Text style={styles.cardBody}>
        The wind radar needs a newer app build than this one. Everything else works — and the radar is available in
        Expo Go and the next installed build.
      </Text>
    </View>
  );
}

function SeasonStats({ assessed, seasonLog, now }) {
  const count = seasonStormNumber(assessed, seasonLog);
  const avg = climatologyToDate(now);
  const activity = seasonActivityLabel(count, avg);
  const toPeak = daysToPeak(now);
  return (
    <>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>
          {count} system{count === 1 ? '' : 's'} so far · normal for the date is ~{avg.toFixed(1)}
        </Text>
        <View style={[styles.ratingPill, { backgroundColor: activity.color }]}>
          <Text style={styles.ratingText}>{activity.label}</Text>
        </View>
      </View>
      <Text style={styles.cardBody}>
        {toPeak > 0
          ? `The climatological peak of the season is 10 September — ${toPeak} days away, so the busiest stretch is still to come.`
          : toPeak > -30
          ? 'We are right around the September peak of the season — the busiest few weeks of the year.'
          : 'Past the September peak — activity normally winds down from here.'}
      </Text>
      <Text style={styles.smallNote}>
        System count is inferred from NHC storm numbering (it includes depressions, so it can run slightly ahead of the
        named-storm count). Climatology is the 1991–2020 average.
      </Text>
    </>
  );
}

function Toggle({ label, value, onPress, hint }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onPress}>
      <View style={styles.toggleLabelWrap}>
        <Text style={styles.cardBody}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.toggleValue}>{value ? 'On 🔔' : 'Off 🔕'}</Text>
    </Pressable>
  );
}

function SourceLine({ ok, label }) {
  return (
    <Text style={styles.sourceLine}>
      {ok ? '🟢' : '🔴'} {label}
    </Text>
  );
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1420' },
  scroll: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 48 },
  header: { marginBottom: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#8b93a3', fontSize: 13, marginTop: 4 },

  banner: { flexDirection: 'row', borderRadius: 14, padding: 14, alignItems: 'center' },
  bannerIcon: { fontSize: 28, marginRight: 12 },
  bannerText: { flex: 1 },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bannerBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 3, lineHeight: 18 },

  linkBtnText: { color: '#7db4ff', fontSize: 13, textDecorationLine: 'underline', marginTop: 10 },

  mapWrap: { marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  radarWrap: { borderRadius: 14, overflow: 'hidden', height: 460, backgroundColor: '#0e1420' },
  radar: { flex: 1, backgroundColor: '#0e1420' },
  map: { width: '100%', height: 300 },
  legend: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(10,14,20,0.75)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  legendText: { color: '#dbe1ea', fontSize: 11 },

  statsRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  stat: { flex: 1, backgroundColor: '#18202f', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#8b93a3', fontSize: 10, marginTop: 3, textAlign: 'center' },

  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: '#18202f', borderRadius: 14, padding: 14, marginTop: 8 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  cardBody: { color: '#c6ccd8', fontSize: 14, lineHeight: 20 },
  smallNote: { color: '#77808f', fontSize: 12, lineHeight: 17, marginTop: 10 },
  emergency: { color: '#e0958a' },

  ratingPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  ratingText: { color: '#101418', fontSize: 12, fontWeight: '800' },

  stormCard: { backgroundColor: '#161d2b', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 4 },
  stormTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stormNameWrap: { flex: 1, marginRight: 8 },
  stormName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  stormType: { color: '#9fb0c9', fontSize: 13, marginTop: 2 },
  riskPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  riskPillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stormMeta: { color: '#aab3c2', fontSize: 13, marginTop: 6, lineHeight: 18 },

  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  scoreTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: '#232c3d', overflow: 'hidden' },
  scoreFill: { height: 8, borderRadius: 999 },
  scoreText: { color: '#c6ccd8', fontSize: 12, fontWeight: '700', marginLeft: 8, width: 56, textAlign: 'right' },
  stormBlurb: { color: '#c6ccd8', fontSize: 13, marginTop: 8, lineHeight: 19 },
  tapHint: { color: '#63708a', fontSize: 12, marginTop: 10 },

  stormDetail: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#242e42', paddingTop: 10 },
  detailHeading: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  detailLine: { color: '#aab3c2', fontSize: 12.5, lineHeight: 19 },

  chanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  chanceLabel: { color: '#9fb0c9', fontSize: 12, width: 84 },
  chanceTrack: { flex: 1, height: 7, borderRadius: 999, backgroundColor: '#232c3d', overflow: 'hidden' },
  chanceFill: { height: 7, borderRadius: 999 },
  chanceValue: { color: '#c6ccd8', fontSize: 12, fontWeight: '700', marginLeft: 8, width: 38, textAlign: 'right' },

  windRows: { marginTop: 12 },
  windRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  windDay: { color: '#9fb0c9', fontSize: 12, width: 86 },
  windBarTrack: { flex: 1, height: 9, borderRadius: 999, backgroundColor: '#232c3d', overflow: 'hidden' },
  windBarFill: { height: 9, borderRadius: 999 },
  windValue: { color: '#c6ccd8', fontSize: 12, fontWeight: '700', marginLeft: 8, width: 30, textAlign: 'right' },

  chipRow: { flexDirection: 'row', marginTop: 10, gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#232c3d' },
  chipActive: { backgroundColor: '#2f7fd4' },
  chipText: { color: '#c6ccd8', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  toggleLabelWrap: { flex: 1, marginRight: 12 },
  toggleHint: { color: '#77808f', fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  toggleValue: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bold: { fontWeight: '800', color: '#fff' },

  warnRow: { marginTop: 14, backgroundColor: '#3a2222', borderRadius: 10, padding: 10 },
  warnText: { color: '#f0b8ae', fontSize: 13, lineHeight: 18 },

  testBtn: { marginTop: 16, backgroundColor: '#232c3d', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  testBtnText: { color: '#cfe0f5', fontSize: 14, fontWeight: '700' },

  mutedWrap: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#242e42', paddingTop: 6 },
  mutedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },

  sourceLine: { color: '#c6ccd8', fontSize: 13, lineHeight: 22 },

  warningRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  warnPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 10, marginTop: 1 },
  warnPillText: { color: '#101418', fontSize: 10.5, fontWeight: '900' },
  warningTextWrap: { flex: 1 },
  warnMeta: { color: '#77808f', fontSize: 12, marginTop: 2 },
  namedStorm: { fontWeight: '700', color: '#8fc3ff', marginBottom: 4 },

  townInput: {
    marginTop: 12,
    backgroundColor: '#232c3d',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  townRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#242e42' },
  changeLink: { color: '#7db4ff', fontSize: 13, fontWeight: '600' },
});
