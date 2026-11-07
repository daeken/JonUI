import assert from 'node:assert/strict';
import { Component, Focus, State, Text, TextField, VStack, runApp, __testing as test } from 'jonui';
const epoch = State(1), priority = State('normal'); let text;
const Owner = Component(scope => {
  text = scope.state('日本 🦊');
  return () => VStack([
    Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle').modifier('testGesturePair', {
      epoch: epoch.value, priority: priority.value, first: { kind: 'spatial', count: 1 }, second: { kind: 'tap', count: 2 },
    }), TextField('Field', { text: text.binding, focusName: 'field' }),
  ], { spacing: 16 });
});
const app = runApp({ title: 'Pair rearm', width: 420, height: 280, content: Owner() });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
const target = () => snapshot().nodes.find(n => n.props.name === 'testGesturePair');
const read = () => test.request('debug.pairTrace', { id: target().id });
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.activeKey, false); assert.equal(c.mainKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end);
  assert.fail(`Timed out ${label}: ${JSON.stringify(snapshot())}`);
}
async function click(x, wait) {
  await until(() => target() && read().armed === epoch.value && test.request('debug.layout').frames.some(frame => frame.id === target().id), 'armed layout');
  const queued = test.request('debug.tap', { id: target().id, command: true, at: { x, y: 0.5 } });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native dispatch');
  await sleep(wait); return read();
}
await until(() => target() && snapshot().hostedControlCount === 1, 'owner'); assert.equal(Focus.requestNamed('field'), true);
const captured = Focus.capture(), original = target().id; assert.ok(captured); let lastCompletion = 0;
for (let i = 0; i < 20; i++) {
  priority.value = ['normal', 'high', 'simultaneous'][i % 3]; epoch.value += i % 2 ? 7 : 2; test.flush(); await sleep(20); read();
  const pending = await click(0.2, 20); assert.equal(pending.records.filter(record => record.phase === 'ended').length, 0);
  const oldReleased = pending.records.find(record => record.phase === 'released'); assert.ok(oldReleased);
  const focusBefore = Focus.currentName(); epoch.value += i % 2 ? 2 : 7; test.flush();
  await until(() => read().armed === epoch.value, 'replacement armed'); assert.equal(Focus.currentName(), focusBefore);
  const result = await click(0.8, 650), began = result.records.find(record => record.phase === 'began');
  assert.ok(began, JSON.stringify(result)); assert.ok(began.time - oldReleased.time < Math.min(0.2, pending.doubleClickInterval / 2), 'no old-timeout wait before fresh input');
  const ends = result.records.filter(record => record.phase === 'ended'); assert.equal(ends.length, 1, JSON.stringify(result));
  assert.equal(ends[0].epoch, epoch.value); assert.equal(ends[0].second, null); assert.equal(ends[0].first.kind, 'spatial');
  assert.ok(Math.abs(ends[0].first.x - 208) < 0.1, 'fresh point must not reuse the retired branch point');
  assert.ok(ends[0].completion > lastCompletion); lastCompletion = ends[0].completion;
  assert.equal(target().id, original); assert.equal(Focus.request(captured), true); assert.equal(text.value, '日本 🦊');
  assert.equal(snapshot().pairProbeArmOwners, 1);
}
for (const mode of ['normal', 'high', 'simultaneous']) {
  priority.value = mode; epoch.value += 2; test.flush(); await until(() => read().armed === epoch.value, 'held arm'); read();
  const queued = test.request('debug.tap', { id: target().id, hold: 0.22, move: { x: 2, y: 0, after: 0.12 }, command: true });
  await until(() => read().records.some(record => record.phase === 'began'), 'held start');
  epoch.value += 2; test.flush(); epoch.value += 7; test.flush();
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'held release'); await sleep(30);
  assert.deepEqual(read().records.filter(record => record.phase === 'ended'), [], 'reconfiguration never adopts the held pointer');
  const result = await click(0.8, 650), ends = result.records.filter(record => record.phase === 'ended'); assert.equal(ends.length, 1, JSON.stringify(result));
  assert.equal(ends[0].epoch, epoch.value); assert.ok(ends[0].completion > lastCompletion); lastCompletion = ends[0].completion;
  assert.equal(Focus.request(captured), true); assert.equal(text.value, '日本 🦊'); assert.equal(snapshot().pointerTimerCount, 0);
}
test.request('debug.close'); await app; assert.equal(snapshot().pairProbeArmOwners, 0); assert.equal(snapshot().pairProbeTraceCount, 0);
assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0);
console.log('PASS pair rearm: twenty rapid pending replacements across priorities/even and odd epoch jumps, immediate fresh points, monotonic native completions and stable field identity without activation');
