import assert from 'node:assert/strict';
import { Component, ForEach, State, Text, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), revision = State(0), double = State(false), blocked = State(false), ancestor = State(false), reversed = State(false);
let setups = 0, disposals = 0; const events = [];
const Owner = Component(scope => {
  setups++; const total = scope.state(0); scope.onDispose(() => disposals++);
  return () => { const current = revision.value; return VStack([
    ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Text(id).frame({ width: 220, height: 65 })
      .onTapGesture(() => { total.value++; events.push([id, current]); }, { count: double.value ? 2 : 1 }).disabled(blocked.value)),
    Text(`Total: ${total.value}`),
  ], { spacing: 20 }).disabled(ancestor.value); };
});
const app = runApp({ title: 'JonUI native taps', width: 440, height: 350, content: View(() => shown.value ? Owner() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify(events)}`);
}
const taps = () => snapshot().nodes.filter(n => n.props.tap);
function tapFor(label) { const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n])); return taps().find(n => { let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value === label; }); }
async function click(label, count = 1, expected = true) {
  const node = tapFor(label), before = events.length;
  const { id } = test.request('debug.tap', { id: node.id, count });
  await until(() => test.request('debug.tapResult', { id }).done, 'mouse dispatch');
  if (expected) { await until(() => events.length === before + 1, `tap ${label}`); assert.deepEqual(events.at(-1), [label, revision.value]); }
  else { await sleep(80); assert.equal(events.length, before); }
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; test.flush();
await until(() => taps().length === 2 && test.request('debug.layout').frames.some(f => f.id === taps()[0].id), 'layout');
await click('a'); await click('b');
await until(() => snapshot().nodes.some(n => n.props.value === 'Total: 2'), 'callback State write');
const tokens = taps().map(n => [n.id, n.props.tap]).sort();
revision.value = 1; reversed.value = true; test.flush(); await sleep(40);
assert.deepEqual(taps().map(n => [n.id, n.props.tap]).sort(), tokens); await click('a'); await click('b'); assert.equal(setups, 1);
blocked.value = true; test.flush(); await sleep(40); await click('a', 1, false); blocked.value = false; ancestor.value = true; test.flush(); await sleep(40); await click('b', 1, false);
ancestor.value = false; double.value = true; test.flush(); await sleep(40);
assert.ok(taps().every(n => !tokens.some(([id, token]) => id === n.id && token === n.props.tap)));
await click('a', 1, false); await sleep(600); await click('a', 2); await click('b', 2);
const stable = snapshot().nodes, node = taps()[0];
for (const props of [{ name: 'onTapGesture', count: 1 }, { ...node.props, count: true }, { ...node.props, count: 3 }, { ...node.props, tap: 0 }, { ...node.props, tap: true }, { ...node.props, unknown: true }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...node, props }] }), /tap gesture|Unknown layout option/); assert.deepEqual(snapshot().nodes, stable);
}
shown.value = false; test.flush(); await until(() => snapshot().liveViews === snapshot().nodes.length, 'remove'); assert.deepEqual(test.stats(), baseline);
assert.throws(() => test.request('debug.tap', { id: node.id }), /not laid out/);
double.value = false;
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => taps().length === 2 && test.request('debug.layout').frames.some(f => f.id === taps()[0].id), `layout ${i}`); await click('a');
  shown.value = false; test.flush(); await until(() => snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0);
console.log('PASS taps: actual hidden-window SwiftUI single/double recognition, current keyed handlers, State writes, disabled ancestors, atomic validation and 20 owner lifetimes without activation');
