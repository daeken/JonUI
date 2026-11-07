import assert from 'node:assert/strict';
import { Component, State, Text, runApp, __testing as test } from 'jonui';
const priority = process.env.JONUI_CASE === 'simultaneous' ? 'simultaneous' : 'normal';
const a = State(false), b = State(false), sheet = State(false), revision = State(0), mutation = State('none');
const events = [], models = new Map(), setups = {}, disposals = {};
const Target = Component((scope, label) => {
  setups[label] = (setups[label] ?? 0) + 1; const hits = scope.state(0), pressing = scope.state(false); models.set(label, { hits, pressing }); let retired = false;
  scope.onDispose(() => { retired = true; disposals[label] = (disposals[label] ?? 0) + 1; });
  return () => { const current = revision.value; return Text(`${label}: ${hits.value}`).frame({ width: 250, height: 90 }).contentShape('rectangle').onLongPressGesture(() => { assert.equal(retired, false); hits.value++; events.push([label, 'perform', current]); }, { priority, minimumDuration: 0.05, maximumDistance: 10, onPressingChanged: value => {
    assert.equal(retired, false); pressing.value = value; events.push([label, value, current]);
    if (value && mutation.value === 'dismiss' && label === 'sheet') sheet.value = false;
    if (value && mutation.value === 'close' && label === 'A') test.request('debug.closeWindow', { id: windows().find(w => w.title === 'A').id });
  } }); };
});
const app = runApp({ title: 'JonUI long press window ownership', width: 430, height: 270, content: Target('main')
  .window({ isPresented: a.binding, title: 'A', width: 390, height: 250, content: Target('A').sheet({ isPresented: sheet.binding, content: Target('sheet') }) })
  .window({ isPresented: b.binding, title: 'B', width: 450, height: 280, content: Target('B') }) });
const sleep = ms => new Promise(r => setTimeout(r, ms)), snapshot = () => test.request('debug.snapshot'), windows = () => test.request('debug.windows').windows;
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.press) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value?.startsWith(`${label}: `); });
}
const ready = label => test.request('debug.layoutSurfaces').surfaces.some(s => s.current && s.frames.some(f => f.id === node(label)?.id));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0); assert.ok(windows().every(w => !w.key && w.alpha === 0));
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-8), windows: windows(), stats: test.stats() })}`);
}
async function hold(label, seconds = 0.12, move) {
  await until(() => ready(label), `layout ${label}`); const before = events.length;
  const { id } = test.request('debug.tap', { id: node(label).id, hold: seconds, ...(move ? { move } : {}), command: true }); await until(() => test.request('debug.tapResult', { id }).done, 'release'); await sleep(30); assert.equal(snapshot().pointerTimerCount, 0); return events.slice(before);
}
const completed = result => assert.deepEqual(result.map(e => e[1]), [true, 'perform', false]);
await until(() => ready('main'), 'main'); const baseline = test.stats(), surfaces = snapshot().layoutSurfaceCount; completed(await hold('main'));
a.value = true; test.flush(); await until(() => windows().some(w => w.title === 'A') && ready('A'), 'A'); const aID = windows().find(w => w.title === 'A').id, first = node('A'); completed(await hold('A')); assert.throws(() => test.request('debug.tap', { id: node('main').id, hold: 0.1 }), /current window/);
b.value = true; test.flush(); await until(() => ready('B'), 'B'); completed(await hold('B')); assert.throws(() => test.request('debug.tap', { id: first.id, hold: 0.1 }), /current window/);
test.request('debug.selectWindow', { id: aID }); revision.value = 1; test.flush(); let result = await hold('A'); assert.ok(result.every(e => e[2] === 1)); assert.equal(node('A').props.press, first.props.press);
assert.deepEqual((await hold('A', 0.015)).map(e => e[1]), [true, false]); assert.deepEqual((await hold('A', 0.12, { x: 35, y: 0, after: 0.01 })).map(e => e[1]), [true, false]);
sheet.value = true; test.flush(); await until(() => test.request('debug.focusContext').sheet && ready('sheet'), 'sheet'); const sheetNode = node('sheet'), sheetModel = models.get('sheet'); completed(await hold('sheet')); assert.throws(() => test.request('debug.tap', { id: first.id, hold: 0.1 }), /current window/);
mutation.value = 'dismiss'; result = await hold('sheet'); mutation.value = 'none'; assert.ok(!result.some(e => e[1] === 'perform'), 'dismissed native sheet must invalidate its pending countdown'); await until(() => !test.request('debug.focusContext').sheet, 'dismissed'); assert.equal(sheetModel.hits.value, 1); assert.equal(disposals.sheet ?? 0, 0);
sheet.value = true; test.flush(); await until(() => ready('sheet'), 'sheet reappeared'); assert.equal(models.get('sheet'), sheetModel); assert.equal(node('sheet').props.press, sheetNode.props.press); completed(await hold('sheet')); sheet.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet, 'sheet closed');
mutation.value = 'close'; result = await hold('A'); mutation.value = 'none'; assert.ok(!result.some(e => e[1] === 'perform')); await until(() => !a.value && !windows().some(w => w.title === 'A') && disposals.A === 1 && disposals.sheet === 1, 'native A close'); assert.throws(() => test.request('debug.tap', { id: first.id, hold: 0.1 }), /not laid out/);
test.request('debug.selectWindow', { id: windows().find(w => w.title === 'B').id }); completed(await hold('B')); b.value = false; test.flush(); await until(() => windows().length === 0 && snapshot().liveViews === snapshot().nodes.length && snapshot().layoutSurfaceCount === surfaces, 'auxiliary cleanup'); assert.deepEqual(test.stats(), baseline); completed(await hold('main'));
for (let i = 0; i < 20; i++) {
  a.value = true; test.flush(); await until(() => ready('A') && windows().some(w => w.title === 'A'), `open ${i}`); assert.equal(models.get('A').hits.value, 0); const current = node('A'); assert.notEqual(current.props.press, first.props.press);
  mutation.value = i % 3 === 2 ? 'close' : 'none'; result = await hold('A', i % 2 ? 0.015 : 0.1); mutation.value = 'none'; if (i % 3 === 2) assert.ok(!result.some(e => e[1] === 'perform')); else assert.deepEqual(result.map(e => e[1]), i % 2 ? [true, false] : [true, 'perform', false]);
  if (a.value) test.request('debug.closeWindow', { id: windows().find(w => w.title === 'A').id }); await until(() => !a.value && windows().length === 0 && snapshot().liveViews === snapshot().nodes.length && snapshot().layoutSurfaceCount === surfaces, `close ${i}`); assert.deepEqual(test.stats(), baseline); assert.equal(snapshot().pointerTimerCount, 0);
}
assert.equal(setups.A, 21); assert.equal(disposals.A, setups.A); assert.equal(disposals.sheet, setups.sheet); assert.equal(disposals.B, setups.B); test.request('debug.close'); await app; assert.deepEqual(disposals, setups); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().pointerTimerCount, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS long press windows: real held recognition/cancel in independent roots and sheets, scoped target routing/current handlers, sheet-disappearance countdown invalidation with retained state, native close while held and 20 owned-root lifetimes without activation');
