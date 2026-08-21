import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { fmtHours, fmtMoney, fmtRate } from './src/format';
import {
  currentPeriod,
  daysLeftInPeriod,
  inPeriod,
  PERIOD_TYPES,
  periodLabel,
  periodsPerYear,
  periodSubtitle,
  shiftPeriod,
} from './src/periods';
import { computeShifts, KEY_BASIC, overlappingShifts, summarise } from './src/pay';
import { blankShift, JOB_COLORS, newId } from './src/settings';
import { loadSettings, loadShifts, saveSettings, saveShifts } from './src/storage';
import { buildCsv, buildSummaryText } from './src/summary';
import { estimateDeductions, REGIONS, STUDENT_LOAN_PLANS, TAX_YEAR } from './src/tax';
import {
  addDaysISO,
  compareISO,
  DAY_SHORT,
  dayLabel,
  fmtDateLong,
  fmtTime,
  parseTimeInput,
  relativeDayLabel,
  taxYearLabel,
  taxYearStartISO,
  todayISO,
} from './src/time';
import {
  Button,
  C,
  Card,
  Chip,
  ChipRow,
  Divider,
  NumberField,
  SectionLabel,
  Segmented,
  StatRow,
  SwitchRow,
  TextField,
  TimeField,
} from './src/ui';

