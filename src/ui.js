// Small shared building blocks so the screens read as layout rather than
// as a wall of StyleSheet.

import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { fmtTime, MIN_PER_DAY, parseTimeInput } from './time';

export const C = {
  bg: '#0e1116',
  card: '#171c24',
  cardAlt: '#1f2531',
  line: '#272f3b',
  text: '#eef2f7',
  dim: '#98a2b3',
  faint: '#6b7686',
  accent: '#3ddc97',
  accentInk: '#06231a',
  accentSoft: '#163a2c',
  night: '#8bb4ff',
  weekend: '#c9a0ff',
  warn: '#f4a259',
  danger: '#ff6b6b',
};

export function Card({ children, style, tone }) {
  return <View style={[styles.card, tone === 'alt' && { backgroundColor: C.cardAlt }, style]}>{children}</View>;
}

export function SectionLabel({ children, style }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Button({ label, onPress, kind = 'primary', style, disabled }) {
  const kindStyle = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    ghost: styles.btnGhost,
    danger: styles.btnDanger,
  }[kind];
  const textStyle = {
    primary: { color: C.accentInk },
    secondary: { color: C.text },
    ghost: { color: C.dim },
    danger: { color: C.danger },
  }[kind];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.btn, kindStyle, pressed && !disabled && styles.pressed, disabled && { opacity: 0.4 }, style]}
    >
      <Text style={[styles.btnText, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, tone, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: tone || C.accent, borderColor: tone || C.accent },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.chipText, selected && { color: C.accentInk, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children, style }) {
  return <View style={[styles.chipRow, style]}>{children}</View>;
}

export function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.pressed]}
          >
            <Text style={[styles.segmentText, active && { color: C.accentInk, fontWeight: '700' }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwitchRow({ label, hint, value, onChange }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onChange}
        trackColor={{ false: '#333c49', true: C.accentSoft }}
        thumbColor={value ? C.accent : '#8a94a3'}
        ios_backgroundColor="#333c49"
      />
    </View>
  );
}

export function StatRow({ label, value, hint, tone, bold }) {
  return (
    <View style={styles.statRow}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={[styles.rowLabel, bold && { fontWeight: '700' }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.statValue, bold && { fontWeight: '800' }, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

// A text box that only ever holds a number, with optional +/- steppers.
export function NumberField({ value, onChange, step = 1, min = 0, max = 9999, prefix, suffix, decimals = 2, width = 96 }) {
  const [text, setText] = useState(formatNumber(value, decimals));
  useEffect(() => {
    setText((current) => (parseNumber(current) === value ? current : formatNumber(value, decimals)));
  }, [value, decimals]);

  const commit = (raw) => {
    const parsed = parseNumber(raw);
    if (parsed == null) {
      setText(formatNumber(value, decimals));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    setText(formatNumber(clamped, decimals));
  };

  const bump = (delta) => {
    const current = parseNumber(text) ?? value ?? 0;
    const next = Math.min(max, Math.max(min, Math.round((current + delta) * 1000) / 1000));
    onChange(next);
    setText(formatNumber(next, decimals));
  };

  return (
    <View style={styles.stepper}>
      {step ? <StepButton label="−" onPress={() => bump(-step)} /> : null}
      <View style={[styles.fieldBox, { width }]}>
        {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={() => commit(text)}
          onSubmitEditing={() => commit(text)}
          keyboardType={Platform.OS === 'web' ? 'default' : 'decimal-pad'}
          returnKeyType="done"
          selectTextOnFocus
          style={styles.fieldInput}
          placeholderTextColor={C.faint}
        />
        {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
      </View>
      {step ? <StepButton label="+" onPress={() => bump(step)} /> : null}
    </View>
  );
}

// Times are typed the way people say them ('7', '19:30', '7.30pm') and
// normalised on blur; the arrows nudge by a quarter of an hour.
export function TimeField({ value, onChange, clock24 = true, step = 15 }) {
  const minutes = parseTimeInput(value) ?? 0;
  const [text, setText] = useState(fmtTime(minutes, clock24));
  useEffect(() => {
    setText(fmtTime(parseTimeInput(value) ?? 0, clock24));
  }, [value, clock24]);

  const commit = (raw) => {
    const parsed = parseTimeInput(raw);
    if (parsed == null) {
      setText(fmtTime(minutes, clock24));
      return;
    }
    onChange(fmtTime(parsed, true));
    setText(fmtTime(parsed, clock24));
  };

  const bump = (delta) => {
    const next = (((minutes + delta) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    onChange(fmtTime(next, true));
  };

  return (
    <View style={styles.stepper}>
      <StepButton label="−" onPress={() => bump(-step)} />
      <View style={[styles.fieldBox, { width: 104 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={() => commit(text)}
          onSubmitEditing={() => commit(text)}
          keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
          returnKeyType="done"
          selectTextOnFocus
          style={[styles.fieldInput, { textAlign: 'center', fontVariant: ['tabular-nums'] }]}
        />
      </View>
      <StepButton label="+" onPress={() => bump(step)} />
    </View>
  );
}

export function TextField({ value, onChange, placeholder, multiline, style }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.faint}
      multiline={multiline}
      style={[styles.textField, multiline && { height: 72, textAlignVertical: 'top' }, style]}
    />
  );
}

function StepButton({ label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}>
      <Text style={styles.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(decimals);
}

function parseNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  sectionLabel: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: 12 },
  pressed: { opacity: 0.65 },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: C.accent },
  btnSecondary: { backgroundColor: C.cardAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: C.danger },
  btnText: { fontSize: 15, fontWeight: '600' },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.cardAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  chipText: { color: C.text, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: C.cardAlt,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.dim, fontSize: 14, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  rowLabel: { color: C.text, fontSize: 15, flexShrink: 1 },
  rowHint: { color: C.faint, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  statValue: { color: C.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // Never let a long label squeeze the field: the row wraps its text instead.
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  stepBtnText: { color: C.text, fontSize: 20, fontWeight: '600', lineHeight: 23 },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.cardAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  fieldInput: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    // An <input> on the web has an intrinsic width of about 20 characters,
    // and `min-width: auto` would let it overflow its box on the web build.
    minWidth: 0,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  affix: { color: C.dim, fontSize: 15, fontWeight: '600' },
  textField: {
    minWidth: 0,
    backgroundColor: C.cardAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
});

export { styles as uiStyles };
