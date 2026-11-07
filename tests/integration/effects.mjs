import assert from 'node:assert/strict';
import { Component, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const branch = State(true), left = State('left'), right = State('right'), shown = State(true), label = State('a');
const runs = [], cleanups = [], propRuns = [], propCleanups = [];
let resourceStarts = 0, resourceStops = 0, ticks = 0, stopResource;
const Child = Component(scope => {
  const output = scope.state('');
  scope.effect(() => {
    const value = branch.value ? left.value : right.value;
    assert.ok(test.request('debug.snapshot').nodes.some(n => n.kind === 'textfield' && n.props.title === 'Effect output'));
    runs.push(value); output.value = value.toUpperCase();
    return () => cleanups.push(value);
  });
  scope.effect(() => {
    const value = scope.props.label; propRuns.push(value);
    return () => propCleanups.push(value);
  });
  stopResource = scope.effect(() => {
    resourceStarts++;
    const timer = setInterval(() => { ticks++; }, 1);
    return () => { clearInterval(timer); resourceStops++; };
  });
  return props => VStack([Text(`Props:${props.label}`), Text(`Effect:${output.value}`), TextField('Effect output', { text: output.binding })]);
});
const app = runApp({ title: 'JonUI effect lifetime test', width: 600, height: 400,
  content: VStack([
    TextField('Left input', { text: left.binding }), TextField('Right input', { text: right.binding }),
    View(() => shown.value ? Child({ label: label.value }) : Text('hidden')),
  ]),
});
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = (s, value) => s.nodes.some(n => n.props.value === value);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}`);
}
await until(s => has(s, 'Effect:LEFT') && ticks > 1, 'initial post-commit effects');
assert.deepEqual(runs, ['left']); assert.deepEqual(propRuns, ['a']);
assert.deepEqual(test.effectStats(), { active: 3, pending: 0 });
test.request('debug.write', { id: left.binding.id, value: 'Hello 🦊 café' });
await until(s => has(s, 'Effect:HELLO 🦊 CAFÉ'), 'native edit triggers effect and native output');
assert.deepEqual(cleanups, ['left']);
const beforeBatch = runs.length;
left.value = 'one'; left.value = 'two'; left.value = 'three';
await until(s => has(s, 'Effect:THREE'), 'batched state writes');
assert.equal(runs.length, beforeBatch + 1);
right.value = 'unused'; await sleep(20); assert.equal(runs.length, beforeBatch + 1);
branch.value = false;
await until(s => has(s, 'Effect:UNUSED'), 'conditional effect dependency');
const beforeLeft = runs.length;
left.value = 'no longer used'; await sleep(20); assert.equal(runs.length, beforeLeft);
label.value = 'b';
await until(s => has(s, 'Props:b') && propRuns.length === 2, 'current reactive component props');
assert.deepEqual(propRuns, ['a', 'b']); assert.deepEqual(propCleanups, ['a']);
assert.equal(resourceStarts, 1);
stopResource(); stopResource();
assert.equal(resourceStops, 1); assert.deepEqual(test.effectStats(), { active: 2, pending: 0 });
shown.value = false;
await until(s => s.states.length === 5 && s.liveCells === 5, 'effect owner unmounted');
assert.deepEqual(test.effectStats(), { active: 0, pending: 0 });
assert.deepEqual(runs, cleanups); assert.deepEqual(propRuns, propCleanups);
const stoppedTicks = ticks;
right.value = 'after unmount'; label.value = 'c'; await sleep(20);
assert.equal(ticks, stoppedTicks);
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => has(s, 'Effect:AFTER UNMOUNT') && test.effectStats().active === 3, `effect mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 5 && s.liveCells === 5 && test.effectStats().active === 0, `effect cleanup ${i}`);
}
assert.equal(resourceStarts, 21); assert.equal(resourceStops, 21);
assert.deepEqual(runs, cleanups); assert.deepEqual(propRuns, propCleanups);
console.log('PASS effects: post-commit execution, native Unicode input/output, batching, dynamic dependencies, current props, explicit stop, timer cleanup and 20 owner mount/unmount cycles');
test.request('debug.close'); await app;
assert.deepEqual(test.effectStats(), { active: 0, pending: 0 });
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
assert.equal(snapshot().liveCells, 0);