const TABS = [
  { id: 'shifts', label: 'Shifts' },
  { id: 'pay', label: 'Pay' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [settings, setSettings] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('shifts');
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loadedSettings, loadedShifts] = await Promise.all([loadSettings(), loadShifts()]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setShifts(loadedShifts);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Save on every change: there's no "done" moment in an app like this, and
  // losing a shift you typed on the bus is unforgivable.
  useEffect(() => {
    if (ready) saveShifts(shifts);
  }, [ready, shifts]);
  useEffect(() => {
    if (ready && settings) saveSettings(settings);
  }, [ready, settings]);

  const updateSettings = useCallback((patch) => {
    setSettings((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
  }, []);

  const results = useMemo(() => (settings ? computeShifts(shifts, settings) : []), [shifts, settings]);

  const period = useMemo(() => {
    if (!settings) return null;
    return shiftPeriod(currentPeriod(settings.payPeriod), settings.payPeriod, offset);
  }, [settings, offset]);

  const periodResults = useMemo(
    () => (period ? results.filter((result) => inPeriod(result.shift.date, period)) : []),
    [results, period],
  );

  const totals = useMemo(() => summarise(periodResults, settings || {}), [periodResults, settings]);

  const deductions = useMemo(() => {
    if (!settings?.takeHome?.enabled) return null;
    return estimateDeductions(totals.gross, periodsPerYear(settings.payPeriod), settings.takeHome);
  }, [settings, totals.gross]);

  const saveShift = useCallback((shift) => {
    setShifts((current) => {
      const exists = current.some((item) => item.id === shift.id);
      return exists ? current.map((item) => (item.id === shift.id ? shift : item)) : [...current, shift];
    });
    setDraft(null);
  }, []);

  const removeShift = useCallback((id) => {
    setShifts((current) => current.filter((item) => item.id !== id));
    setDraft(null);
    setExpandedId((current) => (current === id ? null : current));
  }, []);

  const duplicateShift = useCallback((shift) => {
    const copy = { ...shift, id: newId(), date: addDaysISO(shift.date, 1) };
    setDraft(copy);
  }, []);

  if (!settings || !ready) {
    return (
      <View style={[styles.root, styles.centre]}>
        <StatusBar style="light" />
        <Text style={styles.loading}>Shift Pay</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.brand}>Shift Pay</Text>
          {tab !== 'settings' ? (
            <Pressable
              onPress={() => setDraft(blankShift(settings))}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.addBtnText}>+ Add shift</Text>
            </Pressable>
          ) : null}
        </View>

        {tab === 'shifts' ? (
          <ShiftsScreen
            settings={settings}
            period={period}
            offset={offset}
            setOffset={setOffset}
            results={periodResults}
            totals={totals}
            deductions={deductions}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            onEdit={setDraft}
            onDuplicate={duplicateShift}
            onDelete={removeShift}
            onAdd={() => setDraft(blankShift(settings))}
          />
        ) : null}

        {tab === 'pay' ? (
          <PayScreen
            settings={settings}
            period={period}
            offset={offset}
            setOffset={setOffset}
            results={periodResults}
            totals={totals}
            deductions={deductions}
            allResults={results}
            onOpenSettings={() => setTab('settings')}
          />
        ) : null}

        {tab === 'settings' ? (
          <SettingsScreen
            settings={settings}
            update={updateSettings}
            shiftCount={shifts.length}
            onClearShifts={() => setShifts([])}
          />
        ) : null}

        <View style={styles.tabBar}>
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
                <View style={[styles.tabDot, active && { backgroundColor: C.accent }]} />
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>

      <ShiftEditor
        draft={draft}
        settings={settings}
        shifts={shifts}
        onChange={setDraft}
        onSave={saveShift}
        onDelete={removeShift}
        onClose={() => setDraft(null)}
      />
    </View>
  );
}

function PeriodBar({ period, settings, offset, setOffset }) {
  const daysLeft = offset === 0 ? daysLeftInPeriod(period) : null;
  return (
    <View style={styles.periodBar}>
      <Pressable onPress={() => setOffset(offset - 1)} style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}>
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <Pressable onPress={() => setOffset(0)} style={{ flex: 1 }}>
        <Text style={styles.periodLabel}>{periodLabel(period)}</Text>
        <Text style={styles.periodSub}>
          {offset === 0
            ? `This pay period · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
            : periodSubtitle(period, settings.payPeriod)}
        </Text>
      </Pressable>
      <Pressable onPress={() => setOffset(offset + 1)} style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}>
        <Text style={styles.arrowText}>›</Text>
      </Pressable>
    </View>
  );
}

function HeadlineCard({ totals, deductions, settings }) {
  return (
    <Card>
      <Text style={styles.headlineLabel}>Gross pay this period</Text>
      <Text style={styles.headline}>{fmtMoney(totals.gross, settings.currency)}</Text>
      <View style={styles.headlineRow}>
        <Headline stat={fmtHours(totals.hours)} label="worked" />
        <Headline stat={String(totals.count)} label={totals.count === 1 ? 'shift' : 'shifts'} />
        <Headline
          stat={totals.hours > 0 ? fmtMoney(totals.avgHourly, settings.currency) : '—'}
          label="average/hour"
        />
      </View>
      {deductions ? (
        <>
          <Divider />
          <StatRow
            label="Estimated take-home"
            hint={`After tax, NI${deductions.pension > 0 ? ', pension' : ''}${deductions.studentLoan > 0 ? ', student loan' : ''} — ${TAX_YEAR} rates`}
            value={fmtMoney(deductions.net, settings.currency)}
            tone={C.accent}
            bold
          />
        </>
      ) : null}
    </Card>
  );
}

function Headline({ stat, label }) {
  return (
    <View style={styles.headlineStat}>
      <Text style={styles.headlineStatValue}>{stat}</Text>
      <Text style={styles.headlineStatLabel}>{label}</Text>
    </View>
  );
}

function ShiftsScreen({
  settings,
  period,
  offset,
  setOffset,
  results,
  totals,
  deductions,
  expandedId,
  setExpandedId,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}) {
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <PeriodBar period={period} settings={settings} offset={offset} setOffset={setOffset} />
      <HeadlineCard totals={totals} deductions={deductions} settings={settings} />

      <SectionLabel>{results.length ? `${results.length} ${results.length === 1 ? 'shift' : 'shifts'}` : 'Shifts'}</SectionLabel>

      {results.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>Nothing logged for this period</Text>
          <Text style={styles.emptyBody}>
            Add a shift and the pay works itself out from your hourly rate, your unpaid break and any
            night, weekend or overtime rules you've set up.
          </Text>
          <Button label="Add a shift" onPress={onAdd} style={{ marginTop: 14 }} />
        </Card>
      ) : null}

      {results.map((result) => (
        <ShiftRow
          key={result.id}
          result={result}
          settings={settings}
          expanded={expandedId === result.id}
          onToggle={() => setExpandedId(expandedId === result.id ? null : result.id)}
          onEdit={() => onEdit(result.shift)}
          onDuplicate={() => onDuplicate(result.shift)}
          onDelete={() => onDelete(result.id)}
        />
      ))}

      {results.length ? (
        <Text style={styles.footnote}>Tap a shift to see how its pay was worked out.</Text>
      ) : null}
    </ScrollView>
  );
}

function ShiftRow({ result, settings, expanded, onToggle, onEdit, onDuplicate, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { shift } = result;
  const times = `${fmtTime(result.startMin, settings.clock24)} – ${fmtTime(result.endMin, settings.clock24)}`;
  const color = result.job?.color || C.accent;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.shiftRow, pressed && { opacity: 0.75 }]}>
        <View style={[styles.jobStripe, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.shiftTop}>
            <Text style={styles.shiftDate}>{dayLabel(shift.date)}</Text>
            {settings.jobs.length > 1 && result.job ? (
              <Text style={[styles.shiftJob, { color }]}>{result.job.name}</Text>
            ) : null}
          </View>
          <Text style={styles.shiftTimes}>
            {times}
            {result.crossesMidnight ? ' (+1)' : ''}
            {result.breakMins ? ` · ${result.breakMins}m break` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.shiftPay}>{fmtMoney(result.gross, settings.currency)}</Text>
          <Text style={styles.shiftHours}>{fmtHours(result.hours)}</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.shiftDetail}>
          <Text style={styles.detailHead}>{fmtDateLong(shift.date)}</Text>
          <StatRow label="Clocked" value={`${times}${result.crossesMidnight ? ' (next day)' : ''}`} />
          <StatRow label="Unpaid break" value={result.breakMins ? `${result.breakMins} min` : 'none'} />
          <StatRow label="Paid hours" value={fmtHours(result.hours)} />
          <Divider />
          {result.segments.map((seg) => (
            <StatRow
              key={`${seg.key}-${seg.otMult}-${seg.hourly}`}
              label={seg.label}
              hint={`${fmtHours(seg.hours)} at ${fmtRate(seg.hourly, settings.currency)}${
                seg.key === KEY_BASIC && seg.otMult === 1 ? '' : ` (base ${fmtRate(result.rate, settings.currency)})`
              }`}
              value={fmtMoney(seg.pay, settings.currency)}
              tone={seg.key === KEY_BASIC && seg.otMult === 1 ? undefined : C.accent}
            />
          ))}
          {result.segments.length === 0 ? <Text style={styles.emptyBody}>No paid time on this shift.</Text> : null}
          <Divider />
          <StatRow label="Gross for this shift" value={fmtMoney(result.gross, settings.currency)} bold />
          {settings.holiday?.enabled && result.holidayHours > 0 ? (
            <StatRow
              label="Holiday accrued"
              hint={`${settings.holiday.percent}% of hours worked`}
              value={`${fmtHours(result.holidayHours)} · ${fmtMoney(result.holidayPay, settings.currency)}`}
            />
          ) : null}
          {shift.note ? <Text style={styles.note}>“{shift.note}”</Text> : null}

          <View style={styles.detailButtons}>
            <Button label="Edit" onPress={onEdit} kind="secondary" style={{ flex: 1 }} />
            <Button label="Duplicate" onPress={onDuplicate} kind="secondary" style={{ flex: 1 }} />
            <Button
              label={confirmDelete ? 'Sure?' : 'Delete'}
              kind="danger"
              style={{ flex: 1 }}
              onPress={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function PayScreen({ settings, period, offset, setOffset, results, totals, deductions, allResults, onOpenSettings }) {
  const [shared, setShared] = useState(null);

  const yearStart = taxYearStartISO();
  const yearToDate = useMemo(
    () => summarise(allResults.filter((result) => compareISO(result.shift.date, yearStart) >= 0 && compareISO(result.shift.date, todayISO()) <= 0), settings),
    [allResults, settings, yearStart],
  );

  const share = useCallback(
    async (kind) => {
      const message =
        kind === 'csv'
          ? buildCsv(results, settings)
          : buildSummaryText({ period, results, totals, deductions, settings });
      try {
        await Share.share({ message });
        setShared(null);
      } catch {
        // Sharing isn't available in every context (the web preview, mostly),
        // so fall back to showing the text to copy by hand.
        setShared(message);
      }
    },
    [results, settings, period, totals, deductions],
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <PeriodBar period={period} settings={settings} offset={offset} setOffset={setOffset} />
      <HeadlineCard totals={totals} deductions={deductions} settings={settings} />

      <SectionLabel>What made up the pay</SectionLabel>
      <Card>
        {totals.segments.length ? (
          totals.segments.map((seg) => (
            <StatRow
              key={`${seg.key}-${seg.otMult}-${seg.hourly}`}
              label={seg.label}
              hint={`${fmtHours(seg.hours)} at ${fmtRate(seg.hourly, settings.currency)}`}
              value={fmtMoney(seg.pay, settings.currency)}
              tone={seg.key === KEY_BASIC && seg.otMult === 1 ? undefined : C.accent}
            />
          ))
        ) : (
          <Text style={styles.emptyBody}>No shifts in this period yet.</Text>
        )}
        {totals.segments.length ? (
          <>
            <Divider />
            <StatRow label="Gross" value={fmtMoney(totals.gross, settings.currency)} bold />
            {totals.breakMins > 0 ? (
              <StatRow
                label="Unpaid breaks"
                hint="Taken off the hours before any pay is worked out"
                value={fmtHours(totals.breakMins / 60)}
              />
            ) : null}
          </>
        ) : null}
      </Card>

      {settings.jobs.length > 1 && totals.byJob.length > 1 ? (
        <>
          <SectionLabel>By job</SectionLabel>
          <Card>
            {totals.byJob.map((job) => (
              <StatRow
                key={job.id}
                label={job.name}
                hint={`${job.count} ${job.count === 1 ? 'shift' : 'shifts'} · ${fmtHours(job.hours)}`}
                value={fmtMoney(job.gross, settings.currency)}
                tone={job.color}
              />
            ))}
          </Card>
        </>
      ) : null}

      {settings.holiday?.enabled ? (
        <>
          <SectionLabel>Holiday</SectionLabel>
          <Card>
            <StatRow
              label="Accrued this period"
              hint={`${settings.holiday.percent}% of the hours you worked — the standard accrual for 5.6 weeks' holiday`}
              value={`${fmtHours(totals.holidayHours)}`}
            />
            <StatRow label="Worth roughly" value={fmtMoney(totals.holidayPay, settings.currency)} />
          </Card>
        </>
      ) : null}

      <SectionLabel>Take-home estimate</SectionLabel>
      {deductions ? (
        <Card>
          <StatRow label="Gross" value={fmtMoney(deductions.gross, settings.currency)} />
          {deductions.pension > 0 ? (
            <StatRow
              label={`Pension (${deductions.pensionPercent}%)`}
              value={`−${fmtMoney(deductions.pension, settings.currency)}`}
              tone={C.warn}
            />
          ) : null}
          <StatRow
            label="Income tax"
            hint={`Tax-free allowance for this period: ${fmtMoney(deductions.periodAllowance, settings.currency)}`}
            value={`−${fmtMoney(deductions.incomeTax, settings.currency)}`}
            tone={C.warn}
          />
          <StatRow
            label="National Insurance"
            hint="Class 1, 8% above the primary threshold"
            value={`−${fmtMoney(deductions.nationalInsurance, settings.currency)}`}
            tone={C.warn}
          />
          {deductions.studentLoan > 0 ? (
            <StatRow
              label="Student loan"
              value={`−${fmtMoney(deductions.studentLoan, settings.currency)}`}
              tone={C.warn}
            />
          ) : null}
          <Divider />
          <StatRow label="Take-home" value={fmtMoney(deductions.net, settings.currency)} tone={C.accent} bold />
          <Text style={styles.footnote}>
            An estimate on this period alone, using {TAX_YEAR}{' '}
            {settings.takeHome.region === 'scotland' ? 'Scottish' : 'UK'} rates and the standard personal
            allowance — the income tax thresholds are frozen, so they still apply, but check gov.uk if a
            payslip disagrees. Real PAYE is worked out across the whole tax year, so a quiet week after a busy
            one usually comes back as a refund this can't see.
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.emptyBody}>
            Turn on the take-home estimate in Settings to see roughly what lands in the bank after tax,
            National Insurance, a workplace pension and a student loan.
          </Text>
          <Button label="Open settings" kind="secondary" onPress={onOpenSettings} style={{ marginTop: 12 }} />
        </Card>
      )}

      <SectionLabel>Tax year {taxYearLabel()} so far</SectionLabel>
      <Card>
        <StatRow label="Gross since 6 April" value={fmtMoney(yearToDate.gross, settings.currency)} bold />
        <StatRow label="Hours" value={fmtHours(yearToDate.hours)} />
        <StatRow label="Shifts" value={String(yearToDate.count)} />
        {yearToDate.overtimeHours > 0 ? (
          <StatRow label="Of which overtime" value={fmtHours(yearToDate.overtimeHours)} tone={C.accent} />
        ) : null}
      </Card>

      <View style={styles.detailButtons}>
        <Button label="Share summary" kind="secondary" style={{ flex: 1 }} onPress={() => share('text')} />
        <Button label="Share as CSV" kind="secondary" style={{ flex: 1 }} onPress={() => share('csv')} />
      </View>

      {shared ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.footnote}>Sharing isn't available here — copy the text below.</Text>
          <Text selectable style={styles.pre}>
            {shared}
          </Text>
          <Button label="Hide" kind="ghost" onPress={() => setShared(null)} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

function SettingsScreen({ settings, update, shiftCount, onClearShifts }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const group = (key, patch) => update({ [key]: { ...settings[key], ...patch } });

  const updateJob = (id, patch) =>
    update({ jobs: settings.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)) });

  const addJob = () => {
    const id = newId('job');
    update({
      jobs: [
        ...settings.jobs,
        { id, name: `Job ${settings.jobs.length + 1}`, rate: settings.jobs[0]?.rate || 12.21, color: JOB_COLORS[settings.jobs.length % JOB_COLORS.length] },
      ],
    });
  };

  const removeJob = (id) => {
    const jobs = settings.jobs.filter((job) => job.id !== id);
    update({ jobs, defaultJobId: jobs.some((job) => job.id === settings.defaultJobId) ? settings.defaultJobId : jobs[0].id });
  };

  const payPeriod = settings.payPeriod;

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <SectionLabel>Jobs and rates</SectionLabel>
      {settings.jobs.map((job) => (
        <Card key={job.id}>
          <View style={styles.jobHead}>
            <View style={[styles.jobDot, { backgroundColor: job.color || C.accent }]} />
            <TextField
              value={job.name}
              onChange={(name) => updateJob(job.id, { name })}
              placeholder="Job name"
              style={{ flex: 1 }}
            />
          </View>
          <View style={[styles.settingRow, { marginTop: 12 }]}>
            <Text style={styles.rowLabel}>Hourly rate</Text>
            <NumberField
              value={job.rate}
              onChange={(rate) => updateJob(job.id, { rate })}
              step={0.25}
              min={0}
              max={999}
              prefix={settings.currency}
              width={92}
            />
          </View>
          {settings.jobs.length > 1 ? (
            <View style={styles.detailButtons}>
              <Button
                label={settings.defaultJobId === job.id ? 'Default job' : 'Make default'}
                kind={settings.defaultJobId === job.id ? 'secondary' : 'ghost'}
                style={{ flex: 1 }}
                onPress={() => update({ defaultJobId: job.id })}
              />
              <Button label="Remove" kind="danger" style={{ flex: 1 }} onPress={() => removeJob(job.id)} />
            </View>
          ) : null}
        </Card>
      ))}
      <Button label="+ Add another job" kind="secondary" onPress={addJob} />

      <SectionLabel style={{ marginTop: 22 }}>New shifts start as</SectionLabel>
      <Card>
        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Start</Text>
          <TimeField value={settings.defaultStart} onChange={(defaultStart) => update({ defaultStart })} clock24={settings.clock24} />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Finish</Text>
          <TimeField value={settings.defaultEnd} onChange={(defaultEnd) => update({ defaultEnd })} clock24={settings.clock24} />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Unpaid break</Text>
          <NumberField
            value={settings.defaultBreakMins}
            onChange={(defaultBreakMins) => update({ defaultBreakMins })}
            step={5}
            min={0}
            max={480}
            suffix="min"
            decimals={0}
            width={72}
          />
        </View>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Pay period</SectionLabel>
      <Card>
        <Segmented
          options={PERIOD_TYPES.map((type) => ({ id: type.id, label: type.label }))}
          value={payPeriod.type}
          onChange={(type) => group('payPeriod', { type })}
        />
        {payPeriod.type === 'monthly' ? (
          <View style={[styles.settingRow, { marginTop: 14 }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLabel}>Period starts on the</Text>
              <Text style={styles.rowHint}>Set this to the day after your usual pay day</Text>
            </View>
            <NumberField
              value={payPeriod.monthStartDay}
              onChange={(monthStartDay) => group('payPeriod', { monthStartDay })}
              step={1}
              min={1}
              max={28}
              decimals={0}
              width={56}
            />
          </View>
        ) : (
          <>
            <Text style={[styles.rowHint, { marginTop: 14, marginBottom: 8 }]}>Week runs from</Text>
            <ChipRow>
              {DAY_SHORT.map((day, index) => (
                <Chip
                  key={day}
                  label={day}
                  selected={payPeriod.weekStart === index}
                  onPress={() => group('payPeriod', { weekStart: index })}
                />
              ))}
            </ChipRow>
          </>
        )}
        {payPeriod.type === 'fortnightly' ? (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.rowHint}>
              Fortnights are counted from {fmtDateLong(payPeriod.anchor)}. If the app has landed on the wrong
              week, nudge it across by one.
            </Text>
            <Button
              label="Shift fortnights by a week"
              kind="secondary"
              style={{ marginTop: 10 }}
              onPress={() => group('payPeriod', { anchor: addDaysISO(payPeriod.anchor, 7) })}
            />
          </View>
        ) : null}
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Overtime</SectionLabel>
      <Card>
        <SwitchRow
          label="Daily overtime"
          hint={`Hours past ${settings.overtime.dailyAfterHours}h in a single shift`}
          value={settings.overtime.dailyEnabled}
          onChange={(dailyEnabled) => group('overtime', { dailyEnabled })}
        />
        {settings.overtime.dailyEnabled ? (
          <>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>After</Text>
              <NumberField
                value={settings.overtime.dailyAfterHours}
                onChange={(dailyAfterHours) => group('overtime', { dailyAfterHours })}
                step={0.5}
                min={0}
                max={24}
                suffix="h"
                width={78}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>Paid at</Text>
              <NumberField
                value={settings.overtime.dailyMultiplier}
                onChange={(dailyMultiplier) => group('overtime', { dailyMultiplier })}
                step={0.25}
                min={1}
                max={5}
                suffix="×"
                width={78}
              />
            </View>
          </>
        ) : null}
        <Divider />
        <SwitchRow
          label="Weekly overtime"
          hint={`Hours past ${settings.overtime.weeklyAfterHours}h in one week, counted across every job`}
          value={settings.overtime.weeklyEnabled}
          onChange={(weeklyEnabled) => group('overtime', { weeklyEnabled })}
        />
        {settings.overtime.weeklyEnabled ? (
          <>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>After</Text>
              <NumberField
                value={settings.overtime.weeklyAfterHours}
                onChange={(weeklyAfterHours) => group('overtime', { weeklyAfterHours })}
                step={1}
                min={0}
                max={168}
                suffix="h"
                width={78}
              />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>Paid at</Text>
              <NumberField
                value={settings.overtime.weeklyMultiplier}
                onChange={(weeklyMultiplier) => group('overtime', { weeklyMultiplier })}
                step={0.25}
                min={1}
                max={5}
                suffix="×"
                width={78}
              />
            </View>
            <Text style={[styles.rowHint, { marginTop: 8 }]}>Overtime week starts on</Text>
            <ChipRow style={{ marginTop: 8 }}>
              {DAY_SHORT.map((day, index) => (
                <Chip
                  key={day}
                  label={day}
                  selected={settings.overtime.weekStart === index}
                  onPress={() => group('overtime', { weekStart: index })}
                />
              ))}
            </ChipRow>
          </>
        ) : null}
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Night and weekend rates</SectionLabel>
      <Card>
        <SwitchRow
          label="Night premium"
          hint="Extra for hours inside the night window, split to the minute"
          value={settings.night.enabled}
          onChange={(enabled) => group('night', { enabled })}
        />
        {settings.night.enabled ? (
          <>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>From</Text>
              <TimeField value={settings.night.start} onChange={(start) => group('night', { start })} clock24={settings.clock24} />
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.rowLabel}>Until</Text>
              <TimeField value={settings.night.end} onChange={(end) => group('night', { end })} clock24={settings.clock24} />
            </View>
            <PremiumValue
              premium={settings.night}
              currency={settings.currency}
              onChange={(patch) => group('night', patch)}
            />
          </>
        ) : null}
        <Divider />
        <SwitchRow
          label="Weekend premium"
          value={settings.weekend.enabled}
          onChange={(enabled) => group('weekend', { enabled })}
        />
        {settings.weekend.enabled ? (
          <>
            <Text style={[styles.rowHint, { marginTop: 6, marginBottom: 8 }]}>Days that count as weekend</Text>
            <ChipRow>
              {DAY_SHORT.map((day, index) => {
                const selected = settings.weekend.days.includes(index);
                return (
                  <Chip
                    key={day}
                    label={day}
                    selected={selected}
                    onPress={() =>
                      group('weekend', {
                        days: selected
                          ? settings.weekend.days.filter((d) => d !== index)
                          : [...settings.weekend.days, index].sort(),
                      })
                    }
                  />
                );
              })}
            </ChipRow>
            <PremiumValue
              premium={settings.weekend}
              currency={settings.currency}
              onChange={(patch) => group('weekend', patch)}
            />
          </>
        ) : null}
        <Text style={styles.footnote}>
          Premiums don't stack: if an hour is both night and weekend, the better-paid of the two applies.
          Overtime then multiplies whatever that hour was already worth.
        </Text>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Holiday accrual</SectionLabel>
      <Card>
        <SwitchRow
          label="Track holiday building up"
          hint="12.07% is the usual figure for hourly work — 5.6 weeks' holiday spread over the weeks you actually work"
          value={settings.holiday.enabled}
          onChange={(enabled) => group('holiday', { enabled })}
        />
        {settings.holiday.enabled ? (
          <View style={styles.settingRow}>
            <Text style={styles.rowLabel}>Accrual rate</Text>
            <NumberField
              value={settings.holiday.percent}
              onChange={(percent) => group('holiday', { percent })}
              step={0.01}
              min={0}
              max={100}
              suffix="%"
              width={86}
            />
          </View>
        ) : null}
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Take-home estimate</SectionLabel>
      <Card>
        <SwitchRow
          label="Estimate tax and National Insurance"
          hint={`${TAX_YEAR} rates, worked out on one pay period at a time`}
          value={settings.takeHome.enabled}
          onChange={(enabled) => group('takeHome', { enabled })}
        />
        {settings.takeHome.enabled ? (
          <>
            <Text style={[styles.rowHint, { marginTop: 10, marginBottom: 8 }]}>Where you pay tax</Text>
            <Segmented
              options={REGIONS.map((region) => ({ id: region.id, label: region.label }))}
              value={settings.takeHome.region}
              onChange={(region) => group('takeHome', { region })}
            />
            <View style={[styles.settingRow, { marginTop: 12 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.rowLabel}>Workplace pension</Text>
                <Text style={styles.rowHint}>Your own contribution, taken before tax</Text>
              </View>
              <NumberField
                value={settings.takeHome.pensionPercent}
                onChange={(pensionPercent) => group('takeHome', { pensionPercent })}
                step={0.5}
                min={0}
                max={100}
                suffix="%"
                width={80}
              />
            </View>
            <Text style={[styles.rowHint, { marginTop: 10, marginBottom: 8 }]}>Student loan</Text>
            <ChipRow>
              {STUDENT_LOAN_PLANS.map((plan) => (
                <Chip
                  key={plan.id}
                  label={plan.label}
                  selected={settings.takeHome.studentLoan === plan.id}
                  onPress={() => group('takeHome', { studentLoan: plan.id })}
                />
              ))}
            </ChipRow>
          </>
        ) : null}
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Display</SectionLabel>
      <Card>
        <SwitchRow
          label="24-hour clock"
          value={settings.clock24}
          onChange={(clock24) => update({ clock24 })}
        />
        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Currency symbol</Text>
          <TextField
            value={settings.currency}
            onChange={(currency) => update({ currency: currency.slice(0, 3) })}
            style={{ width: 72, textAlign: 'center' }}
          />
        </View>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Your data</SectionLabel>
      <Card>
        <Text style={styles.emptyBody}>
          {shiftCount} {shiftCount === 1 ? 'shift is' : 'shifts are'} stored on this phone and nowhere else.
          There's no account and no server — deleting the app deletes them.
        </Text>
        <Button
          label={confirmClear ? 'Tap again to delete every shift' : 'Delete all shifts'}
          kind="danger"
          style={{ marginTop: 14 }}
          onPress={() => {
            if (confirmClear) {
              onClearShifts();
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
            }
          }}
        />
      </Card>

      <Text style={styles.footnote}>
        Shift Pay works out what you should be paid from what you tell it. It isn't payroll: your employer's
        rounding, salary sacrifice, an unusual tax code or a pay rise part-way through a period will all move
        the real figure. Use it to check a payslip, not to replace one.
      </Text>
    </ScrollView>
  );
}

