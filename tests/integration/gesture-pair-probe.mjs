import assert from 'node:assert/strict';
import { Button, Component, Focus, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), first = State({ kind: 'tap', count: 1 }), second = State({ kind: 'spatial', count: 1 });
const epoch = State(1), priority = State('normal'), disabled = State(false);
const pair = view => view.modifier('testGesturePair', { first: first.value, second: second.value, epoch: epoch.value, priority: priority.value });
if (process.env.JONUI_CASE === 'no-layout') {
  await assert.rejects(runApp({ title: 'Pair gate', width: 400, height: 300, content: pair(Text('rejected')) }), /Unknown view modifier/);
  assert.equal(test.request('debug.snapshot').liveViews, 0); assert.equal(test.request('debug.snapshot').pairProbeOwners, 0);
  console.log('PASS pair probe requires the offscreen layout test gate');
} else {
let buttons = 0, setups = 0, disposals = 0, model;
const Owner = Component(scope => {
  setups++; model = scope.state('日本 🦊'); scope.onDispose(() => disposals++);
  return () => VStack([
    pair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle')),
    pair(Button('Button', () => buttons++).frame({ width: 260, height: 40 }).contentShape('rectangle')),
    pair(TextField('Field', { text: model.binding, focusName: 'field' }).frame({ width: 260, height: 30 })),
  ], { spacing: 20 }).disabled(disabled.value);
});
const app = runApp({ title: 'Native simultaneous pair probe', width: 420, height: 360, content: View(() => shown.value ? Owner() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (n.props.name !== 'testGesturePair') return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.title === label || child?.props.value === label; });
}
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < end);
  assert.fail(`Timed out ${label}: ${JSON.stringify(snapshot())}`);
}
const read = label => test.request('debug.pairTrace', { id: node(label).id });
const ended = result => result.records.filter(record => record.phase === 'ended');
async function click(label, count = 1, wait = 30) {
  await until(() => node(label) && test.request('debug.layout').frames.some(frame => frame.id === node(label).id), 'layout'); read(label);
  const queued = test.request('debug.tap', { id: node(label).id, count, command: true });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native click'); await sleep(wait); return read(label);
}
function check(result, count) {
  assert.ok(result.records.every(record => record.phase !== 'uncaptured'), JSON.stringify(result));
  const values = ended(result); const expected = count < first.value.count && count < second.value.count ? 0 : first.value.count === 1 && second.value.count === 1 ? count : 1;
  assert.equal(values.length, expected, JSON.stringify(result));
  for (const value of values) {
    assert.equal(value.epoch, epoch.value); assert.ok(value.interval > 0); assert.ok(value.completion > 0); assert.ok([0, 1].includes(value.slot));
    for (const [key, definition] of [['first', first.value], ['second', second.value]]) {
      if (count < definition.count) assert.equal(value[key], null, JSON.stringify(result));
      else { assert.equal(value[key].kind, definition.kind); if (definition.kind === 'spatial') { assert.ok(Number.isFinite(value[key].x)); assert.ok(Number.isFinite(value[key].y)); } else assert.deepEqual(value[key], { kind: 'tap' }); }
    }
  }
}
await until(() => snapshot().nodes.length, 'base'); const baseline = test.stats(), surfaces = snapshot().layoutSurfaceCount;
shown.value = true; test.flush(); await until(() => node('Field') && snapshot().hostedControlCount === 1, 'owner');
if (process.env.JONUI_CASE === 'close') {
  await until(() => test.request('debug.layout').frames.some(frame => frame.id === node('Pair').id), 'shutdown layout');
  const queued = test.request('debug.tap', { id: node('Pair').id, hold: 1, command: true });
  await until(() => read('Pair').records.some(record => record.phase === 'began'), 'shutdown start');
  assert.ok(snapshot().pointerTimerCount > 0); test.request('debug.close'); await app;
  assert.equal(disposals, setups); assert.equal(snapshot().pairProbeTraceCount, 0); assert.equal(snapshot().pairProbeOwners, 0);
  assert.equal(snapshot().pointerTimerCount, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().pairProbeArmOwners, 0);
  console.log('PASS pair probe held shutdown clears native traces, timers, cells and views');
} else {
assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured);
for (const [a, ac, b, bc] of [['tap', 1, 'spatial', 1], ['tap', 1, 'tap', 2], ['spatial', 2, 'tap', 1], ['tap', 2, 'spatial', 2]]) {
  first.value = { kind: a, count: ac }; second.value = { kind: b, count: bc };
  for (const p of ['normal', 'high', 'simultaneous']) {
    priority.value = p; epoch.value++; test.flush(); await sleep(40); assert.equal(Focus.request(captured), true); assert.equal(model.value, '日本 🦊');
    for (const count of [1, 2]) {
      check(await click('Pair', count, ac !== bc || count < ac ? 650 : 30), count);
      const before = buttons, result = await click('Button', count, 650);
      const recognized = count >= Math.min(ac, bc);
      const normalDoubleWins = p === 'normal' && ac === 2 && bc === 2 && count === 2;
      if (p === 'normal' && !normalDoubleWins) assert.deepEqual(ended(result), []); else check(result, count);
      const blocks = normalDoubleWins || p === 'high' && recognized;
      assert.equal(buttons, before + (blocks ? 0 : count));
    }
  }
}
// Same-count double clicks produce two native group ends in one pointer-observer
// interval. That interval is deliberately not exposed as a recognition session.
first.value = { kind: 'tap', count: 1 }; second.value = { kind: 'spatial', count: 1 }; priority.value = 'normal'; epoch.value++; test.flush(); await sleep(40);
const double = ended(await click('Pair', 2)); assert.equal(double.length, 2); assert.equal(double[0].interval, double[1].interval);
assert.ok(double[1].completion > double[0].completion, 'each native group end has an independent completion sequence');
const target = node('Pair'), stable = snapshot().nodes;
for (const id of [null, true, 0, -1, 1.5, '1', []]) assert.throws(() => test.request('debug.pairTrace', { id }), /Invalid test gesture pair target/);
assert.throws(() => test.request('debug.pairTrace', { id: target.id, extra: true }), /Invalid test gesture pair target/);

