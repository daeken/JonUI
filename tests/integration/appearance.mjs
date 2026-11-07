import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), reversed = State(false), revision = State(0), presented = State(false), parent = State('parent'), appearCount = State(0);
const ids = Array.from({ length: 60 }, (_, id) => id), events = [], models = new Map();
let setups = 0, disposals = 0, panelSetups = 0, panelDisposals = 0;
const Row = Component((scope, id) => {
  setups++; const text = scope.state(`Row ${id}`); models.set(id, text); let disposed = false;
  scope.onDispose(() => { disposed = true; disposals++; });
  return () => {
    const version = revision.value;
    const record = phase => { assert.equal(disposed, false, 'retired row callback'); events.push({ id, phase, version, value: text.value, availability: Focus.availabilityNamed(`row-${id}`) }); if (phase === 'appear') appearCount.value++; };
    return TextField('Same label', { text: text.binding, focusName: `row-${id}` }).frame({ height: 48 })
      .onAppear(() => record('appear')).onDisappear(() => record('disappear'));
  };
});
const Panel = Component(scope => {
  panelSetups++; const text = scope.state('sheet'); let disposed = false;
  scope.onDispose(() => { disposed = true; panelDisposals++; });
  const record = phase => { assert.equal(disposed, false, 'retired panel callback'); events.push({ id: phase.startsWith('sheet') ? 'sheet' : 'panel', phase, version: revision.value }); };
  return () => ScrollView(LazyVStack([ForEach(reversed.value ? [...ids].reverse() : ids, { id: id => id }, id => Row(id))], { spacing: 4 }))
    .frame({ width: 350, height: 160 }).onAppear(() => record('panel-appear')).onDisappear(() => record('panel-disappear'))
    .sheet({ isPresented: presented.binding, content: TextField('Sheet', { text: text.binding, focusName: 'sheet' }).frame({ width: 320, height: 140 })
      .onAppear(() => record('sheet-appear')).onDisappear(() => record('sheet-disappear')) });
});
const app = runApp({ title: 'JonUI native appearance callbacks', width: 500, height: 330, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
  View(() => Text(`Appearances: ${appearCount.value}`)),
]) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext');
    assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ events: events.slice(-8), stats: test.stats() })}`);
}
const rowEvents = phase => events.filter(e => typeof e.id === 'number' && e.phase === phase);
await until(() => snapshot().hostedControlCount === 1, 'parent mounted'); const baseline = test.stats();
shown.value = true; await until(() => setups === 60 && rowEvents('appear').length > 0 && events.some(e => e.phase === 'panel-appear'), 'native lazy appearance');
assert.ok(new Set(rowEvents('appear').map(e => e.id)).size < 60, 'logical setup is eager while native appearance is lazy');
await until(() => snapshot().nodes.some(n => n.props.value === `Appearances: ${appearCount.value}`), 'appearance callback State writes render normally');
assert.equal(appearCount.value, rowEvents('appear').length);
assert.equal(disposals, 0); assert.equal(Focus.requestNamed('parent'), true);
const descriptors = snapshot().nodes.filter(n => n.props.appearance), tokens = descriptors.map(n => [n.id, n.props.appearance, n.props.name]);
assert.equal(descriptors.length, 124); assert.ok(descriptors.every(n => !('onAppearance' in n.props)));
const first = descriptors[0], stable = snapshot().nodes;
for (const props of [{ name: first.props.name }, { ...first.props, appearance: 0 }, { ...first.props, appearance: true }, { ...first.props, unknown: true }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...first, props }] }), /appearance token|Unknown layout option/); assert.deepEqual(snapshot().nodes, stable);
}
assert.throws(() => test.request('commit', { nodes: [{ ...first, children: [] }] }), /child count/); assert.deepEqual(snapshot().nodes, stable);
const scroll = test.request('debug.layout').scrolls.find(s => s.viewport.height === 160 && s.document.height > 2000); assert.ok(scroll);
revision.value = 1; test.flush(); const before = events.length;
test.request('debug.scroll', { index: scroll.index, x: 0, y: 10000 });
await until(() => events.slice(before).some(e => typeof e.id === 'number' && e.phase === 'appear' && e.id >= 55), 'bottom native rows appear');
await until(() => rowEvents('disappear').length > 0, 'native lazy disappearance');
assert.ok(events.slice(before).filter(e => typeof e.id === 'number').every(e => e.version === 1), 'current handlers replace queued callbacks without changing tokens');
assert.equal(Focus.currentName(), 'parent'); assert.equal(setups, 60); assert.equal(disposals, 0);
test.request('debug.scroll', { index: scroll.index, x: 0, y: 0 });
await until(() => rowEvents('appear').filter(e => e.id === 0 && e.version === 1).length > 0, 'reappearing first row uses current handler');
const original = models.get(0); original.value = '日本 🦊'; reversed.value = true; test.flush(); await sleep(30);
assert.equal(models.get(0), original); assert.equal(models.get(0).value, '日本 🦊'); assert.equal(setups, 60); assert.equal(disposals, 0);
assert.deepEqual(snapshot().nodes.filter(n => n.props.appearance).map(n => [n.id, n.props.appearance, n.props.name]).sort((a,b) => a[0]-b[0]), [...tokens].sort((a,b) => a[0]-b[0]));
presented.value = true; await until(() => test.request('debug.focusContext').sheet && events.some(e => e.phase === 'sheet-appear'), 'sheet appearance');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && events.some(e => e.phase === 'sheet-disappear'), 'sheet disappearance while logically mounted');
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, 'logical retirement');
const count = events.length; await sleep(40); assert.equal(events.length, count, 'late disappearances after logical retirement are discarded');
assert.equal(disposals, 60); assert.deepEqual(test.stats(), baseline);
for (let i = 0; i < 20; i++) {
  const appeared = events.filter(e => e.phase === 'panel-appear').length;
  shown.value = true; await until(() => events.filter(e => e.phase === 'panel-appear').length > appeared && snapshot().hostedControlCount > 1, `appearance mount ${i}`);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, `appearance removal ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 60 * 21); assert.equal(disposals, setups); assert.equal(panelSetups, 21); assert.equal(panelDisposals, panelSetups);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS appearance: actual lazy/sheet appearance and disappearance, eager logical versus lazy native lifetime, exact tokens/current handlers, Unicode keyed identity, native validation, discarded retired events and 20 owner lifetimes');
