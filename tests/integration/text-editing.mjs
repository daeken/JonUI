import assert from 'node:assert/strict';
import { Component, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(true), enabled = State(true), alternate = State(false), version = State('v1'), reversed = State(false);
const events = []; let plain, secret, note, other, setups = 0, disposals = 0, submits = 0;
const Panel = Component(scope => {
  setups++; plain = scope.state('initial'); secret = scope.state('dummy'); note = scope.state('notes'); other = scope.state('other');
  scope.onDispose(() => { disposals++; });
  return props => VStack([ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
    const state = kind === 'plain' ? plain : kind === 'editor' ? note : alternate.value ? other : secret;
    const options = { text: state.binding, onEditingChanged: enabled.value ? editing => events.push({ kind, editing, version: props.version, value: state.value }) : undefined };
    return kind === 'editor' ? TextEditor({ ...options, monospaced: true }).frame({ height: 100 }) :
      kind === 'secure' ? SecureField('Demo secret', { ...options, onSubmit: () => { submits++; } }) :
      TextField(`Plain (${plain.value.length})`, { ...options, onSubmit: () => { submits++; } });
  })]);
});
const app = runApp({ title: 'JonUI text editing tests', width: 600, height: 350, content: View(() => shown.value ? Panel({ version: version.value }) : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot');
const fields = () => test.request('debug.fields').fields;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ events, counts: test.stats() })}`);
}
const focus = target => assert.equal(test.request('debug.focus', target).accepted, true);
const fieldIndex = secure => fields().find(field => field.secure === secure).index;
const node = kind => snapshot().nodes.find(n => n.kind === kind);
await until(s => s.states.length === 9 && fields().length === 2 && test.request('debug.editors').count === 1, 'real native inputs');
await sleep(30); assert.deepEqual(events, []); assert.equal(test.stats().actions, 5);
const original = node('textfield');
focus({ field: fieldIndex(false) }); await until(() => events.length === 1, 'plain editing begin');
assert.deepEqual(events[0], { kind: 'plain', editing: true, version: 'v1', value: 'initial' });
focus({ field: fieldIndex(false) });
test.request('debug.field', { index: fieldIndex(false), value: 'Hello 🦊 café' });
await until(() => plain.value === 'Hello 🦊 café', 'Unicode field edit');
await sleep(20); assert.equal(events.length, 1, 'typing and duplicate focus are not session transitions');
version.value = 'v2'; reversed.value = true; test.flush(); await sleep(30);
assert.equal(node('textfield').id, original.id); assert.equal(node('textfield').props.editing, original.props.editing);
assert.equal(events.length, 1, 'keyed reordering and handler updates preserve active focus');
focus({ field: fieldIndex(true) }); await until(() => events.length === 3, 'plain end and secure begin');
assert.deepEqual(events.find(e => e.kind === 'plain' && !e.editing), { kind: 'plain', editing: false, version: 'v2', value: 'Hello 🦊 café' });
test.request('debug.field', { index: fieldIndex(true), value: 'dummy-🦊' });
await until(() => secret.value === 'dummy-🦊', 'secure edit');
focus({ editor: 0 }); await until(() => events.length === 5, 'secure end and editor begin');
assert.equal(events.find(e => e.kind === 'secure' && !e.editing).value, 'dummy-🦊');
enabled.value = false; test.flush(); await sleep(20);
assert.equal(test.stats().actions, 2); assert.equal(events.length, 5);
enabled.value = true; test.flush(); await sleep(20);
assert.equal(events.length, 5, 'attaching a handler to an active input does not replay focus');
test.request('debug.editor', { index: 0, value: 'multiline 🦊', newline: true });
await until(() => note.value === 'multiline 🦊\n', 'actual NSTextView edit and Return newline');
await sleep(20); assert.equal(events.length, 5); assert.equal(submits, 0);
note.value = 'programmatic\nvalue'; await sleep(20); assert.equal(events.length, 5);
focus({}); await until(() => events.length === 6, 'editor end');
assert.deepEqual(events.at(-1), { kind: 'editor', editing: false, version: 'v2', value: 'programmatic\nvalue' });
for (const kind of ['plain', 'secure', 'editor']) assert.deepEqual(events.filter(e => e.kind === kind).map(e => e.editing), [true, false]);
let secureNode = node('securefield'); const retired = secureNode.props.editing;
test.request('debug.editing', { id: secureNode.id, editing: true });
enabled.value = false; test.flush(); assert.equal(test.stats().actions, 2);
enabled.value = true; test.flush(); await sleep(20); assert.equal(events.length, 6);
secureNode = node('securefield'); assert.notEqual(secureNode.props.editing, retired);
test.request('debug.editing', { id: secureNode.id, token: retired, editing: false }); await sleep(10); assert.equal(events.length, 6);
const beforeRebind = secureNode.props.editing;
test.request('debug.editing', { id: secureNode.id, editing: true });
alternate.value = true; test.flush(); await sleep(20); assert.equal(events.length, 6);
secureNode = node('securefield'); assert.notEqual(secureNode.props.editing, beforeRebind);
focus({ field: fieldIndex(true) }); await until(() => events.length === 7, 'rebound actual focus');
assert.equal(events.at(-1).value, 'other');
test.request('debug.field', { index: fieldIndex(true), value: 'old native' });
test.request('debug.editing', { id: secureNode.id, editing: false });
other.value = 'newer acknowledgement';
await until(() => events.length === 8, 'editing snapshot revision precedence');
assert.equal(events.at(-1).value, 'newer acknowledgement'); assert.equal(secret.value, 'dummy-🦊');
focus({}); await until(() => events.length === 9, 'rebound focus end');
const unchanged = snapshot().nodes;
for (const kind of ['textfield', 'securefield', 'texteditor']) for (const editing of [true, 0, -1, 1.5, 'token']) {
  const input = node(kind);
  assert.throws(() => test.request('commit', { nodes: [{ ...input, props: { ...input.props, editing } }] }), /editing token/);
  assert.deepEqual(snapshot().nodes, unchanged);
}
const editor = node('texteditor');
assert.throws(() => test.request('commit', { nodes: [{ ...editor, props: { ...editor.props, monospaced: 'yes' } }] }), /monospaced/);
focus({ editor: 0 }); await until(() => events.length === 10, 'editor active before unmount');
test.request('debug.editing', { id: editor.id, editing: false }); shown.value = false; test.flush();
await until(s => s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, 'focused input cleanup');
await sleep(20); assert.equal(events.length, 10, 'removed inputs discard queued and teardown callbacks');
assert.equal(test.stats().actions, 0); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 9 && fields().length === 2 && test.request('debug.editors').count === 1 && test.stats().actions === 5, `editing mount ${i}`);
  focus({ editor: 0 }); await until(() => events.length === 11 + i, `editing focus ${i}`);
  shown.value = false;
  await until(s => s.states.length === 5 && s.liveCells === 5 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, `editing unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS editing callbacks: actual offscreen plain/secure/editor focus, keyed active focus identity, native Unicode/newline edits, current handlers, stale registration/binding events, revision precedence, validation and 20 focused mount/unmount cycles');
