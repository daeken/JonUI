import assert from 'node:assert/strict';
import { Component, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';

const query = State('first'), shown = State(true), shared = State('initial'), source = State(0);
const runs = [], publications = [];
let stopTask, subscriptions = 0, cleanups = 0, disposals = 0, ticks = 0, timerStarts = 0, timerStops = 0;
const Child = Component(scope => {
  const output = scope.state('waiting');
  scope.onDispose(() => { disposals++; });
  stopTask = scope.task(async task => {
    const name = scope.props.query;
    // This deliberately ignores AbortSignal: obsolete promises must still be safe.
    let resolve, reject;
    const wait = new Promise((yes, no) => { resolve = yes; reject = no; });
    const run = { name, task, resolve, reject, output, finished: false };
    runs.push(run);
    assert.ok(test.request('debug.snapshot').nodes.some(n => n.kind === 'textfield' && n.props.title === 'Task output'));
    source.subscribe(() => { subscriptions++; });
    task.signal.addEventListener('abort', () => { shared.value = 'obsolete abort'; });
    task.onCancel(() => { cleanups++; shared.value = 'obsolete cleanup'; });
    try { await wait; }
    finally { shared.value = `finally:${name}`; run.finished = true; }
    output.value = name;
    shared.value = name;
    run.published = task.commit(() => publications.push(name));
  });
  scope.task(task => {
    timerStarts++;
    const timer = setInterval(() => { ticks++; }, 1);
    task.onCancel(() => { clearInterval(timer); timerStops++; });
  });
  return () => VStack([Text(`Result:${output.value}`), TextField('Task output', { text: output.binding })]);
});
const app = runApp({ title: 'JonUI asynchronous task lifetime test', width: 600, height: 400,
  content: VStack([
    TextField('Query', { text: query.binding }),
    View(() => Text(`Shared:${shared.value}`)),
    View(() => shown.value ? Child({ query: query.value }) : Text('hidden')),
  ]),
});
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = (s, value) => s.nodes.some(n => n.props.value === value);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify(snapshot())}`);
}
await until(s => s.states.length === 5 && runs.length === 1 && ticks > 1, 'initial tasks after native commit');
assert.deepEqual(test.taskStats(), { pending: 1 });
assert.deepEqual(test.effectStats(), { active: 2, pending: 0 });
test.request('debug.write', { id: query.binding.id, value: 'Hello 🦊 café' });
await until(() => runs.length === 2, 'native query edit restarts current-props task');
assert.equal(runs[0].task.signal.aborted, true);
assert.equal(shared.value, 'initial');
source.value++;
assert.equal(subscriptions, 1, 'superseded task unsubscribes immediately');
runs[1].resolve();
await until(s => has(s, 'Result:Hello 🦊 café') && has(s, 'Shared:Hello 🦊 café'), 'current asynchronous result reaches native views');
assert.deepEqual(test.taskStats(), { pending: 0 });
runs[0].resolve();
await until(() => runs[0].finished, 'old ignored-abort promise finishes');
assert.equal(shared.value, 'Hello 🦊 café');
assert.equal(runs[0].output.value, 'Hello 🦊 café');
assert.equal(runs[0].published, false);
assert.deepEqual(publications, ['Hello 🦊 café']);
source.value++; assert.equal(subscriptions, 2, 'settled task retains owned resources');
stopTask(); stopTask();
assert.equal(runs[1].task.signal.aborted, true);
source.value++; assert.equal(subscriptions, 2);
query.value = 'stopped'; await sleep(20); assert.equal(runs.length, 2);
shown.value = false;
await until(s => s.states.length === 4 && s.liveCells === 4, 'owner releases native cells');
assert.equal(cleanups, 2); assert.equal(timerStops, 1);
assert.deepEqual(test.effectStats(), { active: 0, pending: 0 });
const baseline = test.stats(), stoppedTicks = ticks;
await sleep(10); assert.equal(ticks, stoppedTicks);
for (let i = 0; i < 20; i++) {
  query.value = `cycle:${i}`; shown.value = true;
  await until(s => s.states.length === 5 && runs.length === i + 3, `task mount ${i}`);
  const run = runs.at(-1);
  assert.equal(run.task.isCurrent, true);
  shown.value = false;
  await until(s => s.states.length === 4 && s.liveCells === 4, `task unmount ${i}`);
  assert.equal(run.task.signal.aborted, true);
  assert.deepEqual(test.taskStats(), { pending: 0 });
  // Both a stale rejection's finally and a stale resolution must be harmless.
  if (i % 2) run.reject(new Error('obsolete request failure')); else run.resolve();
  await until(() => run.finished, `late completion ${i}`);
  assert.equal(shared.value, 'Hello 🦊 café');
  assert.equal(run.output.value, 'waiting');
  source.value++; assert.equal(subscriptions, 2);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(cleanups, 22); assert.equal(disposals, 21);
assert.equal(timerStarts, 21); assert.equal(timerStops, timerStarts);
assert.deepEqual(publications, ['Hello 🦊 café']);
// Normal application shutdown must cancel an unresolved task too.
shown.value = true;
await until(() => runs.length === 23, 'task mounted before application close');
const last = runs.at(-1);
test.request('debug.close'); await app;
assert.equal(last.task.signal.aborted, true);
last.resolve(); await sleep(10);
assert.equal(shared.value, 'Hello 🦊 café');
assert.deepEqual(test.taskStats(), { pending: 0 });
assert.deepEqual(test.effectStats(), { active: 0, pending: 0 });
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
assert.equal(timerStops, timerStarts);
console.log('PASS tasks: native Unicode results, current props, latest-run writes/commits, explicit stop, subscription/timer ownership, obsolete rejections, 20 mount/unmount cycles and shutdown cancellation');
