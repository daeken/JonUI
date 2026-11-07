import assert from 'node:assert/strict';
import { Button, Component, ForEach, LazyHGrid, LazyVGrid, ScrollView, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const horizontal = process.env.JONUI_CASE === 'horizontal';
const ids = State(Array.from({ length: 80 }, (_, i) => i)), shown = State(true), spacing = State(10);
const tracks = State([{ size: 'fixed', value: horizontal ? 50 : 80, spacing: 8 }, { size: 'flexible', min: 40 }]);
const extent = State(horizontal ? 220 : 320), fill = State(true);
const instances = new Map(); let setups = 0, disposals = 0;
const Cell = Component((scope, id) => {
  setups++; const note = scope.state(`note-${id}`), count = scope.state(0); instances.set(id, { note, count });
  scope.onDispose(() => { disposals++; });
  return () => {
    let body = VStack([TextField(`Note ${id}`, { text: note.binding }), Button(`${id}:${count.value}`, () => { count.value++; })]);
    body = !fill.value ? body.frame({ width: 20, height: 20 }) : horizontal ?
      body.frame({ width: 120 }).frame({ minHeight: 0, maxHeight: 'infinity' }) :
      body.frame({ height: 50 }).frame({ minWidth: 0, maxWidth: 'infinity' });
    return body.accessibilityIdentifier(`cell-${id}`);
  };
});
const Cells = Component(() => () => View(() => ForEach(ids.value, { id: id => id }, id => Cell(id))));
const app = runApp({ title: `JonUI lazy ${horizontal ? 'horizontal' : 'vertical'} grid`, width: 500, height: 400,
  content: View(() => shown.value ? ScrollView(horizontal ?
    LazyHGrid([Cells()], { rows: tracks.value, alignment: 'top', spacing: spacing.value }) :
    LazyVGrid([Cells()], { columns: tracks.value, alignment: 'leading', spacing: spacing.value }), {
      axes: horizontal ? 'horizontal' : 'vertical',
    }).frame({ width: horizontal ? 320 : extent.value, height: horizontal ? extent.value : 220 }) : Text('hidden')),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot'), layout = () => test.request('debug.layout');
const fields = () => test.request('debug.fields').fields;
const cell = (s, id) => s.nodes.find(n => n.props.name === 'accessibilityIdentifier' && n.props.value === `cell-${id}`);
const rect = (l, id) => l.frames.find(f => f.id === id)?.rect;
const crossSize = r => horizontal ? r.height : r.width, crossPos = r => horizontal ? r.y : r.x, mainPos = r => horizontal ? r.x : r.y;
const close = (a, b) => Math.abs(a - b) < 1;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(), l = layout(); if (predicate(s, l)) return { s, l }; await sleep(10); } while (Date.now() < deadline);
  const s = snapshot(); throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), liveCells: s.liveCells, liveViews: s.liveViews, nodes: s.nodes.length, fields: fields().length, layout: layout() })}`);
}
const scroll = end => test.request('debug.scroll', { index: 0, x: horizontal ? end : 0, y: horizontal ? 0 : end });
let { s, l } = await until((s, l) => s.states.length === 166 && cell(s, 2) && rect(l, cell(s, 2).id), 'real keyed grid cells');
const first = cell(s, 0), second = cell(s, 1), third = cell(s, 2), last = cell(s, 79);
let a = rect(l, first.id), b = rect(l, second.id), c = rect(l, third.id);
assert.ok(fields().length > 0 && fields().length < 30, 'partial realization of 80 native text controls');
assert.ok(!rect(l, last.id)); assert.equal(setups, 80); assert.equal(disposals, 0);
assert.ok(close(crossSize(a), horizontal ? 50 : 80));
assert.ok(close(crossSize(b), horizontal ? 162 : 232));
assert.ok(close(crossPos(b) - crossPos(a), (horizontal ? 50 : 80) + 8));
assert.ok(close(mainPos(b), mainPos(a)) && close(mainPos(c) - mainPos(a), horizontal ? 130 : 60));
const model = instances.get(0), noteID = model.note.binding.id, buttonID = s.nodes.find(n => n.props.title === '0:0').id;
test.request('debug.field', { index: 0, value: 'Grid 🦊 café' }); test.request('debug.action', { id: buttonID });
await until(s => model.note.value === 'Grid 🦊 café' && s.nodes.some(n => n.props.title === '0:1'), 'actual grid text delegate and scoped action');
tracks.value = [{ size: 'fixed', value: horizontal ? 80 : 120, spacing: 12 }, { size: 'flexible', min: 40 }]; spacing.value = 14; test.flush();
({ s, l } = await until((s, l) => {
  const a = rect(l, first.id), b = rect(l, second.id), c = rect(l, third.id);
  return a && b && c && close(crossSize(a), horizontal ? 80 : 120) && close(crossSize(b), horizontal ? 128 : 188) && close(mainPos(c) - mainPos(a), horizontal ? 134 : 64);
}, 'dynamic fixed/flexible tracks and grid spacing'));
tracks.value = [{ size: 'flexible', min: 40, max: 90, spacing: 8 }, { size: 'fixed', value: 60 }]; test.flush();
({ s, l } = await until((s, l) => {
  const a = rect(l, first.id), b = rect(l, second.id);
  return a && b && close(crossSize(a), 90) && close(crossSize(b), 60);
}, 'finite flexible maximum caps native track expansion'));
const grid = s.nodes.find(n => n.kind === (horizontal ? 'lazyhgrid' : 'lazyvgrid')), unchanged = s.nodes;
for (const bad of [undefined, [], [null], [{ size: 'fixed' }], [{ size: 'fixed', value: true }], [{ size: 'fixed', value: -1 }],
  [{ size: 'fixed', value: 10, min: 0 }], [{ size: 'flexible', min: null }], [{ size: 'flexible', max: false }],
  [{ size: 'flexible', min: 20, max: 10 }], [{ size: 'adaptive' }], [{ size: 'adaptive', min: 0 }],
  [{ size: 'adaptive', min: 20, max: 'maximum' }], [{ size: 'flexible', alignment: 'left' }], [{ size: 'flexible', spacing: -1 }],
  [{ size: 'fixed', value: 10, unknown: true }], [{ size: 'unknown' }],
]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...grid, props: { ...grid.props, tracks: bad } }] }));
  assert.deepEqual(snapshot().nodes, unchanged);
}
for (const props of [{ ...grid.props, spacing: -1 }, { ...grid.props, spacing: true }, { ...grid.props, alignment: horizontal ? 'leading' : 'top' }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...grid, props }] })); assert.deepEqual(snapshot().nodes, unchanged);
}
// Adaptive packing changes the number of cells in each native row/column.
tracks.value = [{ size: 'adaptive', min: 90, max: 150, spacing: 10 }]; spacing.value = 10; test.flush();
({ s, l } = await until((s, l) => {
  const a = rect(l, first.id), b = rect(l, second.id), c = rect(l, third.id);
  return a && b && c && close(crossSize(a), horizontal ? 105 : 100) && close(crossSize(b), horizontal ? 105 : 100) && close(mainPos(c) - mainPos(a), horizontal ? 130 : 0);
}, 'adaptive native track packing'));
extent.value = horizontal ? 320 : 220; test.flush();
await until((s, l) => {
  const a = rect(l, first.id), c = rect(l, third.id);
  return a && c && close(crossSize(a), horizontal ? 100 : 105) && close(mainPos(c) - mainPos(a), horizontal ? 0 : 60);
}, 'adaptive repacking after viewport resize');
assert.equal(instances.get(0), model); assert.equal(model.note.value, 'Grid 🦊 café'); assert.equal(setups, 80);
scroll(1e6);
await until((s, l) => rect(l, last.id) && (horizontal ? l.scrolls[0].viewport.x : l.scrolls[0].viewport.y) > 1000, 'native grid scroll realizes the last keyed cell');
assert.ok(fields().length < 40); assert.equal(disposals, 0);
ids.value = [...ids.value].reverse(); test.flush();
await until(s => cell(s, 0).id === first.id && s.nodes.find(n => n.props.title === '0:1').id === buttonID, 'keyed reorder after track/viewport changes');
scroll(0); await until((s, l) => rect(l, last.id) && (horizontal ? l.scrolls[0].viewport.x : l.scrolls[0].viewport.y) === 0, 'reordered viewport start');
ids.value = ids.value.filter(id => id !== 0); test.flush();
await until(s => s.states.length === 164 && s.liveCells === 164 && s.liveViews === s.nodes.length, 'offscreen grid cell deletion');
assert.equal(disposals, 1); assert.equal(test.stats().actions, 79);
assert.throws(() => test.request('debug.write', { id: noteID, value: 'late' }), /Unknown test state/);
test.request('debug.action', { id: buttonID }); await sleep(10); assert.equal(model.count.value, 1);
ids.value = []; test.flush();
await until(s => s.states.length === 6 && s.liveCells === 6 && s.liveViews === s.nodes.length, 'empty grid releases logical cells/views');
assert.equal(disposals, 80); assert.equal(test.stats().actions, 0);
const emptyStates = snapshot().states;
if (fields().length) test.request('debug.field', { index: 0, value: 'obsolete grid adapter' });
await sleep(10); assert.deepEqual(snapshot().states, emptyStates);
// Track alignment places a small cell inside each cross-axis slot.
fill.value = false; ids.value = [0, 1]; extent.value = horizontal ? 220 : 320;
tracks.value = [{ size: 'fixed', value: horizontal ? 80 : 100, spacing: 8, alignment: 'topLeading' }, { size: 'fixed', value: horizontal ? 100 : 120, alignment: 'bottomTrailing' }]; test.flush();
await until((s, l) => {
  const a = rect(l, cell(s, 0)?.id), b = rect(l, cell(s, 1)?.id);
  return a && b && close(crossSize(a), 20) && close(crossSize(b), 20) && close(crossPos(b) - crossPos(a), horizontal ? 168 : 208);
}, 'per-track native alignment');
shown.value = false;
await until((s, l) => s.states.length === 6 && s.liveCells === 6 && s.liveViews === s.nodes.length && fields().length === 0 && l.scrolls.length === 0, 'grid removes cached controls');
const baseline = test.stats(); ids.value = [0, 1, 2, 3]; fill.value = true; test.flush();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 14 && fields().length > 0 && test.stats().actions === 4, `grid mount ${i}`);
  scroll(1e6); await sleep(10); shown.value = false;
  await until((s, l) => s.states.length === 6 && s.liveCells === 6 && s.liveViews === s.nodes.length && fields().length === 0 && l.scrolls.length === 0, `grid unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 162); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log(`PASS lazy ${horizontal ? 'horizontal' : 'vertical'} grid: actual partial realization, measured fixed/flexible/adaptive tracks, viewport repacking, gaps/alignment, Unicode keyed state/action identity, atomic invalid-track rejection, offscreen deletion, stale adapters and 20 mount/unmount cycles`);
