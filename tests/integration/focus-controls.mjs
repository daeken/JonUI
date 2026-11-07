import assert from 'node:assert/strict';
import { Button, Component, DatePicker, Focus, ForEach, Picker, Slider, State, Stepper, Text, TextField, Toggle, View, VStack, runApp, __testing as test } from 'jonui';

const shown = State(true), reversed = State(false), blocked = State(false), ancestorBlocked = State(false);
let model, setups = 0, disposals = 0, actions = 0;
const Panel = Component(scope => {
  setups++; model = { text: scope.state('name'), count: scope.state(2), choice: scope.state('a'), date: scope.state(Date.UTC(2026, 0, 1)), flag: scope.state(true) };
  scope.onDispose(() => { disposals++; });
  return () => {
    const keys = ['text', 'date', 'stepper', 'picker', 'button', 'toggle', 'slider'];
    return VStack([ForEach(reversed.value ? keys.reverse() : keys, { id: id => id }, kind => {
      const views = {
        text: () => TextField(`Name (${model.text.value.length})`, { text: model.text.binding }),
        date: () => DatePicker('Appointment', { selection: model.date.binding, components: 'date', style: 'compact', timeZone: 'UTC' }).disabled(blocked.value),
        stepper: () => Stepper('Count', { value: model.count.binding }),
        picker: () => Picker('Choice', { selection: model.choice.binding, style: 'segmented', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }),
        button: () => Button('Action', () => { actions++; }),
        toggle: () => Toggle('Flag', { isOn: model.flag.binding }),
        slider: () => Slider('Level', { value: model.count.binding, min: 0, max: 10 }),
      };
      // A child cannot override disabling inherited from its ancestor.
      return views[kind]().disabled(false);
    })], { spacing: 12 }).disabled(ancestorBlocked.value);
  };
});
const app = runApp({ title: 'JonUI non-text focus and disabled subtrees', width: 600, height: 500, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus');
const controls = () => test.request('debug.focusControls').controls, date = () => controls().find(c => c.kind === 'date');
const cycle = () => test.request('debug.focusTraversal'), handles = () => test.request('debug.focusHandles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(); assert.equal(status().key, false); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), controls: controls(), cycle: cycle(), counts: test.stats() })}`);
}
const tab = (reverse = false) => test.request('debug.tab', { modifiers: reverse ? ['shift'] : [] }).intercepted;
function captureDate() {
  assert.equal(test.request('debug.focus', { control: date().index }).accepted, true);
  assert.equal(date().focused, true); const target = Focus.capture(); assert.ok(target); return target;
}
await until(s => s.states.length === 9 && date()?.eligible && controls().some(c => c.kind === 'stepper') && controls().some(c => c.kind === 'segmented'), 'real non-text controls');
const keyboardAccess = test.request('debug.focusControls').fullKeyboardAccess;
// Inspect actual platform eligibility instead of changing the user's settings
// or forcing acceptsFirstResponder/canBecomeKeyView in a test subclass.
let eligibleNonText = 0, excludedNonText = 0;
for (const control of controls().filter(c => ['stepper', 'segmented', 'date'].includes(c.kind))) {
  Focus.clear();
  test.request('debug.focus', { control: control.index });
  const target = Focus.capture();
  if (control.eligible) { assert.ok(target); Focus.clear(); assert.equal(Focus.request(target), true); eligibleNonText++; }
  else { assert.equal(target, null); excludedNonText++; }
}
assert.ok(eligibleNonText >= 1);
test.request('debug.focus', { field: 0 }); const name = Focus.capture(); assert.ok(name);
const appointment = captureDate();
for (let i = 0; i < 50; i++) assert.ok(Focus.capture());
const registered = handles().targets;
for (let i = 0; i < 50; i++) assert.ok(Focus.capture());
assert.equal(handles().targets, registered, 'recapture deduplicates non-text native identities');
assert.equal(Focus.setTraversal([name, appointment], { tabNavigation: true }), true);
Focus.clear(); Focus.next(); assert.deepEqual(status().fields, [0]);
Focus.next(); assert.equal(date().focused, true); Focus.previous(); assert.deepEqual(status().fields, [0]);
assert.equal(tab(), true); assert.equal(date().focused, true); assert.equal(tab(true), true); assert.deepEqual(status().fields, [0]);
test.request('debug.field', { index: 0, value: 'Available 🦊 café' });
const updated = Date.UTC(2028, 1, 29); test.request('debug.date', { index: 0, value: updated });
await until(() => model.text.value === 'Available 🦊 café' && model.date.value === updated, 'native Unicode/date edits');
assert.equal(Focus.request(appointment), true); assert.equal(date().focused, true);
const stableNodes = snapshot().nodes, disabled = stableNodes.find(n => n.props.name === 'disabled');
for (const value of [null, 0, 1, 'true', {}, []]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...disabled, props: { name: 'disabled', value } }] }), /boolean/);
  assert.deepEqual(snapshot().nodes, stableNodes); assert.equal(handles().targets, registered);
}
for (const props of [{ name: 'disabled' }, { name: 'disabled', value: false, unknown: true }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...disabled, props }] }), /disabled boolean|Unknown layout option/);
  assert.deepEqual(snapshot().nodes, stableNodes);
}
for (const children of [[], [disabled.children[0], disabled.children[0]]]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...disabled, children }] }), /child count/);
  assert.deepEqual(snapshot().nodes, stableNodes);
}
Focus.request(name); blocked.value = true; test.flush();
await until(() => !date().enabled && !date().eligible, 'public disabled modifier reaches NSDatePicker');
assert.equal(Focus.request(appointment), false); assert.equal(Focus.capture() !== null, true);
Focus.next(); assert.equal(cycle().count, 0, 'unavailable member discards whole cycle'); assert.equal(date().focused, false);
assert.equal(Focus.setTraversal([name]), true);
assert.equal(Focus.setTraversal([appointment, name], { tabNavigation: true }), false);
assert.deepEqual(cycle(), { count: 1, tabNavigation: false }, 'unavailable replacement leaves valid configuration intact');
blocked.value = false; test.flush(); await until(() => date().enabled && date().eligible, 're-enabled date control');
assert.equal(Focus.request(appointment), true, 'property-only availability changes keep the weak target');
assert.equal(handles().targets, registered); assert.equal(setups, 1);
ancestorBlocked.value = true; test.flush();
await until(() => controls().filter(c => ['stepper', 'segmented', 'date'].includes(c.kind)).every(c => !c.enabled) && !test.request('debug.fields').fields[0].enabled, 'ancestor disabling wins over child false');
assert.equal(Focus.request(name), false); assert.equal(Focus.request(appointment), false); assert.equal(Focus.capture(), null);
ancestorBlocked.value = false; test.flush(); await until(() => date().eligible && test.request('debug.fields').fields[0].enabled, 'ancestor availability restored');
assert.equal(Focus.request(name), true); assert.equal(Focus.request(appointment), true);
test.request('debug.focusControlAvailability', { index: date().index, hidden: true }); Focus.request(name);
assert.equal(Focus.request(appointment), false); assert.equal(Focus.setTraversal([appointment]), false);
test.request('debug.focusControlAvailability', { index: date().index, hidden: false }); assert.equal(Focus.request(appointment), true);
const original = model; reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.equal(Focus.request(appointment), true); assert.equal(date().focused, true);
assert.equal(Focus.setTraversal([appointment, name], { tabNavigation: true }), true);
Focus.request(name); assert.equal(tab(), true); assert.equal(date().focused, true);
shown.value = false;
await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && controls().length === 0, 'focused non-text owner teardown');
assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
assert.equal(Focus.request(appointment), false); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(s => s.states.length === 9 && date()?.eligible, `non-text mount ${i}`);
  const target = captureDate(); assert.equal(Focus.setTraversal([target], { tabNavigation: true }), true);
  ancestorBlocked.value = true; test.flush(); await until(() => !date().eligible, `disabled mount ${i}`);
  assert.equal(Focus.request(target), false);
  ancestorBlocked.value = false; test.flush(); await until(() => date().eligible, `re-enabled mount ${i}`);
  assert.equal(Focus.request(target), true); assert.equal(tab(), true); assert.equal(date().focused, true);
  shown.value = false;
  await until(s => s.states.length === 4 && s.liveCells === 4 && s.liveViews === s.nodes.length && controls().length === 0, `non-text unmount ${i}`);
  assert.equal(Focus.request(target), false); assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.deepEqual(cycle(), { count: 0, tabNavigation: false });
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(actions, 0);
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log(`PASS non-text focus/disabled: real NSDatePicker capture/restore, native command/Tab cycles, ${eligibleNonText} eligible/${excludedNonText} excluded controls (full keyboard access ${keyboardAccess}), Unicode/date edits, inherited disabling, unavailable/hidden fallback, atomic validation, keyed identity and 20 focused mount/unmount cycles`);
