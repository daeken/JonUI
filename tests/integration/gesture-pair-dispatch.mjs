import assert from 'node:assert/strict';
import { Component, State, TapGesture, SpatialTapGesture, Text, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), count = State(1), spatialCount = State(1), priority = State('normal'), revision = State(0), disabled = State(false);
const events = []; let setups = 0, disposals = 0, hits;
const Owner = Component(scope => {
  setups++; hits = scope.state(0); scope.onDispose(() => disposals++);
  return () => { const current = revision.value; return VStack([
    test.gesturePair(Text('Pair').frame({ width: 260, height: 70 }).contentShape('rectangle'), SpatialTapGesture({ count: spatialCount.value }), TapGesture({ count: count.value }), function (value) {
      assert.equal(this, undefined); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.first));
      if (value.second) assert.ok(Object.isFrozen(value.second));
      hits.value++; events.push({ current, value });
    }, { priority: priority.value }), Text(`Hits: ${hits.value}`),
  ]).disabled(disabled.value); };
});
const app = runApp({ title: 'Owned pair dispatch', width: 420, height: 280, content: View(() => shown.value ? Owner() : Text('removed')) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
const target = () => snapshot().nodes.find(n => n.props.dispatch), trace = () => test.request('debug.pairTrace', { id: target().id });
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.activeKey, false); assert.equal(c.mainKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end); assert.fail(`Timed out ${label}: ${JSON.stringify({ events, snapshot: snapshot() })}`);
}
async function ready() { await until(() => target() && test.pairStats().armed === 1 && test.request('debug.layout').frames.some(f => f.id === target().id), 'armed layout'); }
async function click(options = {}, wait = 40) {
  await ready(); const before = events.length, n = target();
  const queued = test.request('debug.tap', { id: n.id, command: true, at: { x: 0.8, y: 0.5 }, ...options });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'release'); await sleep(wait);
  return events.slice(before);
}
const noRetainedDispatch = () => { assert.equal(snapshot().pairDispatchPendingCount, 0); assert.equal(snapshot().pointerTimerCount, 0); };
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats();
shown.value = true; test.flush(); await ready(); const first = target();
const stable = snapshot().nodes;
for (const dispatch of [1, 'true', null]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...first, props: { ...first.props, dispatch } }] }), /Invalid layout boolean/); assert.deepEqual(snapshot().nodes, stable);
}
assert.throws(() => test.request('commit', { nodes: [{ ...first, props: { ...first.props, dispatch: false } }] }), /require a newer epoch/); assert.deepEqual(snapshot().nodes, stable);
assert.deepEqual(test.request('gesturePair.claim', { id: first.id, token: first.props.epoch, arm: 1, completion: 1 }), { accepted: false });
assert.throws(() => test.request('gesturePair.claim', { id: first.id, token: true, arm: 1, completion: 1 }), /Invalid gesture pair claim/);
let result = await click(); assert.equal(result.length, 1); assert.equal(result[0].value.second.kind, 'tap'); assert.ok(Math.abs(result[0].value.first.x - 208) < 0.1);
const terminal = trace().records.find(r => r.phase === 'ended'); assert.ok(terminal.dispatchArm > 0);
assert.deepEqual(test.request('gesturePair.claim', { id: first.id, token: first.props.epoch, arm: terminal.dispatchArm, completion: terminal.completion }), { accepted: false }, 'a consumed native end is single-use'); noRetainedDispatch();
revision.value++; test.flush(); await sleep(20); assert.equal(target().props.epoch, first.props.epoch); result = await click(); assert.equal(result[0].current, 1);
await sleep(600); result = await click({ count: 2 }, 80); assert.equal(result.length, 2, 'two equal-count native ends dispatch independently even within one observer interval');
spatialCount.value = 2; test.flush(); await ready(); result = await click({}, 650); assert.equal(result.length, 1); assert.equal(result[0].value.first, null); assert.equal(result[0].value.second.kind, 'tap');
spatialCount.value = 1; test.flush(); await ready();
for (const mode of ['normal', 'high', 'simultaneous']) {
  priority.value = mode; count.value = 2; test.flush(); await ready(); trace();
  result = await click({}, 650); assert.equal(result.length, 1); assert.equal(result[0].value.second, null); assert.equal(result[0].value.first.kind, 'spatial');
  result = await click({ count: 2 }, 80); assert.equal(result.length, 1); assert.equal(result[0].value.second.kind, 'tap'); noRetainedDispatch();
  await sleep(600); const before = events.length; await click({}, 10); assert.equal(events.length, before);
  const old = target(); count.value = 1; test.flush(); await ready(); assert.notEqual(target().props.epoch, old.props.epoch);
  result = await click({}, 650); assert.equal(result.length, 1); assert.equal(events.length, before + 1, 'retired pending group must not dispatch');
  count.value = 2; test.flush(); await ready(); trace();
  const held = test.request('debug.tap', { id: target().id, hold: 0.2, command: true });
  await until(() => trace().records.some(r => r.phase === 'began'), 'held begin'); const prior = events.length;
  count.value = 1; test.flush(); await until(() => test.request('debug.tapResult', { id: held.id }).done, 'retired release'); await sleep(650);
  assert.equal(events.length, prior); assert.equal((await click()).length, 1); noRetainedDispatch();
}
disabled.value = true; test.flush(); await sleep(30); const before = events.length;
const ignored = test.request('debug.tap', { id: target().id, command: true }); await until(() => test.request('debug.tapResult', { id: ignored.id }).done, 'disabled input'); await sleep(80); assert.equal(events.length, before);
disabled.value = false; test.flush(); await ready(); assert.equal((await click()).length, 1);
shown.value = false; test.flush(); await until(() => !target() && snapshot().liveViews === snapshot().nodes.length, 'retirement'); assert.deepEqual(test.stats(), baseline);
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await ready(); assert.equal(hits.value, 0); assert.equal((await click()).length, 1);
  shown.value = false; test.flush(); await until(() => !target() && snapshot().liveViews === snapshot().nodes.length, 'owner removal');
  assert.deepEqual(test.stats(), baseline); assert.deepEqual(test.pairStats(), { active: 0, armed: 0 }); assert.equal(snapshot().pairDispatchArmOwners, 0); noRetainedDispatch();
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app;
assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().pairDispatchArmOwners, 0); noRetainedDispatch();
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS owned pair dispatch: frozen tagged partial/full native ends, single-use native claims, current handlers, priority/config/held retirement, disabled boundaries and twenty owner lifetimes without activation');
