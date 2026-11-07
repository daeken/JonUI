import assert from 'node:assert/strict';
import { Component, State, View, Text, TextField, Button, VStack, ForEach, runApp, __testing as test } from 'jonui';
const shown = State(true), reversed = State(false), label = State('first'), mode = State('normal');
const instances = new Map(); let setups = 0, disposals = 0, failedCleanups = 0;
const Counter = Component((scope, initial) => {
  setups++;
  const count = scope.state(0), note = scope.state(`note-${initial.id}`);
  instances.set(initial.id, { count, note });
  scope.onDispose(() => { disposals++; });
  return props => VStack([
    Text(`${props.label}:${initial.id}:${count.value}:${note.value}`),
    TextField('Note', { text: note.binding }),
    Button(`Increment ${initial.id}`, () => { count.value++; }),
  ]);
});
const BadSetup = Component(scope => {
  scope.state(3); scope.onDispose(() => { failedCleanups++; });
  throw new Error('native setup recovery');
});
const BadBody = Component(scope => {
  const text = scope.state('partial'); scope.onDispose(() => { failedCleanups++; });
  return () => VStack([Text(text.value), TextField('Partial', { text: text.binding }), View(() => { throw new Error('native body recovery'); })]);
});
const app = runApp({ title: 'JonUI scoped component tests', width: 650, height: 500,
  content: View(() => {
    if (mode.value === 'setup') return BadSetup();
    if (mode.value === 'body') return BadBody();
    return shown.value ? ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id },
      id => Counter({ id, label: label.value })) : Text('hidden');
  }, { fallback: error => Text(error.message) }),
});
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const current = snapshot(); if (predicate(current)) return current; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify(snapshot())}`);
}
const has = (s, value) => s.nodes.some(n => n.props.value === value);
let native = await until(s => s.windowVisible && s.states.length === 8, 'initial scoped cells');
assert.equal(native.liveCells, 8);
const first = instances.get('a'), oldBinding = first.note.binding.id;
const button = native.nodes.find(n => n.kind === 'button' && n.props.title === 'Increment a').id;
assert.throws(() => test.request('state.release', { ids: [oldBinding] }), /binding is mounted/);
test.request('debug.action', { id: button });
await until(s => has(s, 'first:a:1:note-a'), 'scoped callback');
assert.equal(instances.get('b').count.value, 0);
test.request('debug.write', { id: oldBinding, value: 'Hello 🦊 café' });
await until(s => has(s, 'first:a:1:Hello 🦊 café'), 'scoped native binding');
reversed.value = true; label.value = 'current';
native = await until(s => has(s, 'current:a:1:Hello 🦊 café'), 'current props and keyed reorder');
assert.equal(instances.get('a'), first); assert.equal(setups, 2);
assert.equal(native.nodes.find(n => n.kind === 'button' && n.props.title === 'Increment a').id, button);
// This native edit is already queued when ownership ends. It must be ignored.
test.request('debug.write', { id: oldBinding, value: 'queued stale value' });
shown.value = false;
native = await until(s => s.states.length === 4 && s.liveCells === 4, 'native cell disposal');
assert.equal(test.stats().cells, 4); assert.equal(test.stats().actions, 0);
first.count.value = 900;
test.request('debug.action', { id: button });
await sleep(20); assert.equal(first.count.value, 1);
assert.throws(() => first.note.binding, /unmounted/);
assert.throws(() => test.request('debug.write', { id: oldBinding, value: 'late' }), /Unknown test state/);
for (let i = 0; i < 50; i++) {
  shown.value = true;
  await until(s => s.states.length === 8 && has(s, 'current:a:0:note-a'), `mount ${i}`);
  const id = instances.get('a').note.binding.id;
  test.request('debug.write', { id, value: `queued ${i}` });
  shown.value = false;
  await until(s => s.states.length === 4 && s.liveCells === 4, `dispose ${i}`);
}
assert.equal(setups, 102); assert.equal(disposals, setups);
mode.value = 'setup';
await until(s => has(s, 'native setup recovery') && s.states.length === 4 && s.liveCells === 4, 'failed setup cleanup');
mode.value = 'body';
await until(s => has(s, 'native body recovery') && s.states.length === 4 && s.liveCells === 4, 'failed body cleanup');
assert.equal(failedCleanups, 2);
mode.value = 'normal';
await until(s => has(s, 'hidden'), 'recovery');
console.log('PASS component scopes: current props, keyed local identity, Unicode native bindings, 50 mount/unmount cycles, stale events/actions, setup/body recovery and zero retained scoped native cells');
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
