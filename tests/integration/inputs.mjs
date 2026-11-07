import assert from 'node:assert/strict';
import { Component, Form, Section, Slider, State, Stepper, Text, TextField, View, runApp, __testing as test } from 'jonui';
const shown = State(true), style = State('automatic'), bounds = State({ min: 0, max: 10, step: 0.5 });
let amount, note, setups = 0, disposals = 0;
const observed = [];
const Settings = Component(scope => {
  setups++; amount = scope.state(2); note = scope.state('note');
  amount.subscribe(value => observed.push(value));
  scope.onDispose(() => { disposals++; });
  return () => Form([
    Section('Settings 🦊', [
      Slider('Amount', { value: amount.binding, ...bounds.value }),
      Stepper('Amount', { value: amount.binding, ...bounds.value }),
      TextField('Note', { text: note.binding }),
      View(() => Text(`Value:${amount.value}:${note.value}`)),
    ], { footer: 'Shared numeric state café' }),
  ], { style: style.value });
});
const app = runApp({ title: 'JonUI native forms/numeric inputs', width: 650, height: 450,
  content: View(() => shown.value ? Settings() : Text('hidden')),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot');
const controls = () => test.request('debug.controls').controls;
const has = (s, text) => s.nodes.some(n => n.props.value === text);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ snapshot: snapshot(), controls: controls() })}`);
}
let native = await until(s => s.states.length === 5 && has(s, 'Value:2:note') && controls().some(c => c.kind === 'stepper'), 'mounted native form/controls');
const sliderID = native.nodes.find(n => n.kind === 'slider').id, stepperID = native.nodes.find(n => n.kind === 'stepper').id;
const amountID = amount.binding.id, noteID = note.binding.id;
assert.ok(native.nodes.some(n => n.kind === 'section' && n.props.title === 'Settings 🦊' && n.props.footer === 'Shared numeric state café'));
await until(() => test.request('debug.layout').frames.some(f => f.id === sliderID && f.rect.width > 0 && f.rect.height > 0), 'rendered SwiftUI Slider geometry');
// SwiftUI's virtual Slider accessibility node is unavailable offscreen. Invoke
// the actual native Binding used by that view; keep the window transparent.
test.request('debug.input', { id: sliderID, value: 6.3 });
await until(s => has(s, 'Value:6.5:note'), 'stepped Slider binding publishes native value');
assert.equal(amount.value, 6.5); assert.equal(test.request('debug.input', { id: stepperID }).value, 6.5);
// On this macOS SDK, NSStepper uses a delta (-1/+1) target/action adapter.
test.request('debug.control', { index: controls().find(c => c.kind === 'stepper').index, value: 1 });
await until(s => has(s, 'Value:7:note'), 'real NSStepper increment action');
test.request('debug.control', { index: controls().find(c => c.kind === 'stepper').index, value: -1 });
await until(s => has(s, 'Value:6.5:note'), 'real NSStepper decrement action');
test.request('debug.input', { id: sliderID, value: -20 });
await until(s => has(s, 'Value:0:note'), 'native lower clamp');
test.request('debug.input', { id: sliderID, value: 50 });
await until(s => has(s, 'Value:10:note'), 'native upper clamp');
amount.value = 3.25;
await until(s => has(s, 'Value:3.25:note'), 'programmatic non-step value remains exact');
assert.equal(test.request('debug.input', { id: sliderID }).value, 3.25);
test.request('debug.control', { index: controls().find(c => c.kind === 'stepper').index, value: 1 });
await until(s => has(s, 'Value:3.75:note'), 'Stepper increments from exact non-step model value');
amount.value = 20;
await until(s => has(s, 'Value:20:note'), 'programmatic out-of-range model value is retained');
assert.equal(test.request('debug.input', { id: sliderID }).value, 10, 'native display getter clamps without rewriting model');
// Queue an older native event, then acknowledge a newer JS write.
test.request('debug.input', { id: sliderID, value: 8.1 }); amount.value = 1.25;
await until(s => has(s, 'Value:1.25:note'), 'numeric revision ordering');
await sleep(10); assert.equal(amount.value, 1.25);
test.request('debug.write', { id: noteID, value: 'Hello 🦊 café' });
await until(s => has(s, 'Value:1.25:Hello 🦊 café'), 'Unicode text input within form');
const beforeBadWrite = snapshot().states.find(state => state.id === amountID);
assert.throws(() => { amount.value = 'bad'; }, /Invalid binding value/);
assert.throws(() => test.request('debug.write', { id: amountID, value: true }), /Invalid binding value/);
assert.throws(() => { note.value = 42; }, /Invalid binding value/);
assert.deepEqual(snapshot().states.find(state => state.id === amountID), beforeBadWrite);
assert.equal(amount.value, 1.25); assert.equal(note.value, 'Hello 🦊 café');
bounds.value = { min: -5, max: 5, step: 0.25 };
await until(s => s.nodes.find(n => n.id === sliderID)?.props.min === -5, 'dynamic numeric range');
test.request('debug.input', { id: sliderID, value: -1.1 });
await until(s => has(s, 'Value:-1:Hello 🦊 café'), 'new range/step takes effect');
for (const next of ['grouped', 'columns', 'automatic']) {
  style.value = next;
  native = await until(s => s.nodes.some(n => n.kind === 'form' && n.props.style === next) && controls().some(c => c.kind === 'stepper'), `native ${next} form`);
  assert.equal(native.nodes.find(n => n.kind === 'slider').id, sliderID); assert.equal(setups, 1);
  assert.equal(amount.value, -1); assert.equal(note.value, 'Hello 🦊 café');
}
await sleep(20);
test.request('debug.control', { index: controls().find(c => c.kind === 'stepper').index, value: 1 });
await until(s => has(s, 'Value:-0.75:Hello 🦊 café'), 'updated Stepper step through real native action');
const unchanged = snapshot().nodes, slider = unchanged.find(n => n.id === sliderID);
for (const props of [
  { ...slider.props, min: 10, max: 0 }, { ...slider.props, min: -1e308, max: 1e308 },
  { ...slider.props, step: 0 }, { ...slider.props, step: 20 }, { ...slider.props, min: 0, max: 1e308, step: 1e-308 },
  { ...slider.props, min: false }, { ...slider.props, state: noteID },
]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...slider, props }] }));
  assert.deepEqual(snapshot().nodes, unchanged);
}
const form = unchanged.find(n => n.kind === 'form'), section = unchanged.find(n => n.kind === 'section');
assert.throws(() => test.request('commit', { nodes: [{ ...form, props: { style: 'invalid' } }] }), /form style/);
assert.throws(() => test.request('commit', { nodes: [{ ...section, props: { title: 'Invalid', footer: 42 } }] }), /title\/footer/);
assert.throws(() => test.request('commit', { nodes: [{ ...slider, children: [section.id] }] }), /child count/);
assert.deepEqual(snapshot().nodes, unchanged);
shown.value = false;
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && controls().length === 0, 'numeric control and cell teardown');
assert.throws(() => test.request('debug.input', { id: sliderID, value: 1 }), /Unknown numeric input/);
assert.throws(() => test.request('debug.write', { id: amountID, value: 1 }), /Unknown test state/);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  style.value = ['automatic', 'grouped', 'columns'][i % 3]; shown.value = true;
  await until(s => s.states.length === 5 && controls().some(c => c.kind === 'stepper'), `input mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && controls().length === 0, `input unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.ok(observed.includes(6.5) && observed.includes(7));
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS forms/numeric inputs: native styles/sections, rendered Slider and stepped/clamped binding, real NSStepper actions, shared revisions, dynamic ranges, binding type/transaction rejection, Unicode and 20 mount/unmount cycles');
