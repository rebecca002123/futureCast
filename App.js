import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  accrue,
  addExtra,
  balanceMinor,
  daysUntil,
  emergencyState,
  fmtDate,
  fmtMoney,
  isUnlocked,
  newVault,
  nextDepositDate,
  ordinal,
  parseMoney,
  projectedAtUnlockMinor,
  spend,
  windowState,
} from './src/vault';
import { loadVault, saveVault, clearVault } from './src/storage';
import { planReminders } from './src/notify';
import { pushWidgetData } from './src/widget';
import Snow from './src/Snow';

const C = {
  bg: '#0a1712',
  card: '#12241c',
  cardAlt: '#183024',
  line: '#24402f',
  gold: '#f5c451',
  goldDim: '#b8933d',
  red: '#e05252',
  text: '#eef7f0',
  dim: '#93aa9c',
  good: '#7ee787',
};

// Cross-platform confirm: Alert on native, window.confirm on web.
function confirm(title, message, onYes, destructive = false) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes', style: destructive ? 'destructive' : 'default', onPress: onYes },
  ]);
}

function Stepper({ label, value, onChange, min, max, format }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(Math.max(min, value - 1))}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{format ? format(value) : value}</Text>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(Math.min(max, value + 1))}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MoneyInput({ label, symbol, value, onChange, placeholder }) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.moneyRow}>
        <Text style={styles.moneySymbol}>{symbol}</Text>
        <TextInput
          style={styles.moneyInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.dim}
          keyboardType="decimal-pad"
          inputMode="decimal"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------
