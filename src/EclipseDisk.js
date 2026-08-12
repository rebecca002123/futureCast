import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Sun + Moon disk rendering for a given eclipse geometry
// (from diskGeometry in eclipse.js). Used by the simulation card
// and the AR sky finder.
export default function EclipseDisk({
  geometry,
  size,
  transparent = false,
  showLabel = true,
}) {
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
      {!transparent && (
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
      )}
      <View
        style={{
          position: 'absolute',
          left: cx - sunR * 1.5,
          top: cy - sunR * 1.5,
          width: sunR * 3,
          height: sunR * 3,
          borderRadius: sunR * 1.5,
          backgroundColor:
            covered > 0.995 ? 'rgba(220,230,255,0.25)' : 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: cx - sunR,
          top: cy - sunR,
          width: sunR * 2,
          height: sunR * 2,
          borderRadius: sunR,
          backgroundColor: covered > 0.995 ? '#f3f5ff' : '#ffb347',
          shadowColor: '#ffb347',
          shadowOpacity: glow,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: mx - moonR,
          top: my - moonR,
          width: moonR * 2,
          height: moonR * 2,
          borderRadius: moonR,
          backgroundColor: transparent ? 'rgba(14,18,32,0.92)' : '#0e1220',
        }}
      />
      {showLabel && (
        <View style={styles.diskLabelBox}>
          <Text style={styles.diskLabel}>
            {(covered * 100).toFixed(covered > 0.99 && covered < 1 ? 1 : 0)}%
            covered
          </Text>
          {geometry.sunAltitude < 0 && (
            <Text style={styles.diskWarn}>Sun below the horizon</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skyBox: { borderRadius: 18, overflow: 'hidden' },
  diskLabelBox: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  diskLabel: { color: '#eef1ff', fontWeight: '700', fontSize: 15 },
  diskWarn: { color: '#ff9e9e', fontSize: 12, marginTop: 2 },
});
