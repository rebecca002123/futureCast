import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { computeLocalCircumstances, diskGeometry } from './src/eclipse';
import { CITIES } from './src/cities';

const COLORS = {
  bg: '#0b1023',
  card: '#151b36',
  cardAlt: '#1b2244',
  accent: '#ffb347',
  accentDim: '#c98a2e',
  text: '#eef1ff',
  textDim: '#9aa3c7',
  good: '#7ee787',
  warn: '#ff9e9e',
  line: '#2a3158',
};

function formatTime(date) {
  if (!date) return '—';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatUTC(date) {
  if (!date) return '—';
  return date.toISOString().slice(11, 16) + ' UTC';
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Eclipse disk simulation: the Sun with the Moon's disk drawn over it at the
// geometry for time t, as seen from the chosen location.
// ---------------------------------------------------------------------------
function EclipseDisk({ geometry, size }) {
  const sunR = size * 0.28;
  const moonR = sunR * geometry.moonSize;
  const cx = size / 2;
  const cy = size / 2;
  const mx = cx + geometry.dirX * geometry.sep * sunR;
  const my = cy + geometry.dirY * geometry.sep * sunR;
  const covered = geometry.obscuration;
  const glow = 1 - covered * 0.85;

  return (
    <View style={[styles.skyBox, { width: size, height: size }]}>
      {/* Sky darkens as the eclipse deepens */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: `rgb(${Math.round(18 + 60 * glow)}, ${Math.round(
              22 + 90 * glow
            )}, ${Math.round(48 + 140 * glow)})`,
            borderRadius: 18,
          },
        ]}
      />
      {/* Corona glow, visible near totality */}
      <View
        style={{
          position: 'absolute',
          left: cx - sunR * 1.5,
          top: cy - sunR * 1.5,
          width: sunR * 3,
          height: sunR * 3,
          borderRadius: sunR * 1.5,
          backgroundColor: covered > 0.995 ? 'rgba(220,230,255,0.25)' : 'transparent',
        }}
      />
      {/* Sun */}
      <View
        style={{
          position: 'absolute',
          left: cx - sunR,
          top: cy - sunR,
          width: sunR * 2,
          height: sunR * 2,
          borderRadius: sunR,
          backgroundColor: covered > 0.995 ? '#f3f5ff' : COLORS.accent,
          shadowColor: COLORS.accent,
          shadowOpacity: glow,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      {/* Moon */}
      <View
        style={{
          position: 'absolute',
          left: mx - moonR,
          top: my - moonR,
          width: moonR * 2,
          height: moonR * 2,
          borderRadius: moonR,
          backgroundColor: '#0e1220',
        }}
      />
      <View style={styles.diskLabelBox}>
        <Text style={styles.diskLabel}>
          {(covered * 100).toFixed(covered > 0.99 && covered < 1 ? 1 : 0)}% covered
        </Text>
        {geometry.sunAltitude < 0 && (
          <Text style={styles.diskWarn}>Sun below the horizon</Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Minimal dependency-free slider.
// ---------------------------------------------------------------------------
function TimeSlider({ value, onChange, width }) {
  const trackW = width - 28;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        onChange(Math.max(0, Math.min(1, (e.nativeEvent.locationX - 14) / trackW)));
      },
      onPanResponderMove: (e) => {
        onChange(Math.max(0, Math.min(1, (e.nativeEvent.locationX - 14) / trackW)));
      },
    })
  ).current;

  return (
    <View style={[styles.sliderTouch, { width }]} {...responder.panHandlers}>
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${value * 100}%` }]} />
      </View>
      <View style={[styles.sliderThumb, { left: 14 + value * trackW - 11 }]} />
    </View>
  );
}

function Row({ label, date, sub }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowTime}>{formatTime(date)}</Text>
        <Text style={styles.rowSub}>{sub ?? formatUTC(date)}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const [place, setPlace] = useState(null); // { name, lat, lon }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState(null);
  const [scrub, setScrub] = useState(0.5); // 0..1 across the partial phase

  const result = useMemo(
    () => (place ? computeLocalCircumstances(place.lat, place.lon) : null),
    [place]
  );

  const scrubT = useMemo(() => {
    if (!result || !result.visible) return 0;
    return result.tStart + scrub * (result.tEnd - result.tStart);
  }, [result, scrub]);

  const geometry = useMemo(() => {
    if (!result || !result.visible || !place) return null;
    return diskGeometry(scrubT, place.lat, place.lon);
  }, [result, scrubT, place]);

  const scrubDate = useMemo(() => {
    if (!result || !result.visible) return null;
    const span = result.partialEnd - result.partialStart;
    return new Date(result.partialStart.getTime() + scrub * span);
  }, [result, scrub]);

  async function useMyLocation() {
    setLocBusy(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission was denied. Pick a city instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPlace({
        name: 'My location',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      });
      setScrub(0.5);
    } catch (e) {
      setLocError('Could not get your location. Pick a city instead.');
    } finally {
      setLocBusy(false);
    }
  }

  const filteredCities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CITIES;
    return CITIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [query]);

  const badge =
    result && result.visible
      ? result.isTotal
        ? { text: 'TOTAL ECLIPSE', color: COLORS.accent }
        : { text: 'PARTIAL ECLIPSE', color: '#8fb6ff' }
      : { text: 'NOT VISIBLE', color: COLORS.textDim };

  const obscurationPct =
    result && result.visible
      ? result.isTotal
        ? 100
        : Math.min(result.obscuration * 100, 99.9)
      : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>TOTAL SOLAR ECLIPSE · AUGUST 12, 2026</Text>
        <Text style={styles.title}>Eclipse Lookout</Text>
        <Text style={styles.subtitle}>
          See how the eclipse will look from your home on August 12, 2026.
        </Text>

        {/* Location controls */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Where will you be watching from?</Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={useMyLocation}
              disabled={locBusy}
            >
              <Text style={styles.btnText}>
                {locBusy ? 'Locating…' : '📍 Use my location'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.btnPressed,
              ]}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={styles.btnText}>🏙 Pick a city</Text>
            </Pressable>
          </View>
          {locError && <Text style={styles.errorText}>{locError}</Text>}
          {place && (
            <Text style={styles.placeText}>
              {place.name} · {place.lat.toFixed(3)}°, {place.lon.toFixed(3)}°
            </Text>
          )}
        </View>

        {!place && (
          <View style={styles.card}>
            <Text style={styles.introText}>
              On August 12, 2026 the Moon's shadow will race across the Arctic,
              Greenland, Iceland and Spain — the first total solar eclipse
              visible from mainland Europe since 1999. Choose a location to see
              exactly what the sky will do where you are: how much of the Sun
              will be covered, and at what times.
            </Text>
          </View>
        )}

        {result && !result.visible && (
          <View style={styles.card}>
            <Text style={styles.notVisibleTitle}>
              The eclipse won't be visible from this location. 😔
            </Text>
            <Text style={styles.introText}>
              The Moon's penumbra never touches this part of the world on
              August 12, 2026. Try somewhere in Europe, western Africa, Iceland,
              Greenland or northeastern North America.
            </Text>
          </View>
        )}

        {result && result.visible && geometry && (
          <>
            {/* Result summary */}
            <View style={styles.card}>
              <View style={[styles.badge, { borderColor: badge.color }]}>
                <Text style={[styles.badgeText, { color: badge.color }]}>
                  {badge.text}
                </Text>
              </View>

              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {obscurationPct.toFixed(obscurationPct >= 99 ? 1 : 0)}%
                  </Text>
                  <Text style={styles.statLabel}>of the Sun covered</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {result.magnitude.toFixed(3)}
                  </Text>
                  <Text style={styles.statLabel}>magnitude</Text>
                </View>
                {result.isTotal && (
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {formatDuration(result.total.durationSeconds)}
                    </Text>
                    <Text style={styles.statLabel}>of totality</Text>
                  </View>
                )}
              </View>

              {result.isTotal && (
                <Text style={styles.totalNote}>
                  🌑 You're inside the path of totality — day will briefly turn
                  to night.
                </Text>
              )}
              {!result.isTotal && result.magnitude > 0.98 && (
                <Text style={styles.almostNote}>
                  You're just outside the path of totality. A short trip into
                  the path would give you the full show.
                </Text>
              )}
              {result.sunAltitudeAtMax < 0 ? (
                <Text style={styles.warnNote}>
                  ⚠️ The Sun will be below the horizon at maximum eclipse here —
                  you may only catch the early partial phases before sunset.
                </Text>
              ) : (
                result.sunAltitudeAtMax < 10 && (
                  <Text style={styles.warnNote}>
                    ☀️ The Sun will be very low ({result.sunAltitudeAtMax.toFixed(0)}°
                    above the horizon) at maximum — find a spot with a clear
                    western horizon.
                  </Text>
                )
              )}
            </View>

            {/* Simulation */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sky simulation</Text>
              <View style={styles.diskWrap}>
                <EclipseDisk geometry={geometry} size={280} />
              </View>
              <Text style={styles.scrubTime}>
                {formatTime(scrubDate)} · {formatUTC(scrubDate)}
              </Text>
              <TimeSlider value={scrub} onChange={setScrub} width={300} />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderLabel}>Start</Text>
                <Text style={styles.sliderLabel}>Maximum</Text>
                <Text style={styles.sliderLabel}>End</Text>
              </View>
              <Text style={styles.hint}>Drag the slider to travel through the eclipse.</Text>
            </View>

            {/* Timeline */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Timeline (your device's time zone)</Text>
              <Row label="Partial eclipse begins" date={result.partialStart} />
              {result.isTotal && (
                <Row label="Totality begins" date={result.total.start} />
              )}
              <Row label="Maximum eclipse" date={result.maximum} />
              {result.isTotal && (
                <Row label="Totality ends" date={result.total.end} />
              )}
              <Row label="Partial eclipse ends" date={result.partialEnd} />
              <View style={styles.divider} />
              <Row
                label="Sun's height at maximum"
                date={null}
                sub={`${result.sunAltitudeAtMax.toFixed(1)}° above horizon`}
              />
            </View>

            {/* Safety */}
            <View style={[styles.card, styles.safetyCard]}>
              <Text style={styles.safetyTitle}>👓 Watch safely</Text>
              <Text style={styles.safetyText}>
                Never look at the Sun without certified eclipse glasses
                (ISO 12312-2). Ordinary sunglasses are not safe. Only during the
                brief moments of totality — if you are inside the path — is it
                safe to look with the naked eye.
              </Text>
            </View>
          </>
        )}

        <Text style={styles.footer}>
          Times are computed on your device from the NASA/Espenak Besselian
          elements for this eclipse. No data leaves your phone.
        </Text>
      </ScrollView>

      {/* City picker */}
      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.cardTitle}>Pick a city</Text>
            <TextInput
              style={styles.input}
              placeholder="Search…"
              placeholderTextColor={COLORS.textDim}
              value={query}
              onChangeText={setQuery}
            />
            <ScrollView style={styles.cityList}>
              {filteredCities.map((c) => (
                <Pressable
                  key={c.name}
                  style={({ pressed }) => [
                    styles.cityRow,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => {
                    setPlace(c);
                    setScrub(0.5);
                    setPickerOpen(false);
                    setQuery('');
                  }}
                >
                  <Text style={styles.cityName}>{c.name}</Text>
                </Pressable>
              ))}
              {filteredCities.length === 0 && (
                <Text style={styles.introText}>No matches.</Text>
              )}
            </ScrollView>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.btnPressed,
              ]}
              onPress={() => setPickerOpen(false)}
            >
              <Text style={styles.btnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 20, paddingBottom: 48, alignItems: 'stretch' },
  kicker: {
    color: COLORS.accent,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
    marginTop: 8,
  },
  title: { color: COLORS.text, fontSize: 34, fontWeight: '800', marginTop: 4 },
  subtitle: { color: COLORS.textDim, fontSize: 16, marginTop: 6, marginBottom: 18 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  cardTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  buttonRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  btnGhost: { backgroundColor: 'transparent' },
  btnPressed: { opacity: 0.6 },
  btnText: { color: COLORS.text, fontWeight: '600', fontSize: 15 },
  errorText: { color: COLORS.warn, marginTop: 10, fontSize: 14 },
  placeText: { color: COLORS.accent, marginTop: 12, fontSize: 15, fontWeight: '600' },
  introText: { color: COLORS.textDim, fontSize: 15, lineHeight: 22 },
  notVisibleTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 14,
  },
  badgeText: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  statRow: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  stat: { minWidth: 90 },
  statValue: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  statLabel: { color: COLORS.textDim, fontSize: 13, marginTop: 2 },
  totalNote: { color: COLORS.good, marginTop: 14, fontSize: 15, lineHeight: 21 },
  almostNote: { color: COLORS.accent, marginTop: 14, fontSize: 15, lineHeight: 21 },
  warnNote: { color: COLORS.warn, marginTop: 12, fontSize: 14, lineHeight: 20 },
  diskWrap: { alignItems: 'center' },
  skyBox: { borderRadius: 18, overflow: 'hidden' },
  diskLabelBox: { position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center' },
  diskLabel: { color: COLORS.text, fontWeight: '700', fontSize: 15 },
  diskWarn: { color: COLORS.warn, fontSize: 12, marginTop: 2 },
  scrubTime: {
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  sliderTouch: { height: 40, justifyContent: 'center', alignSelf: 'center', marginTop: 4 },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cardAlt,
    marginHorizontal: 14,
    overflow: 'hidden',
  },
  sliderFill: { height: 6, backgroundColor: COLORS.accentDim },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.accent,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 300,
    alignSelf: 'center',
  },
  sliderLabel: { color: COLORS.textDim, fontSize: 12 },
  hint: { color: COLORS.textDim, fontSize: 12, textAlign: 'center', marginTop: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowLabel: { color: COLORS.text, fontSize: 15, flexShrink: 1, paddingRight: 10 },
  rowRight: { alignItems: 'flex-end' },
  rowTime: { color: COLORS.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowSub: { color: COLORS.textDim, fontSize: 12, marginTop: 1 },
  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: 8 },
  safetyCard: { borderColor: COLORS.accentDim },
  safetyTitle: { color: COLORS.accent, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  safetyText: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  footer: {
    color: COLORS.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5,8,20,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: '80%',
  },
  input: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginBottom: 10,
  },
  cityList: { marginBottom: 12 },
  cityRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  cityName: { color: COLORS.text, fontSize: 15 },
});
