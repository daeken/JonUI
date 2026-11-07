import assert from 'node:assert/strict';
import { Component, Focus, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), auxiliary = State(false), presented = State(false), width = State(200), count = State(1), priority = State('normal'), revision = State(0), spatial = State(true), insidePadding = State(false);
const models = new Map(), events = []; let setups = 0, disposals = 0;
const Target = Component((scope, label) => {
  setups++; const last = scope.state({ x: 0, y: 0 }), hits = scope.state(0); models.set(label, { last, hits }); scope.onDispose(() => disposals++);
  return () => {
    const current = revision.value, options = { count: count.value, priority: priority.value };
    let content = Text(`${label}: ${last.value.x}, ${last.value.y}`).frame({ width: width.value, height: 80 });
    const padding = { top: 12, leading: 20, bottom: 8, trailing: 10 };
    if (!insidePadding.value) content = content.padding(padding);
    content = content.contentShape('rectangle');
    content = spatial.value ? content.onSpatialTapGesture(point => { assert.ok(Object.isFrozen(point)); last.value = point; hits.value++; events.push({ label, current, point }); }, options) : content.onTapGesture(() => { hits.value++; events.push({ label, current, plain: true }); }, options);
    return insidePadding.value ? content.padding(padding) : content;
  };
});
const Panel = Component(scope => {
  const text = scope.state('日本 🦊');
  return () => VStack([
    Target('main'), TextField('Field', { text: text.binding, focusName: 'field' }).frame({ width: 240, height: 30 }).onSpatialTapGesture(() => {}, { count: count.value, priority: priority.value }),
  ], { spacing: 20 }).sheet({ isPresented: presented.binding, content: Target('sheet') });
});
const app = runApp({ title: 'JonUI local tap snapshots', width: 500, height: 350, content: View(() => shown.value ? Panel() : Text('removed'))
  .window({ isPresented: auxiliary.binding, title: 'Auxiliary', width: 430, height: 280, content: Target('aux') }) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(r => setTimeout(r, ms));
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.value?.startsWith(`${label}: `); });
}
const surface = label => test.request('debug.layoutSurfaces').surfaces.find(s => s.current && s.frames.some(f => f.id === node(label)?.id));
const rect = label => surface(label)?.frames.find(f => f.id === node(label)?.id)?.rect;
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    assert.ok(test.request('debug.windows').windows.every(w => !w.key && w.alpha === 0));
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-5), stats: test.stats() })}`);
}
async function click(label = 'main', at = { x: 0.2, y: 0.3 }) {
  await until(() => rect(label), `layout ${label}`); const bounds = rect(label), before = events.length, hits = models.get(label).hits.value;
  const { id } = test.request('debug.tap', { id: node(label).id, at, count: count.value, command: true });
  await until(() => test.request('debug.tapResult', { id }).done, 'native dispatch'); await until(() => events.length === before + 1, 'spatial callback');
  const event = events.at(-1); assert.equal(event.label, label); assert.equal(event.current, revision.value); assert.equal(models.get(label).hits.value, hits + 1);
  if (spatial.value) { assert.ok(Object.isFrozen(event.point)); assert.ok(Math.abs(event.point.x - bounds.width * at.x) < 0.75, JSON.stringify({ bounds, at, event })); assert.ok(Math.abs(event.point.y - bounds.height * at.y) < 0.75, JSON.stringify({ bounds, at, event })); assert.deepEqual(models.get(label).last.value, event.point); }
  else assert.equal(event.plain, true);
  await sleep(20); assert.equal(events.length, before + 1); return event;
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(), records = snapshot().layoutSurfaceCount; shown.value = true; test.flush();
await until(() => rect('main')?.width === 230 && rect('main').height === 100 && snapshot().hostedControlCount === 1, 'padded target');
const first = node('main'), firstEvent = await click(); assert.deepEqual(firstEvent.point, { x: 46, y: 30 });
assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured);
revision.value = 1; width.value = 260; test.flush(); await until(() => rect('main')?.width === 290, 'resized target'); await click('main', { x: 0.7, y: 0.8 }); assert.equal(node('main').props.tap, first.props.tap); assert.deepEqual(firstEvent.point, { x: 46, y: 30 });
for (const value of ['high', 'simultaneous', 'normal']) { const old = node('main'); priority.value = value; test.flush(); await sleep(40); await click(); assert.notEqual(node('main').props.tap, old.props.tap); assert.equal(Focus.request(captured), true); }
const beforeCount = node('main'); count.value = 2; test.flush(); await sleep(40); await click('main', { x: 0.1, y: 0.6 }); assert.notEqual(node('main').props.tap, beforeCount.props.tap); assert.equal(Focus.request(captured), true);
const beforeMode = node('main'); spatial.value = false; test.flush(); await sleep(40); await click(); assert.notEqual(node('main').props.tap, beforeMode.props.tap); spatial.value = true; test.flush(); await sleep(40); await click();
insidePadding.value = true; test.flush(); await until(() => rect('main')?.width === 260 && rect('main').height === 80, 'gesture before padding'); await click(); insidePadding.value = false; test.flush(); await until(() => rect('main')?.width === 290, 'gesture after padding');
presented.value = true; test.flush(); await until(() => test.request('debug.focusContext').sheet && rect('sheet'), 'sheet'); await click('sheet', { x: 0.7, y: 0.2 }); assert.throws(() => test.request('debug.tap', { id: node('main').id }), /current window/);
presented.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed'); await click();
auxiliary.value = true; test.flush(); await until(() => test.request('debug.windows').windows.length === 1 && rect('aux'), 'auxiliary'); const aux = node('aux'); await click('aux', { x: 0.3, y: 0.7 });
test.request('debug.closeWindow', { id: test.request('debug.windows').windows[0].id }); await until(() => !auxiliary.value && test.request('debug.windows').windows.length === 0, 'auxiliary closed'); assert.throws(() => test.request('debug.tap', { id: aux.id }), /not laid out/);
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length && snapshot().layoutSurfaceCount === records, 'all owners removed'); assert.deepEqual(test.stats(), baseline);
count.value = 1; width.value = 200; priority.value = 'normal';
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => rect('main') && snapshot().hostedControlCount === 1, `mount ${i}`); await click('main', { x: 0.2 + (i % 3) * 0.2, y: 0.4 }); const old = node('main');
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.throws(() => test.request('debug.tap', { id: old.id }), /not laid out/); assert.deepEqual(test.stats(), baseline); assert.equal(snapshot().layoutSurfaceCount, records);
}
assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().layoutSurfaceCount, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS spatial taps: real frozen local point snapshots, sizing/asymmetric-padding/order semantics, resize/current callbacks, count/priority/mode epochs, stable field focus, sheet/root coordinates, native close and 20 owner lifetimes without activation');
