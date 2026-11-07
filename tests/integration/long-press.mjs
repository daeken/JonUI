import assert from 'node:assert/strict';
import { LongPressGesture, Component, Focus, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const initialPriority = process.env.JONUI_CASE === 'simultaneous' ? 'simultaneous' : 'normal';
const priority = State(initialPriority);
const shown = State(false), duration = State(0.06), distance = State(10), observed = State(true), revision = State(0), disabled = State(false), mutation = State('none');
const events = []; let model, setups = 0, disposals = 0;
const Owner = Component(scope => {
  setups++; const pressing = scope.gestureState(), hits = scope.state(0), text = scope.state('日本 🦊'); model = { pressing, hits, text }; scope.onDispose(() => { assert.equal(pressing.value, false); disposals++; });
  return () => {
    const current = revision.value;
    return VStack([
      Text(`Hold: ${hits.value} · ${pressing.value ? 'held' : 'idle'}`).frame({ width: 260, height: 80 }).contentShape('rectangle').gesture(LongPressGesture({ pressing, minimumDuration: duration.value, maximumDistance: distance.value, ...(observed.value ? { onPressingChanged: value => {
          assert.equal(pressing.value, value); events.push({ kind: value, current, at: Date.now() });
          if (value && mutation.value === 'revision') revision.value++;
          if (value && mutation.value === 'priority') priority.value = priority.value === 'normal' ? 'simultaneous' : 'normal';
          if (value && mutation.value === 'duration') duration.value = 0.4;
          if (value && mutation.value === 'observer') observed.value = false;
          if (value && mutation.value === 'remove') shown.value = false;
          if (value && mutation.value === 'disable') disabled.value = true;
        } } : {}) }).onEnded(recognized => { assert.equal(recognized, true); hits.value++; events.push({ kind: 'perform', current, at: Date.now() }); }), { priority: priority.value }),
      TextField('Field', { text: text.binding, focusName: 'field' }).frame({ width: 240, height: 30 }).gesture(LongPressGesture({ minimumDuration: duration.value, maximumDistance: distance.value }).onEnded(() => {}), { priority: priority.value }),
    ], { spacing: 16 }).disabled(disabled.value);
  };
});
const app = runApp({ title: 'JonUI native long press', width: 460, height: 300, content: View(() => shown.value ? Owner() : Text('removed')) });
const sleep = ms => new Promise(r => setTimeout(r, ms)), snapshot = () => test.request('debug.snapshot');
function node() {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.press) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value?.startsWith('Hold: '); });
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-10), stats: test.stats() })}`);
}
async function hold(seconds = 0.14, move) {
  await until(() => node() && test.request('debug.layout').frames.some(f => f.id === node().id), 'target layout');
  const before = events.length, target = node(); const { id } = test.request('debug.tap', { id: target.id, hold: seconds, ...(move ? { move } : {}), command: true });
  if (['duration', 'observer', 'priority'].includes(mutation.value)) {
    await until(() => node()?.props.press !== target.props.press, 'held configuration retired');
    assert.equal(model.pressing.value, false); assert.ok(snapshot().pointerTimerCount > 0, 'reset precedes release');
  }
  await until(() => test.request('debug.tapResult', { id }).done, 'held event release'); await sleep(40);
  assert.equal(snapshot().pointerTimerCount, 0); return events.slice(before);
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 1 && node(), 'owner');
let result = await hold(0.015); assert.deepEqual(result.map(e => e.kind), [true, false]); assert.equal(model.hits.value, 0); assert.equal(model.pressing.value, false);
result = await hold(); assert.deepEqual(result.map(e => e.kind), [true, 'perform', false]); assert.ok(result[1].at - result[0].at >= 40); assert.ok(result[2].at - result[1].at >= 20); assert.equal(model.hits.value, 1);
result = await hold(0.14, { x: 40, y: 0, after: 0.015 }); assert.deepEqual(result.map(e => e.kind), [true, false]); assert.equal(model.hits.value, 1); assert.equal(model.pressing.value, false);
result = await hold(0.14, { x: 2, y: 0, after: 0.015 }); assert.deepEqual(result.map(e => e.kind), [true, 'perform', false]);
assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured); const first = node(); mutation.value = 'revision';
result = await hold(); mutation.value = 'none'; assert.deepEqual(result.map(e => [e.kind, e.current]), [[true, 0], ['perform', 1], [false, 1]]); assert.equal(node().props.press, first.props.press); assert.equal(Focus.request(captured), true);
for (const change of ['duration', 'observer', 'priority']) {
  const old = node(); mutation.value = change; result = await hold(); mutation.value = 'none'; assert.ok(!result.some(e => e.kind === 'perform')); assert.notEqual(node().props.press, old.props.press); assert.equal(Focus.request(captured), true);
  duration.value = 0.06; priority.value = initialPriority; test.flush(); await sleep(40);
  if (change === 'observer') { result = await hold(); assert.deepEqual(result.map(e => e.kind), ['perform']); }
  observed.value = true; test.flush(); await sleep(40); result = await hold(); assert.deepEqual(result.map(e => e.kind), [true, 'perform', false]);
}
duration.value = 0; distance.value = 0; test.flush(); await sleep(40); result = await hold(0.02); assert.deepEqual(result.map(e => e.kind), [true, 'perform', false]); duration.value = 0.06; distance.value = 10; test.flush(); await sleep(40);
disabled.value = true; test.flush(); await sleep(40); result = await hold(); assert.deepEqual(result, []); disabled.value = false; test.flush(); await sleep(40);
mutation.value = 'disable'; result = await hold(); mutation.value = 'none'; assert.deepEqual(result.map(e => e.kind), [true, false]); assert.equal(model.pressing.value, false); disabled.value = false; test.flush(); await sleep(40);
const stable = snapshot().nodes, target = node();
for (const props of [{ ...target.props, minimumDuration: -1 }, { ...target.props, maximumDistance: true }, { ...target.props, observesPressing: 1 }, { ...target.props, press: 0 }, { ...target.props, tracksPressing: 1 }, { ...target.props, tracksPressing: true, observesPressing: false }, { ...target.props, extra: true }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props }] }), /Invalid long press|Unknown layout option/); assert.deepEqual(snapshot().nodes, stable);
}
for (const hold of [null, true, -1, 6]) assert.throws(() => test.request('debug.tap', { id: target.id, hold }), /Invalid test hold/);
for (const move of [null, [], {}, { x: 1, y: 0, after: 0.2 }, { x: true, y: 0, after: 0.01 }]) assert.throws(() => test.request('debug.tap', { id: target.id, hold: 0.1, move }), /Invalid test hold movement/);
mutation.value = 'remove'; result = await hold(); mutation.value = 'none'; assert.ok(!result.some(e => e.kind === 'perform')); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'held owner retired'); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0); assert.equal(Focus.request(captured), false);
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 1 && node(), `mount ${i}`); result = await hold(i % 2 ? 0.015 : 0.12); assert.deepEqual(result.map(e => e.kind), i % 2 ? [true, false] : [true, 'perform', false]);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0); assert.equal(snapshot().pointerTimerCount, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().pointerTimerCount, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS long press ' + initialPriority + ': real held recognition/early release/distance cancellation, native phase timing and State, current handlers, config/observer epochs, stable field focus, disabling/removal while held, atomic validation and 20 owner lifetimes without activation');
