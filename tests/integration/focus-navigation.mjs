import assert from 'node:assert/strict';
import { Component, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
assert.throws(Focus.next, /mounted window/);
const shown = State(true), reversed = State(false), events = [], submitted = [];
let plain, secret, note, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; plain = scope.state('name'); secret = scope.state('dummy'); note = scope.state('notes');
  scope.onDispose(() => { disposals++; });
  return () => VStack([ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
    const options = { text: (kind === 'plain' ? plain : kind === 'secure' ? secret : note).binding,
      onEditingChanged: editing => events.push({ kind, editing }),
    };
    return kind === 'editor' ? TextEditor(options).frame({ height: 100 }) : kind === 'secure' ? SecureField('Demo secret', options) :
      TextField(`Name (${plain.value.length})`, { ...options, onSubmit: () => { submitted.push(plain.value); Focus.next(); } });
  })]);
});
const app = runApp({ title: 'JonUI native focus navigation', width: 600, height: 350, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), fields = () => test.request('debug.fields').fields;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fieldIndex = secure => fields().find(f => f.secure === secure).index;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(), f = status(); assert.equal(f.key, false); if (predicate(s, f)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), counts: test.stats(), events })}`);
}
await until(s => s.states.length === 5 && fields().length === 2 && test.request('debug.editors').count === 1, 'actual native controls');
const plainNode = snapshot().nodes.find(n => n.kind === 'textfield');
Focus.next(); await until((s, f) => f.fields[0] === fieldIndex(false), 'next selects initial plain field');
test.request('debug.field', { index: fieldIndex(false), value: 'Focus 🦊 café', submit: true });
await until((s, f) => f.fields[0] === fieldIndex(true) && submitted.length === 1, 'Return advances to secure input');
assert.deepEqual(submitted, ['Focus 🦊 café']);
Focus.next(); await until((s, f) => f.editors[0] === 0, 'next selects multiline editor');
Focus.previous(); await until((s, f) => f.fields[0] === fieldIndex(true), 'previous selects secure field');
Focus.previous(); await until((s, f) => f.fields[0] === fieldIndex(false), 'previous selects plain field');
await until(() => events.some(e => e.kind === 'plain' && e.editing), 'editing notification');
await sleep(30);
const beforeReorder = events.length; reversed.value = true; test.flush(); await sleep(30);
assert.equal(snapshot().nodes.find(n => n.kind === 'textfield').id, plainNode.id);
assert.equal(status().fields[0], fieldIndex(false)); assert.equal(events.length, beforeReorder);
Focus.next(); await until((s, f) => f.editors[0] === 0, 'next follows reordered native key loop');
Focus.previous(); await until((s, f) => f.fields[0] === fieldIndex(false), 'previous wraps reordered native key loop');
for (let i = 0; i < 10; i++) { Focus.next(); Focus.previous(); }
await sleep(30);
assert.equal(status().fields[0], fieldIndex(false)); assert.equal(plain.value, 'Focus 🦊 café');
assert.deepEqual(submitted, ['Focus 🦊 café'], 'traversal does not synthesize submit actions');
Focus.clear(); await until((s, f) => !f.fields.length && !f.editors.length, 'clear removes actual first responder');
assert.throws(() => test.request('focus.move', { direction: 'sideways' }), /Invalid focus direction/);
assert.deepEqual(status().fields, []); assert.deepEqual(status().editors, []);
shown.value = false;
await until(s => s.states.length === 2 && s.liveCells === 2 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, 'focus subtree cleanup');
Focus.next(); Focus.previous(); Focus.clear();
assert.equal(test.stats().actions, 0); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 5 && fields().length === 2 && test.stats().actions === 4, `navigation mount ${i}`);
  Focus.next(); await until((s, f) => f.fields.length || f.editors.length, `navigation focus ${i}`);
  shown.value = false;
  await until(s => s.states.length === 2 && s.liveCells === 2 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, `focused unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
assert.deepEqual(submitted, ['Focus 🦊 café']);
test.request('debug.close'); await app; Focus.next(); Focus.clear();
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS native focus navigation: actual plain/secure/editor next/previous/clear, Return/Unicode ordering, keyed focus identity and reordered traversal, rapid movement, empty controls, invalid direction and 20 focused mount/unmount cycles without keying the window');