for (const props of [{ ...target.props, epoch: true }, { ...target.props, epoch: 0 }, { ...target.props, priority: 'invalid' }, { ...target.props, first: { kind: 'long', count: 1 } }, { ...target.props, second: { kind: 'tap', count: true } }, { ...target.props, first: { kind: 'tap', count: 1, extra: true } }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props }] }), /Invalid test gesture pair/); assert.deepEqual(snapshot().nodes, stable);
}
for (const props of [{ ...target.props, epoch: target.props.epoch - 1 }, { ...target.props, priority: 'high' }, { ...target.props, first: { kind: 'tap', count: 2 } }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props }] }), /require a newer epoch/); assert.deepEqual(snapshot().nodes, stable);
}
read('Pair'); let queued = test.request('debug.tap', { id: target.id, hold: 0.2, command: true });
await until(() => read('Pair').records.some(r => r.phase === 'began'), 'held start');
epoch.value++; test.flush(); await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'held release'); await sleep(40);
const retired = read('Pair'); assert.deepEqual(ended(retired), []); check(await click('Pair'), 1);
// The first fresh click must belong to the newly armed recognizer, while the
// previous double-tap branch would still be waiting. No timeout wait is inserted.
first.value = { kind: 'tap', count: 1 }; second.value = { kind: 'tap', count: 2 }; epoch.value++; test.flush(); await sleep(40);
const pending = await click('Pair', 1, 30); assert.deepEqual(ended(pending), []);
assert.ok(pending.records.some(record => record.phase === 'changed' && record.second !== null), 'a changed value is not a completed branch');
epoch.value++; test.flush(); const fresh = await click('Pair', 1, 650); check(fresh, 1);
const began = fresh.records.find(record => record.phase === 'began'), released = pending.records.find(record => record.phase === 'released');
assert.ok(began.time - released.time < Math.min(0.2, pending.doubleClickInterval / 2), 'fresh input arrives before the old recognition timeout');
assert.equal(Focus.request(captured), true);
second.value = { kind: 'spatial', count: 1 }; epoch.value++; test.flush(); await sleep(40);
read('Pair'); queued = test.request('debug.tap', { id: node('Pair').id, hold: 0.2, command: true });
await until(() => read('Pair').records.some(r => r.phase === 'began'), 'disable start'); disabled.value = true; test.flush();
await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'disabled release'); await sleep(40); assert.deepEqual(ended(read('Pair')), []);
disabled.value = false; test.flush(); await sleep(40); check(await click('Pair'), 1);
for (const label of ['Pair', 'Button', 'Field']) read(label);
for (let i = 0; i < 40; i++) { const q = test.request('debug.tap', { id: node('Pair').id, count: 2, command: true }); await until(() => test.request('debug.tapResult', { id: q.id }).done, 'bounded trace'); await sleep(20); }
assert.equal(snapshot().pairProbeTraceCount, 128); assert.equal(read('Pair').records.length, 128); assert.equal(snapshot().pairProbeOwners, 0);
queued = test.request('debug.tap', { id: node('Pair').id, hold: 0.2, command: true }); await until(() => read('Pair').records.some(r => r.phase === 'began'), 'removal start');
shown.value = false; test.flush(); await until(() => test.request('debug.tapResult', { id: queued.id }).done && snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'held removal');
assert.deepEqual(test.stats(), baseline); assert.equal(snapshot().pairProbeOwners, 0); assert.equal(snapshot().pairProbeTraceCount, 0); assert.equal(snapshot().pairProbeArmOwners, 0); assert.equal(Focus.request(captured), false);
for (let i = 0; i < 20; i++) {
  shown.value = true; epoch.value++; test.flush(); await until(() => node('Pair'), 'fresh owner'); check(await click('Pair'), 1);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'retirement');
  assert.equal(snapshot().pairProbeOwners, 0); assert.equal(snapshot().pairProbeTraceCount, 0); assert.equal(snapshot().pairProbeArmOwners, 0); assert.equal(snapshot().layoutSurfaceCount, surfaces); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().pairProbeTraceCount, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0);
console.log('PASS native pair prototype: actual optional/void/spatial group ends, raw changed values, normal/high/simultaneous controls, held epoch rejection, stable field identity, disable/removal, bounded drain and 20 owner lifetimes; pointer intervals are not group sessions');
}
}
