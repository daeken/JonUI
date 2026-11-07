import assert from 'node:assert/strict';
import { Component, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(true), reversed = State(false), extra = State(false);
let plain, note, setups = 0, disposals = 0, submits = 0;
const Panel = Component(scope => {
  setups++; plain = scope.state('name'); const secret = scope.state('dummy'); note = scope.state('notes');
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
      const options = { text: (kind === 'plain' ? plain : kind === 'secure' ? secret : note).binding };
      return kind === 'editor' ? TextEditor(options).frame({ height: 100 }) : kind === 'secure' ? SecureField('Demo secret', options) :
        TextField(`Name (${plain.value.length})`, { ...options, onSubmit: () => { submits++; } });
    }), ...(extra.value ? [Text('Structural change')] : []),
  ]);
});
const app = runApp({ title: 'JonUI window-local Tab cycle', width: 600, height: 350, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), fields = () => test.request('debug.fields').fields;
const status = () => test.request('debug.focusStatus'), cycle = () => test.request('debug.focusTraversal');
const index = secure => fields().find(f => f.secure === secure).index;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(); assert.equal(status().key, false); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), cycle: cycle(), counts: test.stats() })}`);
}
function captureControls() {
  test.request('debug.focus', { field: index(false) }); const name = Focus.capture();
  test.request('debug.focus', { field: index(true) }); const secret = Focus.capture();
  test.request('debug.focus', { editor: 0 }); const notes = Focus.capture();
  assert.ok(name && secret && notes); return { name, secret, notes };
}
function tab(modifiers = [], keyUp = false) {
  const result = test.request('debug.tab', { modifiers, keyUp }); assert.equal(status().key, false); return result.intercepted;
}
await until(s => s.states.length === 6 && fields().length === 2 && test.request('debug.editors').count === 1, 'actual native controls');
const saved = captureControls(), order = [saved.name, saved.notes, saved.secret];
assert.equal(Focus.setTraversal(order, { tabNavigation: true }), true);
Focus.clear(); assert.equal(tab(), true); assert.equal(status().fields[0], index(false));
assert.equal(tab(), true); assert.deepEqual(status().editors, [0], 'Tab follows custom order into the NSTextView');
assert.equal(tab(), true); assert.equal(status().fields[0], index(true), 'Tab leaves multiline input without inserting a character');
assert.equal(tab(), true); assert.equal(status().fields[0], index(false), 'forward wrap');
assert.equal(tab(['shift']), true); assert.equal(status().fields[0], index(true), 'Shift-Tab reverse wrap');
Focus.clear(); assert.equal(tab(['shift']), true); assert.equal(status().fields[0], index(true), 'reverse entry from cleared focus');
await sleep(20); assert.equal(note.value, 'notes'); assert.equal(submits, 0);
Focus.request(saved.name); test.request('debug.field', { index: index(false), value: 'Tab 🦊 café' });
await until(() => plain.value === 'Tab 🦊 café', 'Unicode native input');
reversed.value = true; test.flush(); await sleep(30);
assert.deepEqual(cycle(), { count: 3, tabNavigation: true });
Focus.request(saved.name); assert.equal(tab(), true); assert.deepEqual(status().editors, [0], 'keyed reorder preserves custom Tab order');
for (const modifiers of [['option'], ['control'], ['command']]) {
  Focus.request(saved.notes); assert.equal(tab(modifiers), false, 'modifier shortcuts pass to native handling');
}
Focus.request(saved.notes); assert.equal(tab([], true), false, 'key-up is not consumed');
assert.equal(test.request('debug.markedText', { value: 'IME candidate' }).marked, true);
assert.equal(tab(), false, 'marked text keeps input-method Tab handling');
Focus.request(saved.notes); assert.equal(test.request('debug.markedText').marked, false);
assert.equal(tab(), true); assert.equal(status().fields[0], index(true), 'routing resumes after composition ends');
for (const tabNavigation of [1, 0, 'true', null, {}, []]) {
  assert.throws(() => test.request('focus.traversal', { targets: [], tabNavigation }), /tabNavigation flag/);
  assert.deepEqual(cycle(), { count: 3, tabNavigation: true });
}
assert.deepEqual(test.request('focus.traversal', { targets: [999999], tabNavigation: false }), { configured: false });
assert.deepEqual(cycle(), { count: 3, tabNavigation: true }, 'failed configuration preserves routing mode');
assert.equal(Focus.setTraversal(order), true); assert.deepEqual(cycle(), { count: 3, tabNavigation: false });
Focus.request(saved.notes); test.request('debug.editor', { index: 0, value: 'native tabs' });
await until(() => note.value === 'native tabs', 'reset native editor value');
assert.equal(tab(), false, 'command-only configuration restores default key handling');
await until(() => note.value.includes('\t'), 'native multiline Tab insertion resumes');
Focus.setTraversal(order, { tabNavigation: true }); Focus.clear(); tab(); assert.equal(status().fields[0], index(false));
assert.equal(Focus.setTraversal([], { tabNavigation: true }), true); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
Focus.request(saved.notes); assert.equal(tab(), false, 'empty cycle never traps Tab');
Focus.setTraversal(order, { tabNavigation: true }); test.request('debug.field', { index: index(false), enabled: false });
Focus.request(saved.notes); assert.equal(tab(), false, 'unavailable member falls through to native key handling');
assert.deepEqual(cycle(), { count: 0, tabNavigation: false }); test.request('debug.field', { index: index(false), enabled: true });
Focus.setTraversal(order, { tabNavigation: true }); extra.value = true; test.flush();
await until(() => cycle().count === 0, 'structural capture retirement clears Tab mode');
assert.equal(cycle().tabNavigation, false); assert.equal(Focus.setTraversal(order, { tabNavigation: true }), false);
extra.value = false; shown.value = false; test.flush();
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, 'Tab subtree teardown');
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 6 && fields().length === 2 && test.request('debug.editors').count === 1, `Tab mount ${i}`);
  const targets = captureControls(); assert.equal(Focus.setTraversal([targets.notes, targets.name, targets.secret], { tabNavigation: true }), true);
  Focus.clear(); assert.equal(tab(), true); assert.deepEqual(status().editors, [0]);
  assert.equal(tab(['shift']), true); assert.equal(status().fields[0], index(true));
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, `Tab unmount ${i}`);
  assert.deepEqual(cycle(), { count: 0, tabNavigation: false }); assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 });
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(Focus.setTraversal([], { tabNavigation: true }), false);
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS window-local Tab: actual NSEvent dispatch, forward/reverse/clear and multiline focus, Unicode/reorder, modifiers/key-up/marked-text bypass, atomic mode changes, unavailable/structural fallback and 20 non-key focused mount/unmount cycles');
