import assert from 'node:assert/strict';
import { Button, Component, State, TapGesture, Text, View, VStack, runApp, __testing as test } from 'jonui';
const a = State(false), b = State(false), hits = State(0), buttonHits = State(0);
const shared = TapGesture().onEnded(() => { hits.value++; }), passive = TapGesture();
let setups = 0, disposals = 0;
const Owner = Component((scope, label) => {
  setups++; scope.onDispose(() => disposals++);
  return () => Text(label).frame({ width: 260, height: 50 }).contentShape('rectangle').gesture(shared);
});
const app = runApp({ title: 'Reusable gesture values', width: 420, height: 350, content: View(() => VStack([
  View(() => a.value ? Owner('A') : Text('no A')), View(() => b.value ? Owner('B') : Text('no B')),
  Button('High passive', () => { buttonHits.value++; }).frame({ width: 260, height: 40 }).gesture(passive, { priority: 'high' }),
  Button('Normal passive', () => { buttonHits.value++; }).frame({ width: 260, height: 40 }).gesture(passive),
  Text(`Hits: ${hits.value} · buttons: ${buttonHits.value}`),
], { spacing: 12 })) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot');
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.title === label || child?.props.value === label; });
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  do { const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.activeKey, false); assert.equal(context.mainKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail('Timed out reusable gesture native lifecycle');
}
async function click(label) {
  await until(() => node(label) && test.request('debug.layout').frames.some(frame => frame.id === node(label).id));
  const queued = test.request('debug.tap', { id: node(label).id, command: true });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done); await sleep(30);
}
await until(() => node('High passive')); const baseline = test.stats();
await click('High passive'); assert.equal(buttonHits.value, 0, 'an action-free high tap still has native precedence');
await click('Normal passive'); assert.equal(buttonHits.value, 1);
for (let i = 0; i < 20; i++) {
  a.value = b.value = true; test.flush(); await until(() => node('A') && node('B'));
  assert.equal(test.stats().actions, baseline.actions + 2); const first = node('A'), second = node('B'); assert.notEqual(first.props.tap, second.props.tap);
  const before = hits.value; await click('A'); await click('B'); assert.equal(hits.value, before + 2);
  a.value = false; test.flush(); await until(() => !node('A'));
  assert.equal(node('B').props.tap, second.props.tap); assert.throws(() => test.request('debug.tap', { id: first.id }), /not laid out/);
  await click('B'); assert.equal(hits.value, before + 3); assert.equal(test.stats().actions, baseline.actions + 1);
  b.value = false; test.flush(); await until(() => snapshot().liveViews === snapshot().nodes.length); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 40); assert.equal(disposals, setups); test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0);
console.log('PASS gesture values: shared immutable descriptions with independent native recognition/tokens, action-free control precedence, current sibling attachment after retirement and 20 owner lifetimes without activation');
