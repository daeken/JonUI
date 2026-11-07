import assert from 'node:assert/strict';
import { Component, DatePicker, Form, State, Text, View, runApp, __testing as test } from 'jonui';
const initial = Date.UTC(2024, 1, 29, 12, 30, 45, 123);
const shown = State(true), alternate = State(false), config = State({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1), timeZone: 'UTC', components: 'dateAndTime', style: 'compact' });
let value, other, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; value = scope.state(initial); other = scope.state(Date.UTC(2026, 0, 1));
  scope.onDispose(() => { disposals++; });
  return () => {
    const active = alternate.value ? other : value;
    return Form([
      DatePicker('Appointment 🦊', { selection: active.binding, ...config.value }),
      View(() => Text(`Timestamp:${active.value}`)),
    ]);
  };
});
const app = runApp({ title: 'JonUI date input tests', width: 700, height: 550,
  content: View(() => shown.value ? Panel() : Text('hidden')),
});
const snapshot = () => test.request('debug.snapshot');
const dates = () => test.request('debug.dates').dates;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ snapshot: snapshot(), dates: dates() })}`);
}
let native = await until(s => s.states.length === 5 && dates().length > 0 && dates()[0].value === initial, 'real native DatePicker with exact milliseconds');
const id = native.nodes.find(n => n.kind === 'datepicker').id, originalCell = value.binding.id;
assert.equal(test.stats().actions, 0);
assert.equal(dates()[0].year, 2024); assert.equal(dates()[0].month, 2); assert.equal(dates()[0].day, 29); assert.equal(dates()[0].hour, 12);
const changed = Date.UTC(2025, 0, 1, 17, 45, 30, 321);
test.request('debug.date', { index: dates()[0].index, value: changed });
await until(s => s.nodes.some(n => n.props.value === `Timestamp:${changed}`), 'actual NSDatePicker target/action');
assert.equal(value.value, changed);
const revision = snapshot().states.find(s => s.id === originalCell).revision;
config.value = { ...config.value, timeZone: 'America/Chicago' };
await until(() => dates()[0]?.hour === 11 && dates()[0]?.timeZone === 'America/Chicago', 'native Chicago winter time zone');
assert.equal(value.value, changed); assert.equal(snapshot().states.find(s => s.id === originalCell).revision, revision);
value.value = Date.UTC(2026, 2, 8, 7, 30);
await until(() => dates()[0]?.hour === 1 && dates()[0]?.minute === 30, 'before DST gap');
value.value = Date.UTC(2026, 2, 8, 8, 30);
await until(() => dates()[0]?.hour === 3 && dates()[0]?.minute === 30, 'after DST gap');
const held = value.value;
for (const [style, components] of [['graphical', 'date'], ['automatic', 'time'], ['compact', 'dateAndTime']]) {
  config.value = { ...config.value, style, components };
  await until(s => s.nodes.find(n => n.id === id)?.props.style === style && dates().length > 0 && test.request('debug.layout').frames.some(f => f.id === id && f.rect.width > 0 && f.rect.height > 0), `rendered ${style}/${components}`);
  await sleep(10); assert.equal(value.value, held); assert.equal(setups, 1);
}
config.value = { ...config.value, timeZone: 'Asia/Kolkata' };
await until(() => dates()[0]?.hour === 14 && dates()[0]?.minute === 0, 'half-hour zone offset');
assert.equal(value.value, held);
const lower = Date.UTC(2025, 0, 1), upper = Date.UTC(2025, 11, 31, 23, 59, 59, 999);
config.value = { ...config.value, timeZone: 'UTC', min: lower, max: upper };
await until(s => s.nodes.find(n => n.id === id)?.props.max === upper, 'dynamic date bounds');
assert.equal(value.value, held, 'bounds do not rewrite application State');
assert.equal(test.request('debug.dateBinding', { id }).value, upper);
test.request('debug.dateBinding', { id, value: Date.UTC(2024, 0, 1) });
await until(() => value.value === lower, 'native binding lower clamp');
test.request('debug.dateBinding', { id, value: Date.UTC(2027, 0, 1) });
await until(() => value.value === upper, 'native binding upper clamp');
test.request('debug.date', { index: dates()[0].index, value: Date.UTC(2025, 5, 1) });
value.value = Date.UTC(2025, 6, 1, 12, 0, 0, 987);
await sleep(20); assert.equal(value.value, Date.UTC(2025, 6, 1, 12, 0, 0, 987), 'newer acknowledged JS timestamp wins');
alternate.value = true;
await until(s => s.nodes.find(n => n.id === id)?.props.state === other.binding.id, 'date input rebound');
await sleep(20);
const rebound = Date.UTC(2025, 7, 15, 9, 15, 0, 456);
test.request('debug.date', { index: dates()[0].index, value: rebound });
await until(() => other.value === rebound, 'native date action uses current cell');
assert.equal(value.value, Date.UTC(2025, 6, 1, 12, 0, 0, 987));
const unchanged = snapshot().nodes, picker = unchanged.find(n => n.id === id);
for (const props of [
  { ...picker.props, min: upper, max: lower }, { ...picker.props, min: -62135596800001 },
  { ...picker.props, max: 253402300800000 }, { ...picker.props, min: true },
  { ...picker.props, timeZone: 'Not/AZone' }, { ...picker.props, components: 'seconds' }, { ...picker.props, style: 'wheel' },
  { ...picker.props, state: shown.binding.id },
]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...picker, props }] })); assert.deepEqual(snapshot().nodes, unchanged);
}
const form = unchanged.find(n => n.kind === 'form');
assert.throws(() => test.request('commit', { nodes: [
  { id: 900000, kind: 'slider', props: { title: 'Invalid shared range', state: other.binding.id, min: -1e100, max: 1e100 }, children: [] },
  { ...form, children: [...form.children, 900000] },
] }), /Shared numeric range/);
assert.deepEqual(snapshot().nodes, unchanged);
assert.throws(() => { other.value = 'not a timestamp'; }, /Invalid binding value/);
assert.throws(() => { other.value = 253402300800000; }, /Invalid binding value/);
assert.equal(other.value, rebound);
config.value = { ...config.value, min: lower, max: lower };
await until(s => s.nodes.find(n => n.id === id)?.props.max === lower, 'single-instant date range');
assert.equal(test.request('debug.dateBinding', { id }).value, lower); assert.equal(other.value, rebound);
shown.value = false;
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && dates().length === 0, 'date input teardown');
assert.throws(() => test.request('debug.dateBinding', { id, value: lower }), /Unknown date input/);
assert.throws(() => test.request('debug.write', { id: originalCell, value: lower }), /Unknown test state/);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  config.value = { min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1), style: ['automatic', 'compact', 'graphical'][i % 3], components: ['date', 'time', 'dateAndTime'][i % 3], timeZone: i % 2 ? 'UTC' : 'America/Chicago' };
  shown.value = true;
  await until(s => s.states.length === 5 && dates().length > 0, `date mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && dates().length === 0, `date unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS DatePicker: actual NSDatePicker actions, millisecond/UTC/leap-day values, DST and half-hour zones, styles/components, bounds/clamping, rebinding/revisions, atomic rejection and 20 native mount/unmount cycles');
