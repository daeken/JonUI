import assert from 'node:assert/strict';
import { Component, Focus, ForEach, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), shape = State('rectangle'), shaped = State(false), beforeFrame = State(false), reversed = State(false), revision = State(0), blocked = State(false);
const events = [], models = new Map(); let setups = 0, disposals = 0, field;
const Row = Component((scope, id) => {
  setups++; const count = scope.state(0); models.set(id, count); scope.onDispose(() => disposals++);
  return () => {
    const current = revision.value; let content = Text(`${id}: ${count.value}`);
    if (shaped.value && beforeFrame.value) content = content.contentShape(shape.value);
    content = content.frame({ width: 260, height: 100 });
    if (shaped.value && !beforeFrame.value) content = content.contentShape(shape.value);
    return content.onTapGesture(() => { count.value++; events.push([id, current, count.value]); });
  };
});
const Panel = Component(scope => {
  field = scope.state('日本 🦊');
  return () => VStack([
    ForEach(reversed.value ? ['B', 'A'] : ['A', 'B'], { id: id => id }, id => Row(id)),
    TextField('Field', { text: field.binding, focusName: 'field' }).frame({ width: 260, height: 30 }).contentShape(shape.value),
  ], { spacing: 16 }).disabled(blocked.value);
});
const app = runApp({ title: 'JonUI interaction shapes', width: 480, height: 420, content: View(() => shown.value ? Panel() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(r => setTimeout(r, ms));
function node(id = 'A') {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value?.startsWith(`${id}: `); });
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-5), stats: test.stats() })}`);
}
const rect = id => test.request('debug.layout').frames.find(f => f.id === node(id)?.id)?.rect;
async function click(at = { x: 0.5, y: 0.5 }, expected = true, label = 'A') {
  const target = node(label); await until(() => rect(label), 'target layout'); const old = models.get(label).value, count = events.length;
  const { id } = test.request('debug.tap', { id: target.id, at, command: true }); await until(() => test.request('debug.tapResult', { id }).done, 'native dispatch');
  if (expected) { await until(() => events.length === count + 1, 'native shape recognition'); assert.deepEqual(events.at(-1), [label, revision.value, old + 1]); }
  await sleep(40); assert.equal(events.length, count + (expected ? 1 : 0)); assert.equal(models.get(label).value, old + (expected ? 1 : 0));
}
const margin = { x: 0.1, y: 0.5 }, corner = { x: 0.05, y: 0.1 };
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; test.flush(); await until(() => node() && rect('A') && snapshot().hostedControlCount === 1, 'panel');
await click(); await click(margin, false); await click(corner, false);
shaped.value = true; test.flush(); await sleep(40); await click(margin); await click(corner);
assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured); const model = models.get('A'), original = node(), geometry = rect('A');
for (const value of ['circle', 'ellipse', 'capsule', 'rectangle']) {
  shape.value = value; test.flush(); await sleep(40); await click(); await click(corner, value === 'rectangle'); await click(margin, value !== 'circle');
  assert.deepEqual(rect('A'), geometry, 'interaction shape does not change layout'); assert.equal(Focus.request(captured), true, 'native field identity survives shape updates'); assert.equal(field.value, '日本 🦊'); assert.equal(node().id, original.id); assert.equal(node().props.tap, original.props.tap); assert.equal(models.get('A'), model); assert.equal(setups, 2);
}
revision.value = 1; reversed.value = true; test.flush(); await sleep(40); await click(corner); await click(margin, true, 'B'); assert.equal(node().id, original.id); assert.equal(node().props.tap, original.props.tap); assert.equal(models.get('A'), model);
beforeFrame.value = true; test.flush(); await sleep(40); await click(margin, false); await click(); beforeFrame.value = false; test.flush(); await sleep(40); await click(margin);
blocked.value = true; test.flush(); await sleep(40); await click(corner, false); blocked.value = false; test.flush(); await sleep(40);
const stable = snapshot().nodes, modifier = stable.find(n => n.props.name === 'contentShape');
for (const value of [undefined, null, true, 1, '', 'path', {}, []]) { assert.throws(() => test.request('commit', { nodes: [{ ...modifier, props: { ...modifier.props, shape: value } }] }), /Invalid interaction shape/); assert.deepEqual(snapshot().nodes, stable); }
assert.throws(() => test.request('commit', { nodes: [{ ...modifier, props: { ...modifier.props, kind: 'dragPreview' } }] }), /Unknown layout option/); assert.deepEqual(snapshot().nodes, stable);
for (const at of [null, true, [], {}, { x: 0.5 }, { x: true, y: 0.5 }, { x: -0.1, y: 0.5 }, { x: 0.5, y: 1.1 }, { x: 0.5, y: 0.5, z: 0 }]) assert.throws(() => test.request('debug.tap', { id: node().id, at }), /Invalid test tap point/);
await click(corner); const old = node(); shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'retirement'); assert.deepEqual(test.stats(), baseline); assert.equal(Focus.request(captured), false); assert.throws(() => test.request('debug.tap', { id: old.id, at: corner }), /not laid out/);
for (let i = 0; i < 20; i++) {
  shape.value = ['rectangle', 'circle', 'ellipse', 'capsule'][i % 4]; shown.value = true; test.flush(); await until(() => node() && rect('A') && snapshot().hostedControlCount === 1, `mount ${i}`); assert.equal(models.get('A').value, 0); await click(); await click(corner, shape.value === 'rectangle');
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 42); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().layoutSurfaceCount, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS content shapes: real native margin/corner recognition for rectangle/circle/ellipse/capsule, modifier order, unchanged geometry/current keyed state/tokens, stable field focus, disabled ancestors, atomic validation and 20 owner lifetimes without activation');
