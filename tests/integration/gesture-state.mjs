import assert from 'node:assert/strict';
import { LongPressGesture, Component, State, Text, View, runApp, __testing as test } from 'jonui';
const shown = State(false), attached = State(true), selected = State(0), mutation = State('none');
let states, hits = 0, disposals = 0;
const Owner = Component(scope => {
  const ownedStates = [scope.gestureState(), scope.gestureState()]; states = ownedStates;
  scope.onDispose(() => { assert.ok(ownedStates.every(state => !state.value)); disposals++; });
  scope.effect(() => {
    if (!ownedStates[selected.value].value) return;
    if (mutation.value === 'detach') attached.value = false;
    if (mutation.value === 'swap') selected.value = 1 - selected.value;
  });
  return () => {
    const held = ownedStates[selected.value], target = Text(`Press: ${held.value}`).frame({ width: 260, height: 80 }).contentShape('rectangle');
    return attached.value ? target.gesture(LongPressGesture({ pressing: held, minimumDuration: 0.06 }).onEnded(() => { assert.equal(held.value, true); hits++; })) : target;
  };
});
const app = runApp({ title: 'Owned pressing state', width: 400, height: 260, content: View(() => shown.value ? Owner() : Text('removed')) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
const target = () => snapshot().nodes.find(n => n.props.press);
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return;
    await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ stats: test.gestureStats(), nodes: snapshot().nodes })}`);
}
async function hold(change = 'none') {
  mutation.value = change; test.flush(); const node = target(), before = hits;
  await until(() => test.request('debug.layout').frames.some(frame => frame.id === node.id), 'native layout');
  const queued = test.request('debug.tap', { id: node.id, hold: 0.18, command: true });
  if (change !== 'none') {
    await until(() => change === 'detach' ? !target() : target().props.press !== node.props.press, 'old attachment retired');
    assert.ok(states.every(state => !state.value)); assert.ok(snapshot().pointerTimerCount > 0);
  } else await until(() => states[selected.value].value, 'pressing state without observer');
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native release'); await sleep(30);
  assert.ok(states.every(state => !state.value)); assert.equal(hits, before + Number(change === 'none')); assert.equal(snapshot().pointerTimerCount, 0);
  mutation.value = 'none'; test.flush();
}
await until(() => snapshot().nodes.length, 'base'); const baseline = test.stats();
shown.value = true; test.flush(); await until(target, 'owner'); const originalStates = states;
assert.equal(test.gestureStats().active, 2); assert.equal(test.gestureStats().attached, 1);
await hold(); await hold('swap'); await hold(); await hold('detach');
assert.equal(test.gestureStats().attached, 0); assert.equal(test.gestureStats().active, 2); assert.equal(states, originalStates);
attached.value = true; test.flush(); await until(target, 'reattached'); await hold();
shown.value = false; test.flush(); await until(() => test.gestureStats().active === 0 && snapshot().liveViews === snapshot().nodes.length, 'owner removal'); assert.deepEqual(test.stats(), baseline);
for (const state of originalStates) assert.throws(() => state.value, /disposed GestureState/);
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(target, 'fresh owner'); assert.ok(states.every(state => !state.value)); await hold(i % 2 ? 'swap' : 'detach');
  attached.value = true; shown.value = false; test.flush(); await until(() => test.gestureStats().active === 0, 'retirement'); assert.deepEqual(test.stats(), baseline);
}
assert.equal(disposals, 21); test.request('debug.close'); await app;
assert.deepEqual(test.gestureStats(), { active: 0, attached: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0);
console.log('PASS GestureState: real observer-free native pressing, tracked effects, held attachment swap/detachment/reset before release, reattachment, owner guards and 20 lifetimes without activation');
