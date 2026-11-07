import assert from 'node:assert/strict';
import { Component, Form, Picker, Section, State, Text, View, runApp, __testing as test } from 'jonui';
const choices = [
  { value: 1, label: 'Number one' }, { value: '1', label: 'Text one' }, { value: null, label: 'None' },
  { value: 'café', label: 'Composed 🦊' }, { value: 'cafe\u0301', label: 'Decomposed 🦊' },
];
const items = State(choices), style = State('segmented'), shown = State(true);
let selected, setups = 0, disposals = 0, menuActions = 0;
const notifications = [];
const Settings = Component(scope => {
  setups++; selected = scope.state(null);
  selected.subscribe(value => notifications.push(value));
  scope.onDispose(() => { disposals++; });
  return () => Form([Section('Typed selection', [
    Picker('Choice', { selection: selected.binding, options: items.value, style: style.value, placeholder: 'Missing choice' }),
    View(() => Text(`Selected:${typeof selected.value}:${String(selected.value)}`)),
  ])], { style: 'grouped' });
});
const app = runApp({ title: 'JonUI typed picker tests', width: 800, height: 350,
  content: View(() => shown.value ? Settings() : Text('hidden')),
});
const snapshot = () => test.request('debug.snapshot');
const pickers = () => test.request('debug.pickers').pickers;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const has = (s, value) => s.nodes.some(n => n.props.value === value);
async function until(predicate, name) {
  const deadline = Date.now() + 5000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ snapshot: snapshot(), pickers: pickers(), layout: test.request('debug.layout') })}`);
}
async function choose(label, expected) {
  await until(() => pickers().some(p => p.style === 'segmented' && p.items.includes(label)), `native option ${label}`);
  const control = pickers().find(p => p.style === 'segmented');
  assert.equal(test.request('debug.picker', { index: control.index, item: control.items.indexOf(label) }).handled, true);
  await until(s => has(s, `Selected:${typeof expected}:${String(expected)}`), `native selected ${label}`);
  assert.equal(selected.value, expected);
}
let native = await until(s => s.states.length === 4 && pickers().some(p => p.style === 'segmented') && has(s, 'Selected:object:null'), 'native nullable selection');
assert.equal(test.request('debug.layout').content.width, 800); assert.equal(test.request('debug.layout').content.height, 350);
const id = native.nodes.find(n => n.kind === 'picker').id, cellID = selected.binding.id;
assert.equal(pickers()[0].items[pickers()[0].selected], 'None');
await choose('Number one', 1); await choose('Text one', '1');
await choose('Composed 🦊', 'café'); await choose('Decomposed 🦊', 'cafe\u0301');
assert.equal(selected.value.length, 5, 'canonical-equivalent Unicode IDs retain their original bytes');
items.value = [...choices].reverse();
await until(() => pickers()[0]?.items[0] === 'Decomposed 🦊', 'native options reordered');
assert.equal(pickers()[0].items[pickers()[0].selected], 'Decomposed 🦊');
assert.equal(selected.value, 'cafe\u0301'); assert.equal(setups, 1);
const beforeRemoval = snapshot().states.find(s => s.id === cellID).revision;
items.value = choices.filter(choice => choice.value !== 'cafe\u0301');
await until(() => pickers()[0]?.items.includes('Missing choice'), 'removed selected option shows placeholder');
assert.equal(selected.value, 'cafe\u0301');
assert.equal(snapshot().states.find(s => s.id === cellID).revision, beforeRemoval, 'option removal does not rewrite model');
assert.equal(test.request('debug.pickerBinding', { id, value: 'cafe\u0301' }).matched, false, 'obsolete option cannot publish');
const placeholder = pickers()[0];
test.request('debug.picker', { index: placeholder.index, item: placeholder.items.indexOf('Missing choice') });
await sleep(10); assert.equal(selected.value, 'cafe\u0301');
items.value = [];
await until(() => pickers()[0]?.enabled === false, 'empty picker disabled');
assert.equal(selected.value, 'cafe\u0301'); assert.equal(test.request('debug.pickerBinding', { id, value: 1 }).matched, false);
selected.value = 'external';
items.value = choices;
await until(() => pickers()[0]?.enabled && pickers()[0].items.includes('Number one'), 'restore choices with unmatched model');
assert.equal(test.request('debug.pickerBinding', { id }).matched, false);
await choose('None', null);
// Real native selection followed by a newer acknowledged JS write must not roll back.
const control = pickers()[0];
test.request('debug.picker', { index: control.index, item: control.items.indexOf('Number one') });
selected.value = '1';
await until(s => has(s, 'Selected:string:1'), 'typed picker revision ordering');
await sleep(10); assert.equal(selected.value, '1');
for (const next of ['menu', 'automatic']) {
  style.value = next;
  await until(s => s.nodes.find(n => n.id === id)?.props.style === next && test.request('debug.layout').frames.some(f => f.id === id && f.rect.width > 0 && f.rect.height > 0), `rendered ${next} picker`);
  const menu = pickers().find(p => p.style === 'menu' && p.items.includes('Number one'));
  if (menu) {
    assert.equal(test.request('debug.picker', { index: menu.index, item: menu.items.indexOf('Number one') }).handled, true);
    menuActions++;
  } else test.request('debug.pickerBinding', { id, value: 1 });
  await until(s => has(s, 'Selected:number:1'), `${next} native binding`);
  selected.value = 'unknown'; await sleep(10);
  assert.equal(test.request('debug.pickerBinding', { id }).matched, false);
  assert.equal(selected.value, 'unknown'); assert.equal(setups, 1);
}
style.value = 'segmented';
await until(() => pickers().some(p => p.style === 'segmented' && p.items.includes('None')), 'segmented control restored');
await choose('None', null);
const unchanged = snapshot().nodes, picker = unchanged.find(n => n.id === id);
for (const props of [
  { ...picker.props, options: [{ value: true, label: 'Invalid' }] },
  { ...picker.props, options: [{ value: 1, label: 'One' }, { value: 1, label: 'Duplicate' }] },
  { ...picker.props, options: [{ value: null, label: 42 }] }, { ...picker.props, options: [null] },
  { ...picker.props, style: 'wheel' }, { ...picker.props, placeholder: 42 }, { ...picker.props, state: shown.binding.id },
]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...picker, props }] }));
  assert.deepEqual(snapshot().nodes, unchanged);
}
const section = unchanged.find(n => n.kind === 'section');
assert.throws(() => test.request('commit', { nodes: [
  { ...picker, props: { ...picker.props, state: style.binding.id } },
  { id: 900000, kind: 'textfield', props: { title: 'Shared string cell', state: style.binding.id }, children: [] },
  { ...section, children: [...section.children, 900000] },
] }), /Invalid binding value for textfield/);
assert.deepEqual(snapshot().nodes, unchanged, 'incompatible options fail before adding a shared control');
assert.throws(() => { selected.value = true; }, /Invalid binding value/);
assert.throws(() => test.request('debug.write', { id: cellID, value: {} }), /Invalid binding value/);
assert.equal(selected.value, null);
const old = selected;
shown.value = false;
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && pickers().length === 0, 'picker and scoped cell release');
assert.equal(test.request('debug.layout').content.width, 800); assert.equal(test.request('debug.layout').content.height, 350);
assert.throws(() => test.request('debug.pickerBinding', { id, value: 1 }), /Unknown picker/);
assert.throws(() => test.request('debug.write', { id: cellID, value: 1 }), /Unknown test state/);
old.value = 100; assert.equal(old.value, null);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  style.value = ['automatic', 'menu', 'segmented'][i % 3]; shown.value = true;
  await until(s => {
    const picker = s.nodes.find(n => n.kind === 'picker');
    return s.states.length === 4 && picker && test.request('debug.layout').frames.some(f => f.id === picker.id && f.rect.width > 0 && f.rect.height > 0)
      && (style.value !== 'segmented' || pickers().some(p => p.style === 'segmented'));
  }, `picker mount ${i}`);
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && pickers().length === 0, `picker unmount ${i}`);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
assert.ok(notifications.some(value => value === 1) && notifications.some(value => value === '1') && notifications.includes(null));
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log(`PASS Picker: real native segmented actions, ${menuActions} menu actions, typed string/number/null and exact Unicode IDs, reordered/removed choices, passive/empty states, menu rendering/native bindings, revision ordering, atomic rejection and 20 mount/unmount cycles`);
