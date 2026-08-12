import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import { sunPosition, compassPoint, angleDelta } from './solar';
import { dateToT, diskGeometry } from './eclipse';
import EclipseDisk from './EclipseDisk';

// Rough camera field of view used to map angle offsets to screen positions.
const FOV_H = 60;
const FOV_V = 75;
const ALIGN_AZ = 24; // degrees within which the Sun is considered on screen
const ALIGN_ALT = 30;

function fmt(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function countdown(ms) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Live phase status for the timeline bar.
function phaseInfo(result, now) {
  if (!result || !result.visible) return null;
  const t = now.getTime();
  if (t < result.partialStart.getTime()) {
    return {
      label: 'Partial eclipse begins',
      at: result.partialStart,
      note: `starts in ${countdown(result.partialStart.getTime() - t)}`,
    };
  }
  if (result.isTotal && t < result.total.start.getTime()) {
    return {
      label: 'TOTALITY begins',
      at: result.total.start,
      note: `in ${countdown(result.total.start.getTime() - t)}`,
    };
  }
  if (result.isTotal && t < result.total.end.getTime()) {
    return {
      label: 'TOTALITY NOW',
      at: result.total.end,
      note: `ends in ${countdown(result.total.end.getTime() - t)}`,
    };
  }
  if (t < result.maximum.getTime()) {
    return {
      label: 'Maximum eclipse',
      at: result.maximum,
      note: `in ${countdown(result.maximum.getTime() - t)}`,
    };
  }
  if (t < result.partialEnd.getTime()) {
    return {
      label: 'Partial eclipse ends',
      at: result.partialEnd,
      note: `in ${countdown(result.partialEnd.getTime() - t)}`,
    };
  }
  return { label: 'Eclipse is over here', at: result.partialEnd, note: 'see you in 2027' };
}

export default function SkyFinder({ place, result, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [heading, setHeading] = useState(null); // degrees from true north
  const [camAlt, setCamAlt] = useState(0); // camera elevation, degrees
  const [now, setNow] = useState(new Date());

  // Clock tick.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Compass heading.
  useEffect(() => {
    let sub;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        sub = await Location.watchHeadingAsync((h) => {
          const value =
            h.trueHeading != null && h.trueHeading >= 0
              ? h.trueHeading
              : h.magHeading;
          setHeading(value);
        });
      } catch (e) {
        // Heading unavailable (web, simulator) — numeric guidance still shown.
      }
    })();
    return () => sub && sub.remove();
  }, []);

  // Device tilt -> camera elevation. With the phone upright in portrait the
  // back camera points at the horizon (beta ~ 90deg), flat on a table it
  // points at the ground (beta ~ 0).
  useEffect(() => {
    let sub;
    if (Platform.OS !== 'web') {
      DeviceMotion.setUpdateInterval(120);
      sub = DeviceMotion.addListener((m) => {
        if (m.rotation) {
          setCamAlt((m.rotation.beta * 180) / Math.PI - 90);
        }
      });
    }
    return () => sub && sub.remove();
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const sun = useMemo(
    () => sunPosition(now, place.lat, place.lon),
    [now, place]
  );
  const geometry = useMemo(
    () => diskGeometry(dateToT(now), place.lat, place.lon),
    [now, place]
  );
  const phase = phaseInfo(result, now);

  const dAz = heading != null ? angleDelta(heading, sun.azimuth) : null;
  const dAlt = sun.altitude - camAlt;
  const aligned =
    dAz != null && Math.abs(dAz) < ALIGN_AZ && Math.abs(dAlt) < ALIGN_ALT;

  // Map angular offset to screen position when roughly aligned.
  const diskSize = 240;
  const offsetX = dAz != null ? (dAz / FOV_H) * 100 : 0; // percent of width
  const offsetY = (-dAlt / FOV_V) * 100; // percent of height

  let guidance = null;
  if (sun.altitude < -0.8) {
    guidance = '🌅 The Sun is below the horizon right now.';
  } else if (heading == null) {
    guidance = `Point ${compassPoint(sun.azimuth)} (${Math.round(
      sun.azimuth
    )}°), then tilt to ${Math.round(sun.altitude)}° up.`;
  } else if (!aligned) {
    const parts = [];
    if (Math.abs(dAz) >= ALIGN_AZ) {
      parts.push(
        dAz > 0
          ? `Turn right ${Math.round(Math.abs(dAz))}° ▶`
          : `◀ Turn left ${Math.round(Math.abs(dAz))}°`
      );
    }
    if (Math.abs(dAlt) >= ALIGN_ALT) {
      parts.push(
        dAlt > 0
          ? `▲ Tilt up ${Math.round(Math.abs(dAlt))}°`
          : `▼ Tilt down ${Math.round(Math.abs(dAlt))}°`
      );
    }
    guidance = parts.join('   ');
  }

  const camContent = (
    <>
      {/* Guidance / target overlay */}
      <View style={styles.overlay} pointerEvents="box-none">
        {aligned && sun.altitude >= -0.8 ? (
          <View
            style={{
              position: 'absolute',
              left: `${50 + offsetX}%`,
              top: `${50 + offsetY}%`,
              marginLeft: -diskSize / 2,
              marginTop: -diskSize / 2,
            }}
          >
            <EclipseDisk
              geometry={geometry}
              size={diskSize}
              transparent
              showLabel={false}
            />
            <Text style={styles.hereLabel}>
              ☀️ The eclipse happens right here ·{' '}
              {(geometry.obscuration * 100).toFixed(0)}% covered now
            </Text>
          </View>
        ) : (
          guidance && (
            <View style={styles.guideBox}>
              <Text style={styles.guideText}>{guidance}</Text>
            </View>
          )
        )}
      </View>

      {/* Top bar: place + sun position */}
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Find the eclipse</Text>
        <Text style={styles.topSub}>
          {place.name} · Sun at {compassPoint(sun.azimuth)}{' '}
          {Math.round(sun.azimuth)}° / {Math.round(sun.altitude)}° up
        </Text>
        {heading != null && (
          <Text style={styles.topSub}>
            You're facing {compassPoint(heading)} {Math.round(heading)}° /{' '}
            {Math.round(camAlt)}° tilt
          </Text>
        )}
      </View>

      {/* Bottom bar: live phase + times */}
      <View style={styles.bottomBar}>
        {phase && (
          <Text style={styles.phaseText}>
            {phase.label} · {fmt(phase.at)} ({phase.note})
          </Text>
        )}
        {result && result.visible && (
          <Text style={styles.timesText}>
            {fmt(result.partialStart)} start
            {result.isTotal
              ? ` · ${fmt(result.total.start)} totality`
              : ''}{' '}
            · {fmt(result.maximum)} max · {fmt(result.partialEnd)} end
          </Text>
        )}
        <Text style={styles.safetyText}>
          👓 Only look at the Sun through certified eclipse glasses.
        </Text>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      {permission?.granted && Platform.OS !== 'web' ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamBg]} />
      )}
      {camContent}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070f' },
  noCamBg: { backgroundColor: '#0b1023' },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
  guideBox: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    backgroundColor: 'rgba(5,8,20,0.75)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    maxWidth: '90%',
  },
  guideText: {
    color: '#ffb347',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  hereLabel: {
    color: '#eef1ff',
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(5,8,20,0.65)',
    zIndex: 3,
  },
  topTitle: { color: '#eef1ff', fontSize: 19, fontWeight: '800' },
  topSub: { color: '#c6cdea', fontSize: 13, marginTop: 3 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingBottom: 34,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(5,8,20,0.65)',
    zIndex: 3,
  },
  phaseText: { color: '#ffb347', fontSize: 16, fontWeight: '800' },
  timesText: { color: '#eef1ff', fontSize: 13, marginTop: 5 },
  safetyText: { color: '#c6cdea', fontSize: 12, marginTop: 6 },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  closeText: { color: '#eef1ff', fontWeight: '700', fontSize: 15 },
});