function Setup({ onDone }) {
  const [amount, setAmount] = useState('50');
  const [goal, setGoal] = useState('');
  const [depositDay, setDepositDay] = useState(1);
  const [unlockDay, setUnlockDay] = useState(1);
  const [symbol, setSymbol] = useState('£');

  const amountMinor = parseMoney(amount);
  const goalMinor = goal.trim() ? parseMoney(goal) : null;

  return (
    <ScrollView contentContainerStyle={styles.setupScroll}>
      <Text style={styles.setupEmoji}>🎄🔒</Text>
      <Text style={styles.title}>Christmas Lockbox</Text>
      <Text style={styles.setupIntro}>
        Squirrel money away every month, locked where you can't touch it — then
        the box springs open every year just before Christmas.
      </Text>

      <View style={styles.card}>
        <View style={styles.symbolRow}>
          {['£', '$', '€'].map((s) => (
            <Pressable
              key={s}
              style={[styles.symbolBtn, symbol === s && styles.symbolBtnOn]}
              onPress={() => setSymbol(s)}
            >
              <Text
                style={[styles.symbolBtnText, symbol === s && styles.symbolBtnTextOn]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>

        <MoneyInput
          label="How much to lock away each month?"
          symbol={symbol}
          value={amount}
          onChange={setAmount}
          placeholder="50"
        />

        <Stepper
          label="On which day of the month? (payday!)"
          value={depositDay}
          onChange={setDepositDay}
          min={1}
          max={28}
          format={(v) => `${ordinal(v)}`}
        />

        <Stepper
          label="Unlock each year on December…"
          value={unlockDay}
          onChange={setUnlockDay}
          min={1}
          max={24}
          format={(v) => `Dec ${v}`}
        />

        <MoneyInput
          label="Christmas goal (optional)"
          symbol={symbol}
          value={goal}
          onChange={setGoal}
          placeholder="e.g. 600"
        />
      </View>

      <Pressable
        style={[styles.bigBtn, !amountMinor && styles.bigBtnOff]}
        disabled={!amountMinor}
        onPress={() =>
          onDone(
            newVault({
              monthlyMinor: amountMinor,
              depositDay,
              unlockDay,
              goalMinor,
              symbol,
            })
          )
        }
      >
        <Text style={styles.bigBtnText}>Lock it in 🔒</Text>
      </Pressable>

      <Text style={styles.finePrint}>
        Your phone can't reach into your bank account by itself — pair this
        lockbox with a monthly standing order into a separate savings account
        (there's a step-by-step inside). The lockbox keeps the score, keeps it
        locked, and rings the bell in December.
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
export default function App() {
  const { width, height } = useWindowDimensions();
  const [vault, setVault] = useState(undefined); // undefined=loading, null=setup
  const [showSettings, setShowSettings] = useState(false);
  const [showSpend, setShowSpend] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [, setTick] = useState(0);

  // Load, then catch up any deposits that came due while the app was closed.
  useEffect(() => {
    (async () => {
      const loaded = await loadVault();
      setVault(loaded ? accrue(loaded) : null);
    })();
  }, []);

  // Re-accrue when the app returns to the foreground, and refresh countdowns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setVault((v) => (v ? accrue(v) : v));
        setTick((t) => t + 1);
      }
    });
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // Persist and (re)plan reminders whenever the vault changes.
  useEffect(() => {
    if (vault) {
      saveVault(vault);
      planReminders(vault);
      pushWidgetData(vault);
    }
  }, [vault]);

  const update = useCallback((fn) => setVault((v) => fn(v)), []);

  if (vault === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  if (vault === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <Setup onDone={(v) => setVault(accrue(v))} />
        <Snow width={width} height={height} />
      </SafeAreaView>
    );
  }

  const now = new Date();
  const { symbol, unlockDay, monthlyMinor, goalMinor } = vault.config;
  const bal = balanceMinor(vault);
  const win = windowState(unlockDay, now);
  const emg = emergencyState(vault, now);
  const unlocked = isUnlocked(vault, now);
  const nextDep = nextDepositDate(vault, now);
  const projected = projectedAtUnlockMinor(vault, now);
  const goalPct = goalMinor ? Math.min(1, projected / goalMinor) : null;

  const history = [...vault.ledger].reverse().slice(0, 12);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>🎄 Christmas Lockbox</Text>
          <Pressable style={styles.gearBtn} onPress={() => setShowSettings(true)}>
            <Text style={styles.gearText}>⚙︎</Text>
          </Pressable>
        </View>

        {/* ---------------- Vault card ---------------- */}
        <View style={[styles.card, unlocked ? styles.cardOpen : styles.cardLocked]}>
          <Text style={styles.vaultEmoji}>{unlocked ? '🎁' : '🔒'}</Text>
          <Text style={styles.balance}>{fmtMoney(bal, symbol)}</Text>

          {unlocked ? (
            <>
              <Text style={styles.openLine}>
                {emg.phase === 'open'
                  ? 'Emergency unlock — the box is open.'
                  : `It's Christmas! Open until ${fmtDate(win.closesAt)}.`}
              </Text>
              <Pressable style={styles.bigBtn} onPress={() => setShowSpend(true)}>
                <Text style={styles.bigBtnText}>Spend from the box 🎉</Text>
              </Pressable>
              {emg.phase !== 'open' && (
                <Text style={styles.hint}>
                  Whatever's left on {fmtDate(win.closesAt)} stays in and rolls
                  over to next Christmas.
                </Text>
              )}
              {emg.phase === 'open' && (
                <Pressable
                  style={styles.linkBtn}
                  onPress={() => update((v) => ({ ...v, emergency: null }))}
                >
                  <Text style={styles.linkBtnText}>Re-lock the box</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.lockedLine}>
                Locked until {fmtDate(win.opensAt)}
              </Text>
              <Text style={styles.countdown}>
                {daysUntil(win.opensAt, now)} days to go
              </Text>
              <Text style={styles.hint}>
                Projected in the box by unlock day:{' '}
                <Text style={styles.hintStrong}>{fmtMoney(projected, symbol)}</Text>
              </Text>
              {goalPct !== null && (
                <View style={styles.goalWrap}>
                  <View style={styles.goalTrack}>
                    <View style={[styles.goalFill, { width: `${goalPct * 100}%` }]} />
                  </View>
                  <Text style={styles.goalText}>
                    {Math.round(goalPct * 100)}% of your{' '}
                    {fmtMoney(goalMinor, symbol)} goal
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ---------------- Bank link status ---------------- */}
        {vault.bankConfirmed ? (
          <View style={styles.cardRow}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>Bank</Text>
              <Text style={styles.rowSub}>
                Standing order active — your bank moves the money ✓
              </Text>
            </View>
            <Text style={styles.rowBig}>🏦</Text>
          </View>
        ) : (
          <View style={[styles.card, styles.cardWarn]}>
            <Text style={styles.sectionTitle}>Make it real 🏦</Text>
            <Text style={styles.howText}>
              Right now the box is only keeping score. Your bank does the
              actual money-moving: set up a standing order of{' '}
              {fmtMoney(monthlyMinor, symbol)} on the {ordinal(vault.config.depositDay)}{' '}
              of each month into a savings account you never look at — a
              one-time, two-minute job in your banking app.
            </Text>
            <View style={styles.btnRow}>
              <Pressable style={styles.smallBtnAlt} onPress={() => setShowHow(true)}>
                <Text style={styles.smallBtnAltText}>Show me how</Text>
              </Pressable>
              <Pressable
                style={styles.smallBtn}
                onPress={() =>
                  confirm(
                    'Standing order set up?',
                    'Confirm your bank is now sending the money automatically each month.',
                    () => update((v) => ({ ...v, bankConfirmed: true }))
                  )
                }
              >
                <Text style={styles.smallBtnText}>Done — it's live ✓</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ---------------- Next deposit ---------------- */}
        {nextDep && (
          <View style={styles.cardRow}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>Next deposit</Text>
              <Text style={styles.rowSub}>
                {fmtMoney(monthlyMinor, symbol)} on {fmtDate(nextDep)}
              </Text>
            </View>
            <Text style={styles.rowBig}>🗓️</Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <Pressable style={styles.smallBtn} onPress={() => setShowExtra(true)}>
            <Text style={styles.smallBtnText}>＋ Add extra</Text>
          </Pressable>
          <Pressable style={styles.smallBtnAlt} onPress={() => setShowHow(true)}>
            <Text style={styles.smallBtnAltText}>How the money moves</Text>
          </Pressable>
        </View>

        {/* ---------------- History ---------------- */}
        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>History</Text>
            {history.map((e) => (
              <View key={e.id} style={styles.histRow}>
                <View style={styles.rowLeft}>
                  <Text style={styles.histNote}>
                    {e.type === 'deposit' && '🎁 '}
                    {e.type === 'extra' && '✨ '}
                    {e.type === 'spend' && '🛍️ '}
                    {e.note}
                  </Text>
                  <Text style={styles.histDate}>{fmtDate(new Date(e.atISO))}</Text>
                </View>
                <Text
                  style={[
                    styles.histAmount,
                    e.type === 'spend' ? styles.histSpend : styles.histIn,
                  ]}
                >
                  {e.type === 'spend' ? '−' : '+'}
                  {fmtMoney(e.amountMinor, symbol)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Saving {fmtMoney(monthlyMinor, symbol)}/month · unlocks every Dec{' '}
          {unlockDay}
        </Text>
      </ScrollView>

      <Snow width={width} height={height} count={unlocked ? 26 : 12} />

      <AmountModal
        visible={showExtra}
        title="Add extra to the box"
        subtitle="Extra money locks instantly — no takebacks until December."
        symbol={symbol}
        confirmText="Lock it in"
        onClose={() => setShowExtra(false)}
        onConfirm={(minor, note) => {
          update((v) => addExtra(v, minor, note));
          setShowExtra(false);
        }}
      />

      <AmountModal
        visible={showSpend}
        title="Spend from the box"
        subtitle={`Available: ${fmtMoney(bal, symbol)}`}
        symbol={symbol}
        confirmText="Take it out 🎉"
        maxMinor={bal}
        onClose={() => setShowSpend(false)}
        onConfirm={(minor, note) => {
          update((v) => spend(v, minor, note));
          setShowSpend(false);
        }}
      />

      <HowModal visible={showHow} vault={vault} onClose={() => setShowHow(false)} />

      <SettingsModal
        visible={showSettings}
        vault={vault}
        emg={emg}
        onClose={() => setShowSettings(false)}
        onUpdate={update}
        onReset={() => {
          clearVault();
          setShowSettings(false);
          setVault(null);
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function AmountModal({
  visible,
  title,
  subtitle,
  symbol,
  confirmText,
  maxMinor,
  onClose,
  onConfirm,
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const minor = parseMoney(amount);
  const tooMuch = maxMinor != null && minor != null && minor > maxMinor;

  useEffect(() => {
    if (visible) {
      setAmount('');
      setNote('');
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalSub}>{subtitle}</Text>
          <View style={styles.moneyRow}>
            <Text style={styles.moneySymbol}>{symbol}</Text>
            <TextInput
              style={styles.moneyInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={C.dim}
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoFocus
            />
          </View>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="What's it for? (optional)"
            placeholderTextColor={C.dim}
          />
          {tooMuch && (
            <Text style={styles.errText}>That's more than what's in the box.</Text>
          )}
          <Pressable
            style={[styles.bigBtn, (!minor || tooMuch) && styles.bigBtnOff]}
            disabled={!minor || tooMuch}
            onPress={() => onConfirm(minor, note.trim())}
          >
            <Text style={styles.bigBtnText}>{confirmText}</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={onClose}>
            <Text style={styles.linkBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function HowModal({ visible, vault, onClose }) {
  const { symbol, monthlyMinor, depositDay } = vault.config;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>How the money moves 🏦</Text>
          <Text style={styles.howText}>
            No app can quietly dip into your bank account — only banks and
            licensed payment companies can move your money. So the trick is a
            two-part machine:
          </Text>
          <Text style={styles.howStep}>
            1. In your banking app, open a separate savings account (or savings
            “pot/space”) that you never look at.
          </Text>
          <Text style={styles.howStep}>
            2. Set up a standing order of {fmtMoney(monthlyMinor, symbol)} into
            it on the {ordinal(depositDay)} of every month — right after
            payday.
          </Text>
          <Text style={styles.howStep}>
            3. This lockbox mirrors that money automatically each month, keeps
            it locked out of sight, and tells you when it's Christmas-spending
            time. Out of sight, out of spend.
          </Text>
          <Text style={styles.howText}>
            Make it properly untouchable: use a notice account, a fixed-term
            saver, or a bank whose app you don't keep on your phone. Bonus:
            pick one that pays interest and the elves pay you for waiting.
          </Text>
          <Pressable style={styles.bigBtn} onPress={onClose}>
            <Text style={styles.bigBtnText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SettingsModal({ visible, vault, emg, onClose, onUpdate, onReset }) {
  const { symbol, unlockDay, depositDay, monthlyMinor, goalMinor } = vault.config;
  const [amount, setAmount] = useState(String(monthlyMinor / 100));
  const [goal, setGoal] = useState(goalMinor ? String(goalMinor / 100) : '');
  const [day, setDay] = useState(depositDay);
  const [uDay, setUDay] = useState(unlockDay);

  useEffect(() => {
    if (visible) {
      setAmount(String(monthlyMinor / 100));
      setGoal(goalMinor ? String(goalMinor / 100) : '');
      setDay(depositDay);
      setUDay(unlockDay);
    }
  }, [visible, monthlyMinor, goalMinor, depositDay, unlockDay]);

  const amountMinor = parseMoney(amount);

  const save = () => {
    onUpdate((v) => ({
      ...v,
      config: {
        ...v.config,
        monthlyMinor: amountMinor ?? v.config.monthlyMinor,
        goalMinor: goal.trim() ? parseMoney(goal) : null,
        depositDay: day,
        unlockDay: uDay,
      },
    }));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalCard}
        >
          <Text style={styles.modalTitle}>Settings</Text>

          <MoneyInput
            label="Monthly amount (from next deposit)"
            symbol={symbol}
            value={amount}
            onChange={setAmount}
            placeholder="50"
          />
          <Stepper
            label="Deposit day"
            value={day}
            onChange={setDay}
            min={1}
            max={28}
            format={(v) => ordinal(v)}
          />
          <Stepper
            label="Unlock day (December)"
            value={uDay}
            onChange={setUDay}
            min={1}
            max={24}
            format={(v) => `Dec ${v}`}
          />
          <MoneyInput
            label="Goal (blank for none)"
            symbol={symbol}
            value={goal}
            onChange={setGoal}
            placeholder="600"
          />

          <Pressable style={styles.bigBtn} onPress={save}>
            <Text style={styles.bigBtnText}>Save</Text>
          </Pressable>

          {/* ---------- Emergency unlock ---------- */}
          <View style={styles.dangerZone}>
            <Text style={styles.sectionTitle}>Emergency unlock 🚨</Text>
            {emg.phase === 'none' && (
              <>
                <Text style={styles.howText}>
                  Life happens. If you truly need the money early, you can ask
                  the box to open — but it makes you wait 72 hours first, so
                  impulse can't win.
                </Text>
                <Pressable
                  style={styles.dangerBtn}
                  onPress={() =>
                    confirm(
                      'Start emergency unlock?',
                      'The box will open after a 72-hour wait. You can cancel any time before then.',
                      () =>
                        onUpdate((v) => ({
                          ...v,
                          emergency: { requestedMs: Date.now(), open: false },
                        })),
                      true
                    )
                  }
                >
                  <Text style={styles.dangerBtnText}>Request emergency unlock</Text>
                </Pressable>
              </>
            )}
            {emg.phase === 'waiting' && (
              <>
                <Text style={styles.howText}>
                  Cooling off… the box can open on{' '}
                  <Text style={styles.hintStrong}>
                    {emg.readyAt.toLocaleString()}
                  </Text>
                  . Still sure?
                </Text>
                <Pressable
                  style={styles.smallBtnAlt}
                  onPress={() => onUpdate((v) => ({ ...v, emergency: null }))}
                >
                  <Text style={styles.smallBtnAltText}>
                    Cancel — keep it locked 💪
                  </Text>
                </Pressable>
              </>
            )}
            {emg.phase === 'ready' && (
              <>
                <Text style={styles.howText}>
                  The 72 hours are up. Opening now unlocks the whole box until
                  you re-lock it.
                </Text>
                <Pressable
                  style={styles.dangerBtn}
                  onPress={() =>
                    onUpdate((v) => ({
                      ...v,
                      emergency: { ...v.emergency, open: true },
                    }))
                  }
                >
                  <Text style={styles.dangerBtnText}>Open the box now</Text>
                </Pressable>
                <Pressable
                  style={styles.smallBtnAlt}
                  onPress={() => onUpdate((v) => ({ ...v, emergency: null }))}
                >
                  <Text style={styles.smallBtnAltText}>
                    Never mind — keep it locked 💪
                  </Text>
                </Pressable>
              </>
            )}
            {emg.phase === 'open' && (
              <Pressable
                style={styles.smallBtnAlt}
                onPress={() => onUpdate((v) => ({ ...v, emergency: null }))}
              >
                <Text style={styles.smallBtnAltText}>Re-lock the box</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.dangerZone}>
            <Pressable
              style={styles.dangerBtn}
              onPress={() =>
                confirm(
                  'Start over?',
                  'This wipes the lockbox and its history on this phone. (It does not touch your real bank account.)',
                  onReset,
                  true
                )
              }
            >
              <Text style={styles.dangerBtnText}>Reset the lockbox</Text>
            </Pressable>
          </View>

          <Pressable style={styles.linkBtn} onPress={onClose}>
            <Text style={styles.linkBtnText}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' },
  setupScroll: { padding: 20, paddingBottom: 60, maxWidth: 560, width: '100%', alignSelf: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: C.text, fontSize: 24, fontWeight: '800' },
  gearBtn: { padding: 8 },
  gearText: { color: C.dim, fontSize: 22 },

  setupEmoji: { fontSize: 44, textAlign: 'center', marginTop: 24 },
  setupIntro: { color: C.dim, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 16, textAlign: 'center' },

  card: { backgroundColor: C.card, borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  cardLocked: { alignItems: 'center', borderColor: C.goldDim },
  cardWarn: { borderColor: C.gold },
  cardOpen: { alignItems: 'center', borderColor: C.good },
  vaultEmoji: { fontSize: 40, marginBottom: 6 },
  balance: { color: C.text, fontSize: 42, fontWeight: '900', letterSpacing: -1 },
  lockedLine: { color: C.gold, fontSize: 15, fontWeight: '700', marginTop: 6 },
  openLine: { color: C.good, fontSize: 15, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  countdown: { color: C.text, fontSize: 17, marginTop: 2 },
  hint: { color: C.dim, fontSize: 13, marginTop: 10, textAlign: 'center', lineHeight: 19 },
  hintStrong: { color: C.text, fontWeight: '700' },

  goalWrap: { width: '100%', marginTop: 14 },
  goalTrack: { height: 10, borderRadius: 5, backgroundColor: C.cardAlt, overflow: 'hidden' },
  goalFill: { height: 10, borderRadius: 5, backgroundColor: C.gold },
  goalText: { color: C.dim, fontSize: 12, marginTop: 6, textAlign: 'center' },

  cardRow: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLeft: { flex: 1, paddingRight: 8 },
  rowTitle: { color: C.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  rowSub: { color: C.text, fontSize: 16, fontWeight: '600', marginTop: 2 },
  rowBig: { fontSize: 26 },

  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  smallBtn: { flex: 1, backgroundColor: C.gold, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  smallBtnText: { color: '#241a05', fontWeight: '800', fontSize: 14 },
  smallBtnAlt: { flex: 1, backgroundColor: C.cardAlt, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: C.line, paddingHorizontal: 8 },
  smallBtnAltText: { color: C.text, fontWeight: '600', fontSize: 13, textAlign: 'center' },

  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  histNote: { color: C.text, fontSize: 14 },
  histDate: { color: C.dim, fontSize: 12, marginTop: 1 },
  histAmount: { fontSize: 15, fontWeight: '700' },
  histIn: { color: C.good },
  histSpend: { color: C.red },

  footer: { color: C.dim, fontSize: 12, textAlign: 'center', marginTop: 6 },
  finePrint: { color: C.dim, fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' },

  inputBlock: { marginBottom: 14 },
  inputLabel: { color: C.dim, fontSize: 13, marginBottom: 6, flexShrink: 1 },
  moneyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12 },
  moneySymbol: { color: C.gold, fontSize: 20, fontWeight: '700', marginRight: 6 },
  moneyInput: { flex: 1, color: C.text, fontSize: 20, fontWeight: '700', paddingVertical: 12 },
  noteInput: { backgroundColor: C.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15, marginTop: 10 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  stepBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  stepBtnText: { color: C.gold, fontSize: 20, fontWeight: '800' },
  stepValue: { color: C.text, fontSize: 15, fontWeight: '700', minWidth: 56, textAlign: 'center' },

  symbolRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  symbolBtn: { flex: 1, backgroundColor: C.cardAlt, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  symbolBtnOn: { backgroundColor: C.gold, borderColor: C.gold },
  symbolBtnText: { color: C.dim, fontSize: 17, fontWeight: '700' },
  symbolBtnTextOn: { color: '#241a05' },

  bigBtn: { backgroundColor: C.red, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  bigBtnOff: { opacity: 0.4 },
  bigBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  linkBtn: { alignItems: 'center', paddingVertical: 12 },
  linkBtnText: { color: C.dim, fontSize: 14 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(4,10,7,0.85)', justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '88%' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  modalTitle: { color: C.text, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: C.dim, fontSize: 14, marginBottom: 14 },
  errText: { color: C.red, fontSize: 13, marginTop: 8 },

  howText: { color: C.dim, fontSize: 14, lineHeight: 21, marginBottom: 10 },
  howStep: { color: C.text, fontSize: 14, lineHeight: 21, marginBottom: 10 },

  dangerZone: { marginTop: 22, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 16 },
  dangerBtn: { backgroundColor: 'rgba(224,82,82,0.15)', borderColor: C.red, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  dangerBtnText: { color: C.red, fontWeight: '700', fontSize: 14 },
});
