import assert from 'node:assert/strict';
import { Component, ForEach, LazyHGrid, LazyHStack, LazyVGrid, LazyVStack, ScrollView, State, Text, View, runApp, __testing as test } from 'jonui';
const rawMode = process.env.JONUI_CASE || 'vertical-stack', spatial = rawMode.startsWith('spatial-'), mode = rawMode.replace(/^spatial-/, ''), gesture = spatial ? 'onSpatialTapGesture' : 'onTapGesture', horizontal = mode.startsWith('horizontal'), grid = mode.endsWith('grid');
const shown = State(false), ids = State(Array.from({ length: 60 }, (_, id) => id)), revision = State(0), double = State(false);
const models = new Map(), events = []; let setups = 0, disposals = 0;
const Row = Component((scope, id) => {
  const value = scope.state(0); models.set(id, value); setups++; let retired = false;
  scope.onDispose(() => { retired = true; disposals++; });
  return () => { const version = revision.value; return Text(`Row ${id}: ${value.value}`).frame({ width: grid || horizontal ? 110 : 220, height: horizontal ? 60 : 44 }).contentShape('rectangle')
    [gesture](point => { if (spatial) { assert.ok(Object.isFrozen(point)); assert.ok(Math.abs(point.x - (grid || horizontal ? 110 : 220) * 0.1) < 0.75); assert.ok(Math.abs(point.y - (horizontal ? 60 : 44) * 0.5) < 0.75); } assert.equal(retired, false); value.value++; events.push([id, version, value.value]); }, { count: double.value ? 2 : 1 }); };
});
const Rows = Component(() => () => {
  const children = [ForEach(ids.value, { id: id => id }, id => Row(id))];
  const lazy = grid ? horizontal ? LazyHGrid(children, { rows: [{ size: 'fixed', value: 60 }, { size: 'fixed', value: 60 }], spacing: 4 }) : LazyVGrid(children, { columns: [{ size: 'fixed', value: 120 }, { size: 'fixed', value: 120 }], spacing: 4 }) : horizontal ? LazyHStack(children, { spacing: 4 }) : LazyVStack(children, { spacing: 4 });
  return ScrollView(lazy, { axes: horizontal ? 'horizontal' : 'vertical' }).frame({ width: 320, height: 180 });
});
const app = runApp({ title: `JonUI lazy taps ${mode}`, width: 500, height: 350, content: View(() => shown.value ? Rows() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), layout = () => test.request('debug.layout'), sleep = ms => new Promise(r => setTimeout(r, ms));
function tapNode(id) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return typeof child?.props.value === 'string' && child.props.value.startsWith(`Row ${id}: `); });
}
function visible(id) {
  const target = tapNode(id), frames = layout().frames, rect = frames.find(f => f.id === target?.id)?.rect;
  const scroll = snapshot().nodes.find(n => n.kind === 'scroll'), viewport = frames.find(f => f.id === scroll?.id)?.rect;
  return rect && viewport && rect.width > 0 && rect.height > 0 && rect.x + rect.width / 2 > viewport.x && rect.x + rect.width / 2 < viewport.x + viewport.width && rect.y + rect.height / 2 > viewport.y && rect.y + rect.height / 2 < viewport.y + viewport.height;
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-5), stats: test.stats(), layout: layout() })}`);
}
const scroll = end => test.request('debug.scroll', { index: 0, x: horizontal ? end : 0, y: horizontal ? 0 : end });
// Command-clicks are delivered to inactive native scroll descendants; ordinary
// offscreen first-mouse delivery remains a separate manual/platform gap.
async function click(id, count = 1) {
  await until(() => visible(id), `visible ${id}`); const before = events.length, old = models.get(id).value;
  const queued = test.request('debug.tap', { id: tapNode(id).id, count, at: { x: 0.1, y: 0.5 }, command: true });
  assert.equal(queued.modifiers, 1 << 20, 'explicit native Command-click without activation');
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'mouse dispatch');
  await until(() => events.length === before + 1, `recognition ${id}`); assert.deepEqual(events.at(-1), [id, revision.value, old + 1]);
}
function reject(target) { assert.throws(() => test.request('debug.tap', { id: target.id }), /not laid out|outside visible viewport/); }
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(), records = snapshot().layoutSurfaceCount;
shown.value = true; test.flush(); await until(() => setups === 60 && visible(0), 'lazy first row');
const first = tapNode(0), last = tapNode(59), model = models.get(0), token = first.props.tap;
assert.ok(!visible(59)); assert.ok(snapshot().nodes.filter(n => n.props.tap).length > layout().frames.filter(f => snapshot().nodes.find(n => n.id === f.id)?.props.tap).length, 'logical callbacks are eager while native row layout is partial'); reject(last);
await click(0);
// A visible center does not make every point in that row visible.
scroll(horizontal ? 10 : 5);
await until(() => {
  const frames = layout().frames, target = frames.find(f => f.id === first.id)?.rect;
  const viewport = frames.find(f => snapshot().nodes.find(n => n.id === f.id)?.kind === 'scroll')?.rect;
  return visible(0) && target && viewport && (horizontal ? target.x < viewport.x : target.y < viewport.y);
}, 'visible center with clipped edge');
assert.throws(() => test.request('debug.tap', { id: first.id, at: horizontal ? { x: 0.03, y: 0.5 } : { x: 0.1, y: 0.03 } }), /outside visible viewport/);
// Keep part of row 0 realized while its center falls outside the scroll clip,
// but remains within the native window. This must hit the viewport guard.
scroll(horizontal ? 60 : 24);
await until(() => layout().frames.some(f => f.id === first.id) && !visible(0), 'partially clipped first row');
assert.throws(() => test.request('debug.tap', { id: first.id }), /outside visible viewport/);
scroll(1e6); await until(() => visible(59) && !visible(0), 'bottom rows'); reject(first); assert.equal(disposals, 0); assert.equal(models.get(0), model);
revision.value = 1; test.flush(); await click(59); assert.equal(setups, 60); assert.equal(tapNode(0).props.tap, token);
scroll(0); await click(0); assert.equal(model.value, 2); assert.equal(models.get(0), model);
// Keyed reorder moves the same owner to the far end, preserving local State/token.
ids.value = [...ids.value].reverse(); test.flush(); scroll(1e6); await until(() => visible(0), 'reordered first at end');
assert.equal(models.get(0), model); assert.equal(tapNode(0).id, first.id); assert.equal(tapNode(0).props.tap, token); assert.equal(setups, 60); await click(0);
double.value = true; test.flush(); await sleep(30); assert.notEqual(tapNode(0).props.tap, token); await click(0, 2);
scroll(0); await until(() => visible(59) && !visible(0), 'offscreen owner'); const removed = tapNode(0), beforeRemoval = events.length;
ids.value = ids.value.filter(id => id !== 0); test.flush(); await until(() => disposals === 1 && !tapNode(0) && snapshot().liveViews === snapshot().nodes.length, 'offscreen logical removal'); reject(removed); await sleep(60); assert.equal(events.length, beforeRemoval);
shown.value = false; test.flush(); await until(() => disposals === setups && snapshot().liveViews === snapshot().nodes.length && layout().scrolls.length === 0, 'container removal'); assert.deepEqual(test.stats(), baseline); assert.equal(snapshot().layoutSurfaceCount, records);
ids.value = Array.from({ length: 20 }, (_, id) => id); double.value = false; test.flush();
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => visible(0), `mount ${i}`); assert.equal(models.get(0).value, 0); await click(0); scroll(1e6); await click(19);
  const old = tapNode(0); shown.value = false; test.flush(); await until(() => disposals === setups && snapshot().liveViews === snapshot().nodes.length && layout().scrolls.length === 0, `remove ${i}`); reject(old); assert.deepEqual(test.stats(), baseline); assert.equal(snapshot().layoutSurfaceCount, records);
}
assert.equal(setups, 460); assert.equal(disposals, setups); test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().layoutSurfaceCount, 0);
console.log(`PASS lazy ${gesture} ${mode}: real rectangular-margin single/double Command-click recognition after scroll, partial native realization, viewport rejection, current keyed handlers/local State, offscreen removal and 20 owner lifetimes without activation`);