function PremiumValue({ premium, currency, onChange }) {
  return (
    <>
      <Text style={[styles.rowHint, { marginTop: 12, marginBottom: 8 }]}>Paid as</Text>
      <Segmented
        options={[
          { id: 'plus', label: `Extra ${currency}/hour` },
          { id: 'multiply', label: 'Multiple of rate' },
        ]}
        value={premium.mode}
        onChange={(mode) => onChange({ mode })}
      />
      <View style={[styles.settingRow, { marginTop: 12 }]}>
        <Text style={styles.rowLabel}>{premium.mode === 'plus' ? 'Extra per hour' : 'Rate multiplied by'}</Text>
        <NumberField
          value={premium.value}
          onChange={(value) => onChange({ value })}
          step={premium.mode === 'plus' ? 0.25 : 0.1}
          min={premium.mode === 'plus' ? 0 : 1}
          max={99}
          prefix={premium.mode === 'plus' ? currency : undefined}
          suffix={premium.mode === 'plus' ? undefined : '×'}
          width={92}
        />
      </View>
    </>
  );
}

const BREAK_CHOICES = [0, 15, 20, 30, 45, 60];

function ShiftEditor({ draft, settings, shifts, onChange, onSave, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [draft?.id]);

  const isExisting = !!draft && shifts.some((shift) => shift.id === draft.id);

  // Preview the draft in the context of every other shift, so weekly
  // overtime shows up while you're still typing.
  const preview = useMemo(() => {
    if (!draft) return null;
    const others = shifts.filter((shift) => shift.id !== draft.id);
    return computeShifts([...others, draft], settings).find((result) => result.id === draft.id) || null;
  }, [draft, shifts, settings]);

  const clashes = useMemo(() => (draft ? overlappingShifts(draft, shifts) : []), [draft, shifts]);

  const set = (patch) => onChange({ ...draft, ...patch });
  const job = draft ? settings.jobs.find((item) => item.id === draft.jobId) : null;
  const usingOverride = !!draft && Number.isFinite(Number(draft.rate)) && Number(draft.rate) > 0;

  return (
    <Modal visible={!!draft} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe}>
          <View style={styles.header}>
            <Text style={styles.brand}>{isExisting ? 'Edit shift' : 'New shift'}</Text>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {draft ? (
                <>
                  <Card>
                    <View style={styles.dateRow}>
                      <Pressable
                        onPress={() => set({ date: addDaysISO(draft.date, -1) })}
                        style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.arrowText}>‹</Text>
                      </Pressable>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={styles.dateBig}>{fmtDateLong(draft.date)}</Text>
                        <Text style={styles.rowHint}>{relativeDayLabel(draft.date) || draft.date}</Text>
                      </View>
                      <Pressable
                        onPress={() => set({ date: addDaysISO(draft.date, 1) })}
                        style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.arrowText}>›</Text>
                      </Pressable>
                    </View>
                    <ChipRow style={{ marginTop: 12, justifyContent: 'center' }}>
                      <Chip label="Today" selected={draft.date === todayISO()} onPress={() => set({ date: todayISO() })} />
                      <Chip
                        label="Yesterday"
                        selected={draft.date === addDaysISO(todayISO(), -1)}
                        onPress={() => set({ date: addDaysISO(todayISO(), -1) })}
                      />
                    </ChipRow>
                  </Card>

                  <Card>
                    <View style={styles.settingRow}>
                      <Text style={styles.rowLabel}>Started</Text>
                      <TimeField value={draft.start} onChange={(start) => set({ start })} clock24={settings.clock24} />
                    </View>
                    <View style={styles.settingRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>Finished</Text>
                        {preview?.crossesMidnight ? <Text style={styles.rowHint}>Runs into the next day</Text> : null}
                      </View>
                      <TimeField value={draft.end} onChange={(end) => set({ end })} clock24={settings.clock24} />
                    </View>
                    <Divider />
                    <Text style={[styles.rowLabel, { marginBottom: 10 }]}>Unpaid break</Text>
                    <ChipRow>
                      {BREAK_CHOICES.map((mins) => (
                        <Chip
                          key={mins}
                          label={mins === 0 ? 'None' : `${mins}m`}
                          selected={draft.breakMins === mins}
                          onPress={() => set({ breakMins: mins })}
                        />
                      ))}
                    </ChipRow>
                    <View style={styles.settingRow}>
                      <Text style={styles.rowHint}>or set it exactly</Text>
                      <NumberField
                        value={draft.breakMins}
                        onChange={(breakMins) => set({ breakMins })}
                        step={5}
                        min={0}
                        max={720}
                        suffix="min"
                        decimals={0}
                        width={72}
                      />
                    </View>
                  </Card>

                  {settings.jobs.length > 1 ? (
                    <Card>
                      <Text style={[styles.rowLabel, { marginBottom: 10 }]}>Job</Text>
                      <ChipRow>
                        {settings.jobs.map((item) => (
                          <Chip
                            key={item.id}
                            label={item.name}
                            tone={item.color}
                            selected={draft.jobId === item.id}
                            onPress={() => set({ jobId: item.id })}
                          />
                        ))}
                      </ChipRow>
                    </Card>
                  ) : null}

                  <Card>
                    <SwitchRow
                      label="Different rate for this shift"
                      hint={
                        usingOverride
                          ? 'Overrides the job rate for this shift only'
                          : `Normally ${fmtRate(job?.rate || 0, settings.currency)}`
                      }
                      value={usingOverride}
                      onChange={(on) => set({ rate: on ? job?.rate || 0 : null })}
                    />
                    {usingOverride ? (
                      <View style={styles.settingRow}>
                        <Text style={styles.rowLabel}>Rate for this shift</Text>
                        <NumberField
                          value={Number(draft.rate)}
                          onChange={(rate) => set({ rate })}
                          step={0.25}
                          min={0}
                          max={999}
                          prefix={settings.currency}
                          width={92}
                        />
                      </View>
                    ) : null}
                    <Divider />
                    <Text style={[styles.rowLabel, { marginBottom: 8 }]}>Note</Text>
                    <TextField
                      value={draft.note}
                      onChange={(note) => set({ note })}
                      placeholder="Ward, site, who you covered for…"
                    />
                  </Card>

                  {clashes.length ? (
                    <Card tone="alt">
                      <Text style={[styles.rowLabel, { color: C.warn }]}>
                        This overlaps {clashes.length === 1 ? 'a shift' : `${clashes.length} shifts`} you've
                        already logged
                      </Text>
                      <Text style={styles.rowHint}>
                        {clashes
                          .map((clash) => `${dayLabel(clash.date)} ${fmtTime(parseTimeInput(clash.start) ?? 0, settings.clock24)}`)
                          .join(', ')}
                        . Save it anyway if you really did work both.
                      </Text>
                    </Card>
                  ) : null}

                  {preview ? (
                    <Card>
                      <Text style={styles.previewPay}>{fmtMoney(preview.gross, settings.currency)}</Text>
                      <Text style={styles.rowHint}>
                        {fmtHours(preview.hours)} paid
                        {preview.breakMins ? ` after a ${preview.breakMins} minute break` : ''}
                        {preview.hours > 0 ? ` · ${fmtRate(preview.avgHourly, settings.currency)} average` : ''}
                      </Text>
                      {preview.segments.length > 1 || (preview.segments[0] && preview.segments[0].key !== KEY_BASIC) ? (
                        <>
                          <Divider />
                          {preview.segments.map((seg) => (
                            <StatRow
                              key={`${seg.key}-${seg.otMult}-${seg.hourly}`}
                              label={seg.label}
                              hint={`${fmtHours(seg.hours)} at ${fmtRate(seg.hourly, settings.currency)}`}
                              value={fmtMoney(seg.pay, settings.currency)}
                              tone={seg.key === KEY_BASIC && seg.otMult === 1 ? undefined : C.accent}
                            />
                          ))}
                        </>
                      ) : null}
                      {preview.hours === 0 ? (
                        <Text style={[styles.rowHint, { color: C.warn, marginTop: 6 }]}>
                          Nothing paid: check the times and the break.
                        </Text>
                      ) : null}
                    </Card>
                  ) : null}

                  <Button label={isExisting ? 'Save changes' : 'Add shift'} onPress={() => onSave(draft)} />
                  {isExisting ? (
                    <Button
                      label={confirmDelete ? 'Tap again to delete' : 'Delete shift'}
                      kind="danger"
                      style={{ marginTop: 10 }}
                      onPress={() => (confirmDelete ? onDelete(draft.id) : setConfirmDelete(true))}
                    />
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  loading: { color: C.accent, fontSize: 22, fontWeight: '800', letterSpacing: 0.4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 18 : 8,
    paddingBottom: 10,
  },
  brand: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  addBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  addBtnText: { color: C.accentInk, fontWeight: '700', fontSize: 14 },
  closeBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  closeText: { color: C.dim, fontSize: 15, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingTop: 2,
  },
  arrow: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: C.card,
  },
  arrowText: { color: C.text, fontSize: 24, fontWeight: '600', lineHeight: 28 },
  periodLabel: { color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  periodSub: { color: C.faint, fontSize: 12.5, textAlign: 'center', marginTop: 2 },
  headlineLabel: { color: C.dim, fontSize: 13, fontWeight: '600' },
  headline: {
    color: C.accent,
    fontSize: 42,
    fontWeight: '800',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  headlineRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  headlineStat: { flex: 1 },
  headlineStatValue: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  headlineStatLabel: { color: C.faint, fontSize: 12, marginTop: 2 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyBody: { color: C.dim, fontSize: 14, lineHeight: 20 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  jobStripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  shiftTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shiftDate: { color: C.text, fontSize: 15.5, fontWeight: '700' },
  shiftJob: { fontSize: 12.5, fontWeight: '600' },
  shiftTimes: { color: C.dim, fontSize: 13.5, marginTop: 3 },
  shiftPay: { color: C.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  shiftHours: { color: C.faint, fontSize: 12.5, marginTop: 2 },
  shiftDetail: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    paddingTop: 10,
  },
  detailHead: { color: C.dim, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  detailButtons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  note: { color: C.dim, fontSize: 14, fontStyle: 'italic', marginTop: 10 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  rowLabel: { color: C.text, fontSize: 15, flexShrink: 1 },
  rowHint: { color: C.faint, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobDot: { width: 12, height: 12, borderRadius: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  dateBig: { color: C.text, fontSize: 18, fontWeight: '700' },
  previewPay: { color: C.accent, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  footnote: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 4 },
  pre: {
    color: C.dim,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    backgroundColor: C.bg,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 5 },
  tabText: { color: C.faint, fontSize: 13.5, fontWeight: '600' },
  tabTextActive: { color: C.text, fontWeight: '700' },
  tabDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
});
