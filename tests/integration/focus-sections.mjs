import assert from 'node:assert/strict';
import { Component, Focus, ForEach, HStack, SecureField, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(true), mode = State('flat'), reversed = State(false);
const models = new Map(), entered = []; let active = null, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; for (const id of ['A0', 'A1', 'B0', 'B1']) models.set(id, scope.state(`value-${id}`));
  scope.onDispose(() => { disposals++; });
  return () => {
    if (mode.value === 'empty') return Text('No focusable descendants').focusSection();
    return HStack([
      ForEach(reversed.value ? ['B', 'A'] : ['A', 'B'], { id: id => id }, group => {
        const fields = [0, 1].map(i => {
          const id = `${group}${i}`, model = models.get(id), options = { text: model.binding,
            onEditingChanged: editing => { if (editing) { active = id; entered.push(id); } else if (active === id) active = null; },
          };
          return (group === 'B' ? SecureField : TextField)(`${id} (${model.value.length})`, options).frame({ width: 160, height: 40 });
        });
        const column = VStack(fields, { spacing: 10 });
        return (mode.value === 'grouped' ? column.focusSection() : column).accessibilityIdentifier(`column-${group}`);
      }),
      Text('Passive').focusSection(),
    ], { spacing: 30 });
  };
});
const app = runApp({ title: 'JonUI native focus sections', width: 620, height: 300, content: View(() => shown.value ? Panel() : Text('hidden')) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), layout = () => test.request('debug.layout');
const fields = () => test.request('debug.fields').fields;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(); assert.equal(status().key, false); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), active, entered, counts: test.stats() })}`);
}
async function start(index) {
  Focus.clear(); await until(() => !status().fields.length, 'cleared responder'); active = null;
  test.request('debug.focus', { field: index }); await until(() => active !== null, 'initial native editing callback');
}
async function sequence(expected, backwards = false) {
  for (const id of expected) {
    assert.equal(test.request('debug.tab', { modifiers: backwards ? ['shift'] : [] }).intercepted, false, 'SwiftUI handles native section order');
    await until(() => active === id, `native ${backwards ? 'reverse' : 'forward'} section entry ${id}`);
  }
}
async function startNamed(id) {
  // SwiftUI's cached AppKit subview enumeration can change after remounting.
  // Identify the real responder through its editing callback, not its index.
  for (let i = 0; i < fields().length; i++) { await start(i); if (active === id) return; }
  assert.fail(`No native responder for ${id}`);
}
function columnRect(id) {
  const node = snapshot().nodes.find(n => n.props.name === 'accessibilityIdentifier' && n.props.value === `column-${id}`);
  return layout().frames.find(f => f.id === node?.id)?.rect;
}
await until(s => s.states.length === 7 && fields().length === 4 && columnRect('A'), 'real two-column layout');
const initial = { A: columnRect('A'), B: columnRect('B') }, a0 = models.get('A0');
await start(0); assert.equal(active, 'A0');
await sequence(['B0', 'A1', 'B1', 'A0']);
assert.equal(test.stats().actions, 4);
mode.value = 'grouped'; test.flush();
await until(s => s.nodes.filter(n => n.props.name === 'focusSection').length === 3 && fields().length === 4, 'native focus section wrappers');
assert.equal(models.get('A0'), a0); assert.equal(setups, 1); assert.equal(snapshot().liveCells, 7);
await start(0); assert.equal(active, 'A0');
await sequence(['A1', 'B0', 'B1', 'A0']); await sequence(['B1', 'B0', 'A1', 'A0'], true);
assert.deepEqual({ A: columnRect('A'), B: columnRect('B') }, initial, 'focus grouping has no visual layout effect');
// Capture the concrete responders and verify imperative operations coexist with
// SwiftUI's native sequential grouping.
const targets = {};
for (let i = 0; i < 4; i++) { await start(i); targets[active] = Focus.capture(); assert.ok(targets[active]); }
assert.equal(Focus.request(targets.A0), true); await until(() => active === 'A0', 'captured target in section');
test.request('debug.field', { index: status().fields[0], value: 'Grouped 🦊 café' });
await until(() => a0.value === 'Grouped 🦊 café', 'Unicode input in section');
await sequence(['A1', 'B0', 'B1', 'A0']);
const stableNodes = snapshot().nodes, section = stableNodes.find(n => n.props.name === 'focusSection');
for (const props of [{ name: 'focusSection', enabled: true }, { name: 'focusSection', value: 'group' }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...section, props }] }), /Unknown layout option/);
  assert.deepEqual(snapshot().nodes, stableNodes);
}
for (const children of [[], [section.children[0], section.children[0]]]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...section, children }] }), /child count/);
  assert.deepEqual(snapshot().nodes, stableNodes);
}
reversed.value = true; test.flush(); await sleep(30);
assert.equal(Focus.request(targets.B0), true); await until(() => active === 'B0', 'captured reordered section');
await sequence(['B1', 'A0', 'A1', 'B0']); assert.equal(setups, 1); assert.equal(a0.value, 'Grouped 🦊 café');
// The optional explicit global cycle deliberately controls its own event order.
assert.equal(Focus.setTraversal([targets.A0, targets.B1], { tabNavigation: true }), true);
Focus.request(targets.A0); assert.equal(test.request('debug.tab').intercepted, true); await until(() => active === 'B1', 'explicit cycle spans native sections');
Focus.setTraversal([]); assert.equal(test.request('debug.tab').intercepted, false); await until(() => active === 'A0', 'native section handling resumes');
mode.value = 'empty'; test.flush();
await until(s => s.liveViews === s.nodes.length && fields().length === 0, 'section with no focusable descendants');
Focus.next(); assert.equal(Focus.capture(), null); assert.equal(Focus.request(targets.A0), false);
mode.value = 'grouped'; shown.value = false; test.flush();
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0, 'section owner teardown');
assert.equal(test.stats().actions, 0); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 7 && fields().length === 4, `section mount ${i}`);
  await startNamed('B0'); await sequence(['B1']);
  const saved = Focus.capture(); assert.ok(saved); shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0, `focused section unmount ${i}`);
  assert.equal(Focus.request(saved), false); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 });
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS native focus sections: actual Tab/Shift-Tab grouping versus geometric order, unchanged geometry, Unicode/captured/keyed identity, explicit-cycle interoperability, empty sections, atomic validation and 20 focused mount/unmount cycles');
