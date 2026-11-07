import assert from 'node:assert/strict';
import { Button, Component, Computed, ForEach, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const input = State('first'), prefix = State('P'), shown = State(true), broken = State(false), search = State('');
const model = State({ rows: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Hello 🦊 café' }] });
let upperRuns = 0, labelRuns = 0, setups = 0, disposals = 0, taskCleanups = 0, latestLabel;
const upper = Computed(() => { upperRuns++; return input.value.toUpperCase(); });
const effects = [], tasks = [];
const Panel = Component(scope => {
  setups++;
  const count = scope.state(0);
  const label = scope.computed(() => { labelRuns++; return `${scope.props.prefix}:${upper.value}:${count.value}`; });
  latestLabel = label;
  const rows = scope.computed(() => model.value.rows.filter(row => row.label.includes(search.value)));
  const safeLabel = scope.computed(() => {
    if (broken.value) throw new Error('intentional derived preview failure');
    return label.value;
  });
  scope.effect(() => { effects.push(label.value); });
  scope.task(async task => {
    const value = label.value;
    let resolve;
    const wait = new Promise(done => { resolve = done; });
    tasks.push({ value, task, resolve });
    task.onCancel(() => { taskCleanups++; });
    await wait;
  });
  scope.onDispose(() => { assert.equal(typeof label.value, 'string'); disposals++; });
  return () => VStack([
    View(() => Text(safeLabel.value), { fallback: error => Text(error.message) }),
    Button('Increment', () => { count.value++; }),
    ForEach(rows.value, { id: row => row.id }, row => Text(`Row:${row.id}:${row.label}`)),
  ]);
});
const app = runApp({ title: 'JonUI computed value tests', width: 650, height: 500,
  content: VStack([
    TextField('Input', { text: input.binding }), TextField('Search', { text: search.binding }),
    View(() => shown.value ? Panel({ prefix: prefix.value }) : Text('hidden')),
  ]),
});
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = (s, value) => s.nodes.some(node => node.props.value === value);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify(snapshot())}`);
}
let native = await until(s => s.states.length === 7 && has(s, 'P:FIRST:0') && tasks.length === 1, 'initial lazy derived views/effects/tasks');
assert.equal(native.liveCells, 7); assert.equal(upperRuns, 1); assert.equal(labelRuns, 1);
assert.equal(test.computedStats().active, 4);
test.request('debug.write', { id: input.binding.id, value: 'Hello 🦊 café' });
await until(s => has(s, 'P:HELLO 🦊 CAFÉ:0') && tasks.length === 2, 'native Unicode input through chained computed values');
assert.equal(tasks[0].task.signal.aborted, true);
assert.equal(upperRuns, 2); assert.equal(labelRuns, 2);
prefix.value = 'Current';
await until(s => has(s, 'Current:HELLO 🦊 CAFÉ:0') && tasks.length === 3, 'scoped computed current props');
assert.equal(upperRuns, 2); assert.equal(labelRuns, 3);
const button = snapshot().nodes.find(node => node.kind === 'button' && node.props.title === 'Increment').id;
test.request('debug.action', { id: button });
await until(s => has(s, 'Current:HELLO 🦊 CAFÉ:1') && tasks.length === 4, 'native action through scoped State and computed');
assert.equal(upperRuns, 2); assert.equal(labelRuns, 4);
input.value = 'one'; input.value = 'two'; input.value = 'three';
await until(s => has(s, 'Current:THREE:1') && tasks.length === 5, 'batched derived input changes');
assert.equal(upperRuns, 3); assert.equal(labelRuns, 5);
assert.deepEqual(effects, tasks.map(task => task.value));
test.request('debug.write', { id: search.binding.id, value: '🦊' });
await until(s => has(s, 'Row:b:Hello 🦊 café') && !has(s, 'Row:a:Alpha'), 'computed collection filter');
assert.equal(labelRuns, 5, 'unrelated collection computation does not recalculate labels');
broken.value = true;
await until(s => has(s, 'intentional derived preview failure'), 'computed render error recovery');
assert.equal(test.computedStats().active, 4, 'inner recovery keeps owning component alive');
broken.value = false;
await until(s => has(s, 'Current:THREE:1'), 'failed computed retries when tracked input changes');
const old = latestLabel;
shown.value = false;
await until(s => s.states.length === 6 && s.liveCells === 6 && test.computedStats().active === 1, 'scoped computed/native state release');
assert.throws(() => old.value, /disposed Computed/);
assert.equal(taskCleanups, tasks.length);
const baseline = test.stats(), computedBaseline = test.computedStats();
assert.deepEqual(computedBaseline, { active: 1, dependencies: 1 });
for (let i = 0; i < 30; i++) {
  const before = tasks.length;
  shown.value = true;
  await until(s => s.states.length === 7 && has(s, 'Current:THREE:0') && tasks.length === before + 1, `computed mount ${i}`);
  assert.equal(test.computedStats().active, 4);
  shown.value = false;
  await until(s => s.states.length === 6 && s.liveCells === 6 && test.computedStats().active === 1, `computed unmount ${i}`);
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.computedStats(), computedBaseline);
}
assert.equal(setups, 31); assert.equal(disposals, setups); assert.equal(taskCleanups, tasks.length);
assert.equal(upperRuns, 3, 'app-owned cache survives owner remounts without recomputation');
for (const task of tasks) task.resolve(); await sleep(10);
test.request('debug.close'); await app;
assert.throws(() => upper.value, /disposed Computed/);
assert.deepEqual(test.computedStats(), { active: 0, dependencies: 0 });
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
console.log('PASS Computed: native Unicode input/output, cached chains, current props, effects/task cancellation, batching, collection filtering, recoverable errors and 30 mount/unmount cycles with zero retained derivations');
