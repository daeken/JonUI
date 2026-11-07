import assert from 'node:assert/strict';
import { Button, Component, ForEach, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';

const initial = { title: 'Collection', rows: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], filter: '' };
const model = State(initial), query = State(''), shown = State(true);
initial.rows[0].label = 'outside mutation';
assert.equal(model.value.rows[0].label, 'Alpha');
const unsubscribe = query.subscribe(filter => { model.value = { ...model.value, filter }; });
const instances = new Map();
let setups = 0, disposals = 0, effectRuns = 0, notifications = 0;
model.subscribe(value => { notifications++; assert.ok(Object.isFrozen(value.rows) && Object.isFrozen(value.rows[0])); });
const Row = Component((scope, initialProps) => {
  const local = scope.state({ clicks: 0, history: [] });
  instances.set(initialProps.id, local); setups++;
  scope.onDispose(() => { disposals++; });
  return props => VStack([
    Text(`${props.id}:${props.label}:${local.value.clicks}`),
    Button(`Increment ${props.id}`, () => {
      local.value = { clicks: local.value.clicks + 1, history: [...local.value.history, props.label] };
    }),
  ]);
});
const Collection = Component(scope => {
  const local = scope.state({ visited: ['mounted'] });
  scope.effect(() => { model.value; effectRuns++; });
  return () => VStack([
    Text(`${model.value.title}:${model.value.filter}:${local.value.visited.length}`),
    ForEach(model.value.rows, { id: row => row.id }, row => Row(row)),
  ]);
});
const app = runApp({ title: 'JonUI structured state test', width: 650, height: 500,
  content: VStack([
    TextField('Filter', { text: query.binding }),
    View(() => shown.value ? Collection() : Text('hidden')),
  ]), onStop: unsubscribe,
});
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = (s, value) => s.nodes.some(n => n.props.value === value);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify(snapshot())}`);
}
let native = await until(s => s.states.length === 6 && has(s, 'a:Alpha:0') && effectRuns === 1, 'initial structured cells');
assert.equal(native.liveCells, 6);
const modelID = native.states.find(s => s.value?.title === 'Collection').id;
assert.deepEqual(native.states.find(s => s.id === modelID).value, model.value);
assert.throws(() => model.binding, /scalar State/);
const a = instances.get('a'), b = instances.get('b');
const button = native.nodes.find(n => n.kind === 'button' && n.props.title === 'Increment a').id;
test.request('debug.action', { id: button });
await until(s => has(s, 'a:Alpha:1'), 'structured local state from native action');
assert.deepEqual(a.value.history, ['Alpha']); assert.deepEqual(b.value.history, []);
const localID = snapshot().states.find(s => s.value?.clicks === 1).id;
assert.deepEqual(snapshot().states.find(s => s.id === localID).value, a.value);
model.value = { ...model.value, title: 'Reordered', rows: [...model.value.rows].reverse() };
native = await until(s => has(s, 'Reordered::1') && has(s, 'a:Alpha:1'), 'collection replacement and keyed reorder');
assert.equal(instances.get('a'), a); assert.equal(instances.get('b'), b); assert.equal(setups, 2);
assert.equal(native.nodes.find(n => n.kind === 'button' && n.props.title === 'Increment a').id, button);
test.request('debug.write', { id: query.binding.id, value: 'Hello 🦊 café' });
await until(s => has(s, 'Reordered:Hello 🦊 café:1'), 'native scalar edit updates structured model');
const previous = model.value, previousEffects = effectRuns, previousNotifications = notifications;
model.value = { rows: model.value.rows.map(row => ({ label: row.label, id: row.id })), filter: 'Hello 🦊 café', title: 'Reordered' };
await sleep(20);
assert.equal(model.value, previous); assert.equal(effectRuns, previousEffects); assert.equal(notifications, previousNotifications);
const revision = snapshot().states.find(s => s.id === modelID).revision;
assert.equal(revision, 2, 'structurally equal writes do not advance native revision');
// Structured native events use the same revision acknowledgement rules as scalar bindings.
test.request('debug.write', { id: modelID, value: { title: 'older native', rows: model.value.rows, filter: '' } });
model.value = { ...model.value, title: 'newer JS' };
await until(s => has(s, 'newer JS:Hello 🦊 café:1'), 'queued older structured native event is ignored');
assert.equal(model.value.title, 'newer JS');
test.request('debug.write', { id: modelID, value: { title: 'latest native', rows: model.value.rows, filter: 'native 🦊' } });
await until(s => has(s, 'latest native:native 🦊:1'), 'latest structured native event');
assert.ok(Object.isFrozen(model.value) && Object.isFrozen(model.value.rows[0]));
assert.throws(() => { model.value.rows[0].label = 'hidden mutation'; }, TypeError);
const cycle = {}; cycle.self = cycle;
assert.throws(() => { model.value = cycle; }, /cycles/);
assert.equal(model.value.title, 'latest native');
shown.value = false;
await until(s => s.states.length === 3 && s.liveCells === 3, 'structured scoped cells release after unmount');
const baseline = test.stats();
a.value = { clicks: 100, history: [] };
test.request('debug.action', { id: button }); await sleep(10); assert.equal(a.value.clicks, 1);
assert.throws(() => test.request('debug.write', { id: localID, value: {} }), /Unknown test state/);
for (let i = 0; i < 30; i++) {
  shown.value = true;
  await until(s => s.states.length === 6 && has(s, 'a:Alpha:0'), `structured mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3, `structured unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 62); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
console.log('PASS structured State: immutable Unicode native round trips, scalar edit synchronization, keyed array replacement, structural equality/revisions, scoped actions, stale events and 30 mount/unmount cycles');
