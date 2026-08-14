import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// A light, dependency-free snowfall: a handful of animated flakes drifting
// down the screen on a loop. Purely decorative, pointerEvents: none.
function Flake({ delay, duration, startX, drift, size, height }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration]);

  const translateY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, height + 40],
  });
  const translateX = t.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [startX, startX + drift, startX],
  });
  const opacity = t.interpolate({
    inputRange: [0, 0.1, 0.9, 1],
    outputRange: [0, 0.8, 0.8, 0],
  });

  return (
    <Animated.Text
      style={[
        styles.flake,
        { fontSize: size, opacity, transform: [{ translateX }, { translateY }] },
      ]}
    >
      ❄
    </Animated.Text>
  );
}

export default function Snow({ width, height, count = 14 }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        delay: (i * 1337) % 8000,
        duration: 9000 + ((i * 2711) % 7000),
        startX: ((i * 761) % Math.max(1, width - 20)),
        drift: ((i % 2 ? 1 : -1) * (20 + ((i * 53) % 40))),
        size: 8 + ((i * 7) % 10),
      })),
    [count, width]
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flakes.map((f) => (
        <Flake key={f.key} {...f} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flake: {
    position: 'absolute',
    color: '#dfe9ff',
  },
});
