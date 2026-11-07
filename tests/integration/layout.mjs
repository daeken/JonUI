import assert from 'node:assert/strict';
import { Button, Component, ForEach, HStack, ScrollView, Spacer, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const mode = State('geometry'), alignment = State('bottomTrailing'), stackAlignment = State('top'), axes = State('vertical'), reversed = State(false);
let setups = 0, disposals = 0;
const Row = Component((scope, id) => {
  setups++;
  const count = scope.state(0), note = scope.state(`note-${id}`);
  scope.onDispose(() => { disposals++; });
  return () => HStack([TextField(`Note ${id}`, { text: note.binding }), Button(`${id}:${count.value}`, () => { count.value++; })]);
});
const app = runApp({ title: 'JonUI layout/scroll tests', width: 800, height: 800, content: View(() => {
  if (mode.value === 'hidden') return Text('hidden');
  if (mode.value === 'scroll') return ScrollView(VStack([
    ForEachRows(), Spacer({ minLength: 0 }),
  ], { alignment: 'leading', spacing: 4 }).frame({ width: axes.value === 'vertical' ? 220 : 900, height: axes.value === 'horizontal' ? 100 : 900, alignment: 'topLeading' }), {
    axes: axes.value, showsIndicators: axes.value !== 'both',
  }).frame({ width: 240, height: 160 });
  return VStack([
    Text('anchor').frame({ width: 40, height: 20 }).frame({ width: 200, height: 80, alignment: alignment.value }).accessibilityIdentifier('aligned'),
    Text('flex').frame({ minWidth: 10, idealWidth: 100, maxWidth: 'infinity', minHeight: 20, maxHeight: 30, alignment: 'leading' }).frame({ width: 300, height: 50 }).accessibilityIdentifier('flex'),
    HStack([Text('short').frame({ width: 40, height: 20 }), Text('tall').frame({ width: 60, height: 50 })], { alignment: stackAlignment.value, spacing: 7 }).accessibilityIdentifier('stack'),
    Text('padding').frame({ width: 30, height: 10 }).padding({ top: 3, leading: 5, bottom: 7, trailing: 11 }).accessibilityIdentifier('padded'),
    Text('This sentence should retain its full ideal width').fixedSize({ horizontal: true }).frame({ width: 80, height: 30 }).accessibilityIdentifier('fixed'),
    HStack([
      Text('Same intrinsic width for both labels').layoutPriority(1).accessibilityIdentifier('high'),
      Text('Same intrinsic width for both labels').accessibilityIdentifier('low'),
    ], { spacing: 0 }).frame({ width: 240, height: 50 }),
    HStack([Text('a').frame({ width: 20 }), Spacer({ minLength: 40 }), Text('b').frame({ width: 20 })], { spacing: 0 }).frame({ width: 200 }).accessibilityIdentifier('spaced'),
  ], { alignment: 'leading', spacing: 10 }).padding(10);
}) });
// The keyed group remains in one structural position as scroll axes change.
function ForEachRows() { return ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot');
const layout = () => test.request('debug.layout');
const node = (s, id) => s.nodes.find(n => n.id === id);
const identified = (s, name) => s.nodes.find(n => n.props.name === 'accessibilityIdentifier' && n.props.value === name);
const rect = (l, id) => l.frames.find(frame => frame.id === id)?.rect;
const close = (actual, expected) => Math.abs(actual - expected) < 1;
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(), l = layout(); if (predicate(s, l)) return { s, l }; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ snapshot: snapshot(), layout: layout() })}`);
}
let { s, l } = await until((s, l) => identified(s, 'aligned') && rect(l, identified(s, 'aligned').id)?.width === 200, 'fixed geometry');
const outer = node(s, identified(s, 'aligned').children[0]), inner = node(s, outer.children[0]);
let out = rect(l, outer.id), inside = rect(l, inner.id);
assert.equal(out.width, 200); assert.equal(out.height, 80);
assert.equal(inside.width, 40); assert.equal(inside.height, 20);
assert.ok(close(inside.x - out.x, 160) && close(inside.y - out.y, 60), 'bottomTrailing alignment');
alignment.value = 'topLeading';
({ s, l } = await until((s, l) => rect(l, inner.id) && close(rect(l, inner.id).x, rect(l, outer.id).x) && close(rect(l, inner.id).y, rect(l, outer.id).y), 'dynamic topLeading alignment'));
const flexibleOuter = node(s, identified(s, 'flex').children[0]), flexible = node(s, flexibleOuter.children[0]);
assert.equal(rect(l, flexible.id).width, 300); assert.equal(rect(l, flexible.id).height, 30);
const stack = node(s, identified(s, 'stack').children[0]), short = node(s, stack.children[0]), tall = node(s, stack.children[1]);
assert.ok(close(rect(l, short.id).y, rect(l, tall.id).y));
assert.ok(close(rect(l, tall.id).x - rect(l, short.id).x, 47));
stackAlignment.value = 'bottom';
({ s, l } = await until((s, l) => rect(l, short.id) && close(rect(l, short.id).y - rect(l, tall.id).y, 30), 'dynamic HStack bottom alignment'));
const padded = node(s, identified(s, 'padded').children[0]), paddedChild = node(s, padded.children[0]);
assert.equal(rect(l, padded.id).width, 46); assert.equal(rect(l, padded.id).height, 20);
assert.ok(close(rect(l, paddedChild.id).x - rect(l, padded.id).x, 5) && close(rect(l, paddedChild.id).y - rect(l, padded.id).y, 3));
const fixedOuter = node(s, identified(s, 'fixed').children[0]), fixed = node(s, fixedOuter.children[0]);
assert.equal(rect(l, fixedOuter.id).width, 80); assert.ok(rect(l, fixed.id).width > 80);
assert.ok(rect(l, identified(s, 'high').id).width > rect(l, identified(s, 'low').id).width, 'layout priority controls competing proposals');
const spacedOuter = node(s, identified(s, 'spaced').children[0]), spaced = node(s, spacedOuter.children[0]);
assert.ok(rect(l, spaced.children[1]).width >= 40);
// Raw native transactions receive the same boundary validation as public JS calls.
const unchanged = snapshot().nodes;
for (const props of [
  { name: 'frame', width: -1 }, { name: 'frame', width: true }, { name: 'frame', minWidth: 200, maxWidth: 10 },
  { name: 'frame', width: 10, maxHeight: 100 }, { name: 'frame', alignment: 'left' },
  { name: 'padding', points: 10, top: 1 }, { name: 'fixedSize', horizontal: 1 }, { name: 'layoutPriority', value: null },
]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...outer, props }] }));
  assert.deepEqual(snapshot().nodes, unchanged);
}
const root = s.nodes.find(n => !s.nodes.some(parent => parent.children.includes(n.id)));
for (const invalid of [
  { props: { axes: 'diagonal' }, children: [root.id] },
  { props: { axes: 'vertical', showsIndicators: 1 }, children: [root.id] },
  { props: { axes: 'vertical' }, children: [] },
]) {
  assert.throws(() => test.request('commit', { nodes: [{ id: 900000, kind: 'scroll', ...invalid }], root: 900000 }));
  assert.deepEqual(snapshot().nodes, unchanged);
}
mode.value = 'scroll';
({ s, l } = await until((s, l) => s.states.length === 9 && l.scrolls.length === 1 && l.scrolls[0].document.height > 800, 'real vertical native scroll view'));
const scrollID = s.nodes.find(n => n.kind === 'scroll').id;
assert.ok(l.scrolls[0].vertical && !l.scrolls[0].horizontal);
test.request('debug.scroll', { index: 0, x: 0, y: 250 });
await until((s, l) => l.scrolls[0].viewport.y > 100, 'vertical viewport movement');
const aNote = s.states.find(state => state.value === 'note-a').id;
const button = s.nodes.find(n => n.props.title === 'a:0').id;
test.request('debug.write', { id: aNote, value: 'Hello 🦊 café' }); test.request('debug.action', { id: button });
await until(s => s.nodes.some(n => n.props.title === 'a:1'), 'scoped native action inside scroll');
reversed.value = true; axes.value = 'horizontal';
({ s, l } = await until((s, l) => l.scrolls.length === 1 && l.scrolls[0].document.width > 800 && l.scrolls[0].document.height < 200, 'horizontal scroll axes'));
assert.ok(l.scrolls[0].horizontal && !l.scrolls[0].vertical);
assert.equal(s.nodes.find(n => n.kind === 'scroll').id, scrollID);
assert.equal(s.nodes.find(n => n.props.title === 'a:1').id, button); assert.equal(setups, 2);
assert.equal(s.states.find(state => state.id === aNote).value, 'Hello 🦊 café');
test.request('debug.scroll', { index: 0, x: 250, y: 0 });
await until((s, l) => l.scrolls[0].viewport.x > 100, 'horizontal viewport movement');
axes.value = 'both';
({ s, l } = await until((s, l) => l.scrolls.length === 1 && l.scrolls[0].document.height > 800 && !l.scrolls[0].horizontal && !l.scrolls[0].vertical, 'both axes with indicators hidden'));
test.request('debug.scroll', { index: 0, x: 200, y: 200 });
await until((s, l) => l.scrolls[0].viewport.x > 100 && l.scrolls[0].viewport.y > 100, 'two-axis viewport movement');
mode.value = 'hidden';
await until((s, l) => s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && l.scrolls.length === 0, 'scroll and scoped cell teardown');
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  mode.value = 'scroll';
  await until((s, l) => s.states.length === 9 && l.scrolls.length === 1, `scroll mount ${i}`);
  mode.value = 'hidden';
  await until((s, l) => s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && l.scrolls.length === 0, `scroll unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 42); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
console.log('PASS layout: measured fixed/flexible frames, dynamic alignment, edge padding, fixedSize, layoutPriority, real native scroll movement/indicators, keyed Unicode bindings, rejected transactions and 20 scroll mount/unmount cycles');
