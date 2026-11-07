import assert from 'node:assert/strict';
import { LongPressGesture, Component, ForEach, LazyHGrid, LazyHStack, LazyVGrid, LazyVStack, ScrollView, State, Text, View, runApp, __testing as test } from 'jonui';
const rawMode = process.env.JONUI_CASE || 'vertical-stack', priority = rawMode.startsWith('simultaneous-') ? 'simultaneous' : 'normal';
const mode = rawMode.replace(/^simultaneous-/, ''), horizontal = mode.startsWith('horizontal'), grid = mode.endsWith('grid');
const shown = State(false), ids = State(Array.from({ length: 60 }, (_, id) => id)), revision = State(0), mutation = State('none');
const models = new Map(), events = []; let setups = 0, disposals = 0;
const scroll = end => test.request('debug.scroll', { index: 0, x: horizontal ? end : 0, y: horizontal ? 0 : end });
const Row = Component((scope, id) => {
  setups++; const hits = scope.state(0), pressing = scope.gestureState(); models.set(id, { hits, pressing }); let retired = false; scope.onDispose(() => { assert.equal(pressing.value, false); retired = true; disposals++; });
  return () => { const current = revision.value; return Text(`Row ${id}: ${hits.value} ${pressing.value ? 'held' : 'idle'}`).frame({ width: grid || horizontal ? 110 : 220, height: horizontal ? 60 : 44 }).contentShape('rectangle').gesture(LongPressGesture({ pressing, minimumDuration: 0.05, maximumDistance: 10, onPressingChanged: value => {
      assert.equal(retired, false); assert.equal(pressing.value, value); events.push([id, value, current]);
      if (value && mutation.value === 'scroll') scroll(1e6);
      if (value && mutation.value === 'remove') ids.value = ids.value.filter(value => value !== id);
    } }).onEnded(() => { assert.equal(retired, false); hits.value++; events.push([id, 'perform', current]); }), { priority: priority }); };
});
const Rows = Component(() => () => {
  const children = [ForEach(ids.value, { id: id => id }, id => Row(id))];
  const lazy = grid ? horizontal ? LazyHGrid(children, { rows: [{ size: 'fixed', value: 60 }, { size: 'fixed', value: 60 }], spacing: 4 }) : LazyVGrid(children, { columns: [{ size: 'fixed', value: 120 }, { size: 'fixed', value: 120 }], spacing: 4 }) : horizontal ? LazyHStack(children, { spacing: 4 }) : LazyVStack(children, { spacing: 4 });
  return ScrollView(lazy, { axes: horizontal ? 'horizontal' : 'vertical' }).frame({ width: 320, height: 180 });
});
const app = runApp({ title: `JonUI lazy long press ${mode}`, width: 500, height: 350, content: View(() => shown.value ? Rows() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), layout = () => test.request('debug.layout'), sleep = ms => new Promise(r => setTimeout(r, ms));
function node(id) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.press) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value?.startsWith(`Row ${id}: `); });
}
function visible(id) {
  const frames = layout().frames, target = frames.find(f => f.id === node(id)?.id)?.rect, viewport = frames.find(f => snapshot().nodes.find(n => n.id === f.id)?.kind === 'scroll')?.rect;
  return target && viewport && target.x + target.width * 0.1 > viewport.x && target.x + target.width * 0.1 < viewport.x + viewport.width && target.y + target.height / 2 > viewport.y && target.y + target.height / 2 < viewport.y + viewport.height;
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-8), layout: layout(), stats: test.stats() })}`);
}
async function hold(id, seconds = 0.12, move) {
  await until(() => visible(id), `visible ${id}`); const before = events.length;
  const queued = test.request('debug.tap', { id: node(id).id, hold: seconds, ...(move ? { move } : {}), at: { x: 0.1, y: 0.5 }, command: true });
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native release'); await sleep(30); assert.equal(snapshot().pointerTimerCount, 0); return events.slice(before);
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(), surfaces = snapshot().layoutSurfaceCount; shown.value = true; test.flush(); await until(() => setups === 60 && visible(0), 'partial native realization');
const first = node(0), model = models.get(0); assert.ok(!visible(59));
let result = await hold(0); assert.deepEqual(result.map(e => e[1]), [true, 'perform', false]);
mutation.value = 'scroll'; result = await hold(0); mutation.value = 'none'; assert.ok(!result.some(e => e[1] === 'perform'), 'an unrealized native row must cancel its old countdown'); await until(() => visible(59) && !layout().frames.some(f => f.id === first.id), 'first row unrealized'); assert.equal(model.hits.value, 1); assert.equal(disposals, 0); assert.equal(model.pressing.value, false);
assert.throws(() => test.request('debug.tap', { id: first.id, hold: 0.1 }), /not laid out|outside visible viewport/);
revision.value = 1; test.flush(); result = await hold(59); assert.deepEqual(result, [[59, true, 1], [59, 'perform', 1], [59, false, 1]]);
scroll(0); await until(() => visible(0), 'first row returns'); assert.equal(models.get(0), model); assert.equal(node(0).props.press, first.props.press); result = await hold(0); assert.deepEqual(result.map(e => e[1]), [true, 'perform', false]); assert.equal(model.hits.value, 2); assert.equal(model.pressing.value, false);
result = await hold(0, 0.015); assert.deepEqual(result.map(e => e[1]), [true, false]); result = await hold(0, 0.12, { x: 30, y: 0, after: 0.01 }); assert.deepEqual(result.map(e => e[1]), [true, false]);
mutation.value = 'remove'; result = await hold(0); mutation.value = 'none'; assert.ok(!result.some(e => e[1] === 'perform')); await until(() => disposals === 1 && !node(0), 'held logical row removed');
shown.value = false; test.flush(); await until(() => disposals === setups && layout().scrolls.length === 0 && snapshot().liveViews === snapshot().nodes.length, 'owner retired'); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0); assert.equal(snapshot().layoutSurfaceCount, surfaces);
ids.value = Array.from({ length: 20 }, (_, id) => id); test.flush();
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => visible(0), `mount ${i}`); assert.equal(models.get(0).hits.value, 0);
  mutation.value = 'scroll'; result = await hold(0); mutation.value = 'none'; assert.ok(!result.some(e => e[1] === 'perform')); await until(() => visible(19), 'scrolled end'); result = await hold(19, i % 2 ? 0.015 : 0.1); assert.deepEqual(result.map(e => e[1]), i % 2 ? [true, false] : [true, 'perform', false]);
  shown.value = false; test.flush(); await until(() => disposals === setups && layout().scrolls.length === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0); assert.equal(snapshot().pointerTimerCount, 0); assert.equal(snapshot().layoutSurfaceCount, surfaces);
}
assert.equal(setups, 460); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().pointerTimerCount, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log(`PASS lazy long press ${mode}: actual held recognition/cancel after scrolling, native-disappearance countdown invalidation, retained local state/token and fresh reappearance, early release/movement, held removal and 20 owner lifetimes without activation`);
