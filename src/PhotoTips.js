import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Eclipse photography guidance, organised as tappable accordion sections.
const SECTIONS = [
  {
    key: 'phone-partial',
    title: '📱 Phone — partial phases',
    tips: [
      'Cover the lens with a spare pair of eclipse glasses or a piece of certified solar film — without it the Sun is just a white blob (and long exposures can harm the sensor).',
      'Turn the flash off and use the telephoto lens (2x–5x) if your phone has one; avoid digital zoom past that, it only adds blur.',
      'Tap the Sun on screen, then drag the exposure slider down until the disk shows a crisp bite taken out of it.',
      'On iPhone, long-press to lock AE/AF once it looks right. On Android, use Pro mode if you have it: ISO 100, 1/500s or faster.',
      'Brace the phone on something solid or use a small tripod, and fire with the volume button or a 3-second timer to avoid shake.',
    ],
  },
  {
    key: 'phone-total',
    title: '📱 Phone — totality only',
    tips: [
      'The moment totality begins, take the filter OFF — the corona is about as bright as a full moon and needs no protection.',
      'Turn night mode OFF: its long exposure smears the corona. Normal photo mode with exposure slightly lowered works best.',
      'Shoot a short burst, then STOP and look up — totality lasts a couple of minutes at most and your eyes will remember it better than your phone.',
      'A wide-angle video with you and the horizon in frame captures the eerie darkness, the 360° sunset colours and everyone’s reactions — often the best keepsake.',
      'If your phone shoots RAW/ProRAW, turn it on beforehand; it rescues highlights in editing.',
    ],
  },
  {
    key: 'camera',
    title: '📷 Dedicated camera',
    tips: [
      'Partial phases: certified solar filter over the lens at all times. ISO 100, f/8, around 1/500s–1/2000s; adjust until the disk is well exposed.',
      'Manual focus: set to infinity on the Sun’s edge with the filter on, then tape the focus ring so it can’t drift.',
      'Diamond ring (seconds before/after totality): filter off, ~1/2000s — be quick.',
      'Totality: filter off, bracket wildly — 1/1000s for the inner corona out to 1/2s for the long streamers, ISO 100–400, f/8.',
      'NEVER look through an optical viewfinder without the filter on — it concentrates sunlight straight into your eye. Use live view.',
      'A second body on a tripod shooting a wide timelapse of the landscape darkening costs no attention and always pays off.',
    ],
  },
  {
    key: 'rules',
    title: '⭐ Golden rules',
    tips: [
      'Set everything up and rehearse at least 30 minutes before totality — during the event there is no time to fiddle.',
      'Charge the phone, clear storage space, clean the lens, enable airplane mode so nothing interrupts.',
      'Filters ON for every partial phase, OFF only during totality, back ON the instant the Sun reappears.',
      'If this is your first total eclipse: seriously consider not photographing totality at all. Watch it. The photos online will be better than yours; the memory won’t be.',
    ],
  },
];

export default function PhotoTips() {
  const [open, setOpen] = useState(null);
  return (
    <View>
      {SECTIONS.map((s) => (
        <View key={s.key} style={styles.section}>
          <Pressable
            style={({ pressed }) => [styles.header, pressed && { opacity: 0.6 }]}
            onPress={() => setOpen(open === s.key ? null : s.key)}
          >
            <Text style={styles.headerText}>{s.title}</Text>
            <Text style={styles.chev}>{open === s.key ? '▾' : '▸'}</Text>
          </Pressable>
          {open === s.key && (
            <View style={styles.body}>
              {s.tips.map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderBottomWidth: 1,
    borderBottomColor: '#2a3158',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
  },
  headerText: { color: '#eef1ff', fontSize: 15.5, fontWeight: '700' },
  chev: { color: '#ffb347', fontSize: 16, fontWeight: '800' },
  body: { paddingBottom: 12 },
  tipRow: { flexDirection: 'row', marginBottom: 8, paddingRight: 4 },
  bullet: { color: '#ffb347', marginRight: 8, fontSize: 14, lineHeight: 20 },
  tipText: { color: '#c6cdea', fontSize: 14, lineHeight: 20, flex: 1 },
});
