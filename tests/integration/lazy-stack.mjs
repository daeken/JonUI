import assert from 'node:assert/strict';
import { Button, Component, ForEach, LazyHStack, LazyVStack, ScrollView, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const horizontal = process.env.JONUI_CASE === 'horizontal';
const ids = State(Array.from({ length: 80 }, (_, i) => i)), shown = State(true), spacing = State(4), alignment = State(horizontal ? 'top' : 'leading');
const instances = new Map(); let setups = 0, disposals = 0;
const Row = Component((scope, id) => {
  setups++; const note = scope.state(`note-${id}`), count = scope.state(0); instances.set(id, { note, count });
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    TextField(`Note ${id}`, { text: note.binding }),
    Button(`${id}:${count.value}`, () => { count.value++; }),
  ]).frame({ width: horizontal ? 180 : id % 2 ? 180 : 140, height: id % 2 ? 80 : 60 }).accessibilityIdentifier(`row-${id}`);
});
// Both dynamic and component boundaries must expose their keyed rows directly
// to the native lazy container, while preserving the actual row's handle.
const Rows = Component(() => () => View(() => ForEach(ids.value, { id: id => id }, id => Row(id))));
const stack = horizontal ? LazyHStack : LazyVStack;
const app = runApp({ title: `JonUI lazy ${horizontal ? 'horizontal' : 'vertical'} stack`, width: 500, height: 400,
  content: View(() => shown.value ? ScrollView(stack([Rows()], { spacing: spacing.value, alignment: alignment.value }), {
    axes: horizontal ? 'horizontal' : 'vertical',
  }).frame({ width: 300, height: horizontal ? 120 : 220 }) : Text('hidden')),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot'), layout = () => test.request('debug.layout');
const fields = () => test.request('debug.fields').fields;
const rowNode = (s, id) => s.nodes.find(n => n.props.name === 'accessibilityIdentifier' && n.props.value === `row-${id}`);
const rect = (l, id) => l.frames.find(f => f.id === id)?.rect;
const close = (a, b) => Math.abs(a - b) < 1;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(), l = layout(); if (predicate(s, l)) return { s, l }; await sleep(10); } while (Date.now() < deadline);
  const s = snapshot();
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), liveCells: s.liveCells, liveViews: s.liveViews, nodes: s.nodes.length, fields: fields().length, layout: layout() })}`);
}
const scroll = end => test.request('debug.scroll', { index: 0, x: horizontal ? end : 0, y: horizontal ? 0 : end });
let { s, l } = await until((s, l) => s.states.length === 164 && l.scrolls.length === 1 && rowNode(s, 1) && rect(l, rowNode(s, 1).id), 'first keyed native rows');
const first = rowNode(s, 0), second = rowNode(s, 1), last = rowNode(s, 79);
let a = rect(l, first.id), b = rect(l, second.id);
assert.ok(fields().length > 0 && fields().length < 20, 'real native text controls are realized for a small subset of 80 rows');
assert.ok(!rect(l, last.id), 'last row geometry is not evaluated initially');
assert.ok(close(horizontal ? b.x - a.x : b.y - a.y, horizontal ? 184 : 64));
assert.ok(close(horizontal ? b.y : b.x, horizontal ? a.y : a.x), 'cross-axis start alignment');
assert.equal(setups, 80, 'Node scopes eagerly mount once for all logical items'); assert.equal(disposals, 0);
const rowState = instances.get(0), noteID = rowState.note.binding.id;
const buttonID = s.nodes.find(n => n.props.title === '0:0').id;
test.request('debug.field', { index: 0, value: 'Hello 🦊 café' }); test.request('debug.action', { id: buttonID });
await until(s => rowState.note.value === 'Hello 🦊 café' && s.nodes.some(n => n.props.title === '0:1'), 'real native Unicode edit and scoped action');
spacing.value = 12; alignment.value = horizontal ? 'bottom' : 'trailing'; test.flush();
({ s, l } = await until((s, l) => {
  const a = rect(l, first.id), b = rect(l, second.id);
  return a && b && close(horizontal ? b.x - a.x : b.y - a.y, horizontal ? 192 : 72) && close(horizontal ? a.y + a.height : a.x + a.width, horizontal ? b.y + b.height : b.x + b.width);
}, 'dynamic spacing and cross-axis end alignment'));
const unchanged = s.nodes, lazy = s.nodes.find(n => n.kind === (horizontal ? 'lazyhstack' : 'lazyvstack'));
for (const props of [{ alignment: horizontal ? 'leading' : 'top' }, { spacing: true }, { spacing: null }, { pinnedViews: true }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...lazy, props }] })); assert.deepEqual(snapshot().nodes, unchanged);
}
scroll(1e6);
({ s, l } = await until((s, l) => rect(l, last.id) && (horizontal ? l.scrolls[0].viewport.x : l.scrolls[0].viewport.y) > 1000, 'realized last row after native scroll'));
assert.ok(fields().length < 30, 'scroll does not eagerly create every text control');
assert.equal(instances.get(0), rowState); assert.equal(rowState.note.value, 'Hello 🦊 café'); assert.equal(disposals, 0, 'scrolling is not a component lifetime boundary');
ids.value = [...ids.value].reverse(); test.flush();
await until(s => rowNode(s, 0).id === first.id && s.nodes.find(n => n.props.title === '0:1').id === buttonID, 'keyed reorder retains native handles');
assert.equal(setups, 80); assert.equal(instances.get(0), rowState);
scroll(0);
await until((s, l) => rect(l, last.id) && (horizontal ? l.scrolls[0].viewport.x : l.scrolls[0].viewport.y) === 0, 'scroll back to reordered first row');
// Remove an offscreen row. Its logical state/callbacks must be released even
// though SwiftUI is caching native views at another viewport position.
ids.value = ids.value.filter(id => id !== 0); test.flush();
await until(s => s.states.length === 162 && s.liveCells === 162 && s.liveViews === s.nodes.length, 'offscreen row removal releases native state and view boxes');
assert.equal(disposals, 1); assert.equal(test.stats().actions, 79);
assert.throws(() => test.request('debug.write', { id: noteID, value: 'late' }), /Unknown test state/);
test.request('debug.action', { id: buttonID }); await sleep(10); assert.equal(rowState.count.value, 1);
ids.value = []; test.flush();
await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length, 'empty lazy group releases all logical handles');
assert.equal(disposals, 80); assert.equal(test.stats().actions, 0);
// SwiftUI can cache hidden AppKit adapters until the container is removed. They
// must retain no logical boxes/cells, and their stale bindings must be inert.
const emptyStates = snapshot().states;
if (fields().length) test.request('debug.field', { index: 0, value: 'obsolete adapter write' });
await sleep(10); assert.deepEqual(snapshot().states, emptyStates);
shown.value = false;
await until((s, l) => l.scrolls.length === 0 && s.liveViews === s.nodes.length && fields().length === 0, 'lazy container removes cached AppKit adapters');
const baseline = test.stats(); ids.value = [0, 1, 2, 3]; test.flush();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 12 && fields().length > 0 && test.stats().actions === 4, `lazy mount ${i}`);
  scroll(1e6); await sleep(10);
  shown.value = false;
  await until((s, l) => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && fields().length === 0 && l.scrolls.length === 0, `lazy unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 160); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log(`PASS lazy ${horizontal ? 'horizontal' : 'vertical'} stack: actual partial native realization and scrolling, dynamic spacing/alignment, nested keyed groups, Unicode state/action identity across reorder, offscreen removal, atomic validation and 20 mount/unmount cycles`);
