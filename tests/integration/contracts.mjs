import assert from 'node:assert/strict';
import { State, View, VStack, Text, Button, runApp, __testing as test } from 'jonui';
const value = State('initial'), ticks = State(0);
let bodies = 0, stops = 0;
const timer = setInterval(() => { ticks.value++; }, 10);
const app = runApp({ title: 'JonUI contract test', width: 500, height: 300,
  content: VStack([
    View(() => { bodies++; if (process.env.JONUI_CASE === 'body-error' && value.value === 'changed') throw new Error('intentional reactive body failure'); return Text(value.value); }),
    View(() => Text(String(ticks.value))),
    Button('Fail action', () => { throw new Error('intentional action failure'); }),
  ]),
  onStop() { stops++; clearInterval(timer); console.log("STOP_HOOK"); },
});
const mode = process.env.JONUI_CASE;
if (mode === 'action-error') {
  const button = test.request('debug.snapshot').nodes.find(n => n.kind === 'button');
  test.request('debug.action', { id: button.id });
} else if (mode === 'body-error') {
  value.value = 'changed';
} else if (mode === 'overflow') {
  for (let i = 0; i < 5000; i++) test.request('debug.write', { id: value.binding.id, value: String(i) });
} else if (mode === 'timer-error') {
  value.value = 'changed';
  // Throw from a real Node event-loop callback; bootstrap must clean up the app.
  setTimeout(() => { throw new Error('intentional timer failure'); }, 30);
} else {
  // Queue an older native edit, then acknowledge a newer JS write before Node
  // receives that queued event. The mirror must not roll back.
  const id = value.binding.id;
  const initial = test.request('debug.snapshot');
  const root = initial.nodes.find(n => n.kind === 'vstack');
  assert.throws(() => test.request('commit', { nodes: [{ ...root, children: [root.id] }] }), /Cyclic/);
  assert.throws(() => test.request('commit', { nodes: [{ ...root, children: [-1] }] }), /Unknown child/);
  assert.throws(() => test.request('commit', { nodes: [{ id: 900000, kind: 'toggle', props: { title: 'Missing binding' }, children: [] }], root: 900000 }), /binding handle/);
  assert.deepEqual(test.request('debug.snapshot').nodes, initial.nodes);
  test.request('debug.write', { id, value: 'older native' });
  value.value = 'newer JS';
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(value.value, 'newer JS');
  assert.equal(bodies, 2); // unrelated timer commits do not rerun this body
  for (let i = 0; i < 200; i++) test.request('debug.write', { id, value: `native ${i} 🦊` });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(value.value, 'native 199 🦊');
  assert.ok(ticks.value > 3);
  value.value = 'café';
  value.value = 'cafe\u0301';
  assert.equal(value.value, 'cafe\u0301');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(test.request('debug.snapshot').nodes.some(n => n.props.value === 'cafe\u0301'));
  test.request(mode === 'quit' ? 'debug.quit' : 'debug.close');
}
await app;
assert.equal(stops, 1);
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(test.request('debug.snapshot').nodes.length, 0);
console.log('PASS native contracts and shutdown');
