import assert from 'node:assert/strict';
import { Component, Form, SecureField, State, Text, TextField, View, runApp, __testing as test } from 'jonui';
const shown = State(true), enabled = State(true), alternate = State(false), label = State('v1');
let plain, secret, other, setups = 0, disposals = 0;
const events = [];
const Panel = Component(scope => {
  setups++; plain = scope.state('initial'); secret = scope.state(''); other = scope.state('alternate');
  scope.onDispose(() => { disposals++; });
  return props => {
    const active = alternate.value ? other : secret;
    return Form([
      TextField(`Name (${plain.value.length})`, { text: plain.binding, onSubmit: enabled.value ? () => events.push({ kind: 'plain', label: props.label, value: plain.value }) : undefined }),
      SecureField('Demo secret', { text: active.binding, onSubmit: enabled.value ? () => events.push({ kind: 'secure', label: props.label, length: active.value.length }) : undefined }),
      View(() => Text(`Name:${plain.value};secret-length:${active.value.length}`)),
    ], { style: 'grouped' });
  };
});
const app = runApp({ title: 'JonUI secure text/submit tests', width: 650, height: 400,
  content: View(() => shown.value ? Panel({ label: label.value }) : Text('hidden')),
});
const snapshot = () => test.request('debug.snapshot');
const fields = () => test.request('debug.fields').fields;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), fields: fields() })}`);
}
let native = await until(s => s.states.length === 7 && fields().length === 2, 'real plain and secure AppKit text controls');
assert.equal(fields().filter(field => field.secure).length, 1); assert.ok(fields().every(field => field.hasAction));
let plainNode = native.nodes.find(node => node.kind === 'textfield'), secureNode = native.nodes.find(node => node.kind === 'securefield');
const originalToken = secureNode.props.submit;
assert.equal(test.stats().actions, 2);
test.request('debug.field', { index: fields().find(field => !field.secure).index, value: 'Hello 🦊 café', submit: true });
await until(() => events.length === 1, 'native text delegate and Return action');
assert.deepEqual(events[0], { kind: 'plain', label: 'v1', value: 'Hello 🦊 café' });
assert.equal(snapshot().nodes.find(node => node.id === plainNode.id).props.submit, plainNode.props.submit, 'state-triggered handler updates keep token');
const dummy = 'sample-only-🦊';
test.request('debug.field', { index: fields().find(field => field.secure).index, value: dummy, submit: true });
await until(() => events.length === 2, 'native secure delegate and Return action');
assert.equal(secret.value, dummy); assert.deepEqual(events[1], { kind: 'secure', label: 'v1', length: dummy.length });
label.value = 'v2'; test.flush();
assert.equal(snapshot().nodes.find(node => node.id === secureNode.id).props.submit, originalToken);
test.request('debug.submit', { id: secureNode.id });
await until(() => events.length === 3, 'updated current submit handler'); assert.equal(events[2].label, 'v2');
test.request('debug.submit', { id: secureNode.id });
enabled.value = false; test.flush(); enabled.value = true; test.flush();
await sleep(20); assert.equal(events.length, 3, 'queued event for removed registration is discarded');
secureNode = snapshot().nodes.find(node => node.kind === 'securefield');
assert.notEqual(secureNode.props.submit, originalToken); assert.equal(test.stats().actions, 2);
test.request('debug.submit', { id: secureNode.id, token: originalToken }); await sleep(10); assert.equal(events.length, 3);
test.request('debug.submit', { id: secureNode.id });
await until(() => events.length === 4, 'renewed registration works');
const previousToken = secureNode.props.submit;
test.request('debug.submit', { id: secureNode.id }); alternate.value = true; test.flush();
await sleep(20); assert.equal(events.length, 4, 'queued event for old binding is discarded');
secureNode = snapshot().nodes.find(node => node.kind === 'securefield');
assert.notEqual(secureNode.props.submit, previousToken); assert.equal(secureNode.props.state, other.binding.id);
const rebound = 'rebound-dummy';
test.request('debug.field', { index: fields().find(field => field.secure).index, value: rebound, submit: true });
await until(() => events.length === 5, 'real secure input uses rebound cell/registration');
assert.equal(other.value, rebound); assert.equal(secret.value, dummy); assert.equal(events[4].length, rebound.length);
// A newer acknowledged JS write wins over both the queued edit and its submit snapshot.
test.request('debug.field', { index: fields().find(field => field.secure).index, value: 'older-dummy', submit: true });
other.value = 'newer JS acknowledgement';
await until(() => events.length === 6, 'submit snapshot revision ordering');
assert.equal(events[5].length, other.value.length); assert.equal(other.value, 'newer JS acknowledgement');
enabled.value = false; test.flush(); await sleep(20);
assert.equal(test.stats().actions, 0);
test.request('debug.field', { index: fields().find(field => field.secure).index, value: 'no-handler-dummy', submit: true });
await until(() => other.value === 'no-handler-dummy', 'editing works without a submit registration');
assert.equal(events.length, 6);
enabled.value = true; test.flush(); await sleep(10);
const unchanged = snapshot().nodes;
secureNode = unchanged.find(node => node.kind === 'securefield');
for (const submit of [true, 0, -1, 1.5, 'token']) {
  assert.throws(() => test.request('commit', { nodes: [{ ...secureNode, props: { ...secureNode.props, submit } }] }), /submit token/);
  assert.deepEqual(snapshot().nodes, unchanged);
}
assert.throws(() => { other.value = 42; }, /Invalid binding value/);
test.request('debug.submit', { id: secureNode.id }); shown.value = false; test.flush();
await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && fields().length === 0, 'secure input and callback cleanup');
assert.equal(events.length, 6); assert.equal(test.stats().actions, 0);
assert.throws(() => test.request('debug.submit', { id: secureNode.id }), /Unknown text input/);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 7 && fields().length === 2 && test.stats().actions === 2, `text mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && fields().length === 0, `text unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS text submit: actual secure/plain AppKit controls and delegate/Return actions, Unicode mirror ordering, latest handlers, stale registration/binding events, revision precedence, token validation and 20 mount/unmount cycles');
