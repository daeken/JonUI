import assert from 'node:assert/strict';
import { Component, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.setTraversal([]), /mounted window/);
const shown = State(true), reversed = State(false), extra = State(false), editing = [], submitted = [];
let plain, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; plain = scope.state('name'); const secret = scope.state('dummy'), note = scope.state('notes');
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
      const options = { text: (kind === 'plain' ? plain : kind === 'secure' ? secret : note).binding, onEditingChanged: active => editing.push([kind, active]) };
      return kind === 'editor' ? TextEditor(options).frame({ height: 100 }) : kind === 'secure' ? SecureField('Demo secret', options) :
        TextField(`Name (${plain.value.length})`, { ...options, onSubmit: () => { submitted.push(plain.value); Focus.next(); } });
    }), ...(extra.value ? [Text('Unrelated structural addition')] : []),
  ]);
});
const app = runApp({ title: 'JonUI explicit focus command cycle', width: 600, height: 350, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), fields = () => test.request('debug.fields').fields;
const cycle = () => test.request('debug.focusTraversal').count;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const index = secure => fields().find(f => f.secure === secure).index;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(), f = status(); assert.equal(f.key, false); if (predicate(s, f)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), cycle: cycle(), counts: test.stats() })}`);
}
function captureControls() {
  test.request('debug.focus', { field: index(false) }); const name = Focus.capture(), nameID = test.request('focus.capture').target;
  test.request('debug.focus', { field: index(true) }); const secret = Focus.capture();
  test.request('debug.focus', { editor: 0 }); const note = Focus.capture();
  assert.ok(name && secret && note); return { name, secret, note, nameID };
}
await until(s => s.states.length === 6 && fields().length === 2 && test.request('debug.editors').count === 1, 'real native text controls');
const saved = captureControls(), order = [saved.name, saved.note, saved.secret];
assert.equal(Focus.setTraversal(order), true); order.reverse(); assert.equal(cycle(), 3);
Focus.clear(); assert.equal(cycle(), 3); Focus.next(); assert.equal(status().fields[0], index(false));
Focus.next(); assert.deepEqual(status().editors, [0]); Focus.next(); assert.equal(status().fields[0], index(true));
Focus.next(); assert.equal(status().fields[0], index(false), 'forward wrap');
Focus.previous(); assert.equal(status().fields[0], index(true), 'reverse wrap');
Focus.clear(); Focus.previous(); assert.equal(status().fields[0], index(true), 'previous from outside cycle starts at last target');
assert.equal(Focus.request(saved.name), true);
test.request('debug.field', { index: index(false), value: 'Ordered 🦊 café', submit: true });
await until((s, f) => f.editors[0] === 0 && submitted.length === 1, 'Return follows configured order after Unicode synchronization');
assert.deepEqual(submitted, ['Ordered 🦊 café']); assert.equal(cycle(), 3);
// Native availability can change without replacing logical view handles.
test.request('debug.field', { index: index(false), enabled: false });
assert.equal(fields().find(f => !f.secure).enabled, false);
Focus.next(); assert.equal(cycle(), 0, 'unavailable member discards the entire cycle');
assert.equal(Focus.setTraversal([saved.note, saved.secret]), true);
assert.equal(Focus.setTraversal([saved.name]), false); assert.equal(cycle(), 2, 'unavailable candidate leaves a valid prior cycle intact');
Focus.clear(); Focus.next(); assert.deepEqual(status().editors, [0]);
test.request('debug.field', { index: index(false), enabled: true });
assert.equal(Focus.setTraversal([saved.name, saved.note, saved.secret]), true);
reversed.value = true; test.flush(); await sleep(30);
assert.equal(cycle(), 3, 'keyed geometry reorder preserves the configured cycle');
assert.equal(Focus.request(saved.name), true); Focus.next(); assert.deepEqual(status().editors, [0]);
Focus.previous(); assert.equal(status().fields[0], index(false));
for (const targets of [null, [true], [0], [-1], [1.5], ['id'], [null], [saved.nameID, saved.nameID]]) {
  assert.throws(() => test.request('focus.traversal', { targets })); assert.equal(cycle(), 3);
}
assert.deepEqual(test.request('focus.traversal', { targets: [999999] }), { configured: false }); assert.equal(cycle(), 3);
const unchanged = snapshot().nodes, frame = unchanged.find(n => n.props.name === 'frame');
assert.throws(() => test.request('commit', { nodes: [{ ...frame, props: { name: 'frame', height: -1 } }] })); assert.equal(cycle(), 3);
// An unlisted but eligible control enters at the start/end of the custom cycle.
assert.equal(Focus.setTraversal([saved.note, saved.name]), true);
Focus.request(saved.secret); Focus.next(); assert.deepEqual(status().editors, [0]);
Focus.request(saved.secret); Focus.previous(); assert.equal(status().fields[0], index(false));
assert.equal(Focus.setTraversal([saved.note]), true); Focus.clear(); Focus.next(); await sleep(30);
const before = editing.length;
for (let i = 0; i < 10; i++) { Focus.next(); Focus.previous(); }
await sleep(30); assert.deepEqual(status().editors, [0]); assert.equal(editing.length, before, 'one-target cycle preserves the editing session');
assert.equal(Focus.setTraversal([]), true); assert.equal(cycle(), 0);
Focus.request(saved.name); Focus.next(); assert.deepEqual(status().editors, [0], 'empty list restores the reordered native key loop');
Focus.setTraversal([saved.name, saved.secret]); extra.value = true; test.flush();
await until(() => cycle() === 0, 'structural retirement clears cycle');
assert.equal(Focus.setTraversal([saved.name]), false); assert.equal(cycle(), 0);
extra.value = false; shown.value = false; test.flush();
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, 'cycle controls dispose');
assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 }); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 6 && fields().length === 2 && test.request('debug.editors').count === 1, `cycle mount ${i}`);
  const targets = captureControls(); assert.equal(Focus.setTraversal([targets.note, targets.name, targets.secret]), true);
  Focus.clear(); Focus.next(); assert.deepEqual(status().editors, [0]);
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, `cycle unmount ${i}`);
  assert.equal(cycle(), 0); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 });
  assert.equal(Focus.setTraversal([targets.note]), false); assert.equal(cycle(), 0); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(Focus.setTraversal([]), false);
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS explicit focus traversal: actual forward/reverse wrapping, outside/single-target cycles, Return/Unicode order, keyed identity, atomic invalid/stale configuration, native-order reset and 20 configured capture/unmount cycles without keying the window');
