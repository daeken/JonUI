import assert from 'node:assert/strict';
import { Button, Component, Focus, ForEach, Slider, State, Text, TextField, Toggle, View, VStack, runApp, __testing as test } from 'jonui';

const shown = State(false), reversed = State(false), blocked = State(false), ancestorBlocked = State(false), named = State(true), presented = State(false), version = State(0);
const names = State(['café', 'cafe\u0301', 'level']), parent = State('parent');
let controllers, model, setups = 0, disposals = 0, eligibleChecks = 0, excludedChecks = 0, absentChecks = 0; const presses = [], availability = [];
const Panel = Component(scope => {
  setups++; const focus = scope.focus(), boolean = scope.focusBoolean(), selection = scope.focusSelection([1]); controllers = { focus, boolean, selection };
  const local = model = { flag: scope.state(false), value: scope.state(0.5) }; scope.onDispose(() => { disposals++; });
  return () => {
    const current = version.value, options = index => named.value ? { focusName: names.value[index] } : {};
    return VStack([
      ForEach(reversed.value ? ['slider', 'toggle', 'button'] : ['button', 'toggle', 'slider'], { id: key => key }, key => {
        if (key === 'button') {
          const button = Button('Same label', () => presses.push(current), options(0)).padding(2);
          return (named.value ? button.focused(focus.binding(names.value[0])) : button).disabled(blocked.value);
        }
        return key === 'toggle' ? Toggle('Same label', { isOn: local.flag.binding, ...options(1) }).disabled(blocked.value)
          : Slider('Same label', { value: local.value.binding, min: 0, max: 1, step: 0.25, ...options(2) }).disabled(blocked.value);
      }),
      Button('Owned button', () => presses.push(current + 100)).focused(focus.binding('owned-button')),
      Toggle('Owned toggle', { isOn: local.flag.binding }).focused(boolean.binding),
      Slider('Owned slider', { value: local.value.binding }).focused(selection.binding(1)),
      Text(`${local.flag.value}/${local.value.value}`),
    ]).disabled(ancestorBlocked.value).sheet({ isPresented: presented.binding, content: Button('Sheet', () => {}, { focusName: 'sheet' }).frame({ width: 320, height: 140 }) });
  };
});
const app = runApp({ title: 'JonUI named Button Toggle Slider', width: 620, height: 490, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), controls = () => test.request('debug.focusControls').controls;
const node = name => snapshot().nodes.find(n => n.props.focusName === name);
const candidates = name => { const owner = node(name); return controls().filter(c => c.owner === owner?.id &&
  (owner.kind === 'slider' ? c.kind === 'slider' : owner.kind === 'toggle' ? ['button', 'switch'].includes(c.kind) : c.kind === 'button')); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ controls: controls(), stats: test.stats(), snapshot: snapshot() })}`);
}
async function request(name) {
  assert.equal(Focus.requestNamed('parent'), true); await until(() => controllers.focus.actual.value === 'parent', 'parent focus');
  const native = candidates(name), eligible = native.some(c => c.eligible && c.enabled);
  assert.equal(Focus.availabilityNamed(name), eligible ? 'ready' : 'unavailable');
  controllers.focus.request(name); test.flush(); await sleep(25);
  assert.equal(controllers.focus.desired.value, name); assert.equal(controllers.focus.actual.value, eligible ? name : 'parent');
  assert.equal(Focus.requestNamed(name), eligible);
  if (eligible) {
    eligibleChecks++; assert.ok(candidates(name).some(c => c.focused)); const target = Focus.capture(); assert.ok(target);
    assert.equal(Focus.requestNamed('parent'), true); const field = Focus.capture(); assert.ok(field);
    assert.equal(Focus.setTraversal([field, target], { tabNavigation: true }), true); Focus.next(); assert.equal(Focus.currentName(), name);
    Focus.previous(); assert.equal(Focus.currentName(), 'parent'); assert.equal(test.request('debug.tab').intercepted, true); assert.equal(Focus.currentName(), name); Focus.setTraversal([]);
  } else if (native.length) excludedChecks++; else absentChecks++;
}
await until(() => snapshot().hostedControlCount === 1, 'parent'); const baseline = test.stats(); shown.value = true;
await until(() => snapshot().hostedControlCount === 7 && test.focusStats().listeners === 3, 'six bounded named controls');
const keyboardAccess = test.request('debug.focusControls').fullKeyboardAccess, original = model;
assert.equal(test.request('debug.focusNames').count, 8); assert.ok(snapshot().nodes.every(n => !('focusBinding' in n.props) && !('action' in n.props)));
for (const name of names.value) await request(name);
const owned = snapshot().nodes.filter(n => ['button', 'toggle', 'slider'].includes(n.kind) && n.props.title.startsWith('Owned')).map(n => n.props.focusName);
for (const name of owned) await request(name);
// Exercise the normal native scalar mirror/action bridge without claiming a
// physical control action when this SwiftUI version draws the control itself.
const buttonID = node(names.value[0]).id; test.request('debug.action', { id: buttonID });
test.request('debug.write', { id: node(names.value[1]).props.state, value: true });
test.request('debug.input', { id: node('level').id, value: 0.63 });
await until(() => presses.at(-1) === 0 && model.flag.value && model.value.value === 0.75, 'hosted action and scalar binding bridge');
const ids = snapshot().nodes.map(n => n.id).sort((a, b) => a - b), stable = snapshot().nodes;
for (const kind of ['button', 'toggle', 'slider']) {
  const target = stable.find(n => n.kind === kind);
  for (const focusName of [null, false, '', 1, {}, [], 'parent']) {
    assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, focusName } }] }), /Focus name|Duplicate focus name/);
    assert.deepEqual(snapshot().nodes, stable);
  }
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, unexpected: true } }] }), /Unknown input option/); assert.deepEqual(snapshot().nodes, stable);
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, title: false } }] }), /title must be a string/); assert.deepEqual(snapshot().nodes, stable);
}
version.value = 1; names.value = ['Renamed 🦊', 'cafe\u0301', 'level']; reversed.value = true; test.flush(); await sleep(30);
assert.equal(model, original); assert.equal(setups, 1); assert.deepEqual(snapshot().nodes.map(n => n.id).sort((a,b) => a-b), ids); assert.equal(Focus.requestNamed('café'), false);
test.request('debug.action', { id: buttonID }); await until(() => presses.at(-1) === 1, 'current callback after keyed rename');
for (const name of names.value) await request(name);
blocked.value = true; test.flush(); await sleep(30);
for (const name of names.value) { assert.equal(Focus.availabilityNamed(name), 'unavailable'); assert.equal(Focus.requestNamed(name), false); assert.ok(candidates(name).every(c => !c.enabled)); }
blocked.value = false; ancestorBlocked.value = true; test.flush(); await sleep(30);
for (const name of [...names.value, ...owned]) { assert.equal(Focus.availabilityNamed(name), 'unavailable'); assert.equal(Focus.requestNamed(name), false); assert.ok(candidates(name).every(c => !c.enabled)); }
ancestorBlocked.value = false; test.flush(); await sleep(30);
const stop = Focus.subscribeAvailability(names.value[0], value => availability.push(value)); await until(() => availability.length === 1, 'initial named availability');
named.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 4 && availability.at(-1) === 'missing', 'naming removed without changing state/handler identity');
assert.equal(node(names.value[0]), undefined); assert.equal(model, original); assert.equal(model.value.value, 0.75); test.request('debug.action', { id: buttonID }); await until(() => presses.length === 3, 'unnamed action preserved');
named.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 7 && availability.at(-1) !== 'missing', 'names reinserted'); stop();
for (const name of names.value) await request(name);
presented.value = true; await until(() => test.request('debug.focusContext').sheet && Object.values(controllers).every(c => c.retired.value) && node('sheet'), 'sheet retires owners');
for (const name of names.value) { assert.equal(Focus.availabilityNamed(name), 'inactiveWindow'); assert.equal(Focus.requestNamed(name), false); }
const sheetEligible = candidates('sheet').some(c => c.eligible && c.enabled); assert.equal(Focus.requestNamed('sheet'), sheetEligible);
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed'); assert.equal(Focus.requestNamed('parent'), true);
controllers.focus.resume(); await until(() => !controllers.focus.retired.value && controllers.focus.actual.value === 'parent', 'passive resume');
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, 'owner removed'); assert.deepEqual(test.stats(), baseline);
const pressCount = presses.length; test.request('debug.action', { id: buttonID }); await sleep(20); assert.equal(presses.length, pressCount);
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 7 && test.focusStats().listeners === 3, `mount ${i}`);
  controllers.focus.request(names.value[0]); controllers.boolean.request(true); controllers.selection.request(1); controllers.focus.retryWhenReady();
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, `pending removal ${i}`);
  assert.deepEqual(test.stats(), baseline); assert.equal(test.request('debug.focusNames').count, 1); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.deepEqual(test.availabilityStats(), { names: 0, listeners: 0 });
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().hostedControlCount, 0);
console.log(`PASS Button/Toggle/Slider naming: bounded same-label and private projection owners, action/scalar bridge, exact names, atomic validation, keyed rename, opt-in removal/reinsertion, disabled/sheet/session gates and 20 pending owner lifetimes; ${eligibleChecks} eligible/${excludedChecks} excluded/${absentChecks} absent public surfaces (full keyboard access ${keyboardAccess})`);
