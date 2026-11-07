import assert from 'node:assert/strict';
import { Component, Focus, ForEach, Picker, State, Stepper, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), reversed = State(false), blocked = State(false), ancestorBlocked = State(false), presented = State(false), style = State('segmented'), stepName = State('count'), parent = State('parent');
const choiceName = 'café', renamed = 'cafe\u0301';
let controller, model, setups = 0, disposals = 0, eligibleChecks = 0, excludedChecks = 0, missingChecks = 0;
const Panel = Component(scope => {
  setups++; const focus = controller = scope.focus();
  const local = model = { count: scope.state(2), choice: scope.state('a'), sheet: scope.state(1) };
  scope.onDispose(() => { disposals++; });
  const options = [{ value: 'a', label: 'Alpha 🦊' }, { value: 'b', label: 'Beta 日本' }];
  return () => VStack([
    ForEach(reversed.value ? ['menu', 'choice', 'stepper'] : ['stepper', 'choice', 'menu'], { id: id => id }, key => {
      if (key === 'stepper') return Stepper('Same label', { value: local.count.binding, min: 0, max: 10, focusName: stepName.value }).padding(2).focused(focus.binding(stepName.value)).disabled(blocked.value);
      return Picker('Same label', { selection: local.choice.binding, options, style: key === 'menu' ? 'menu' : style.value,
        focusName: key === 'menu' ? 'menu' : choiceName }).focused(focus.binding(key === 'menu' ? 'menu' : choiceName)).disabled(false);
    }),
    Text(`Actual ${focus.actual.value}; desired ${focus.desired.value}; value ${local.count.value}/${local.choice.value}`),
  ]).disabled(ancestorBlocked.value).sheet({ isPresented: presented.binding, content: Stepper('Sheet count', { value: local.sheet.binding, focusName: 'sheet-count' }).frame({ width: 320, height: 140 }) });
});
const app = runApp({ title: 'JonUI named Stepper and Picker', width: 620, height: 380, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]) });
const snapshot = () => test.request('debug.snapshot'), controls = () => test.request('debug.focusControls').controls;
const names = () => test.request('debug.focusNames').count;
const node = name => snapshot().nodes.find(n => n.props.focusName === name);
const ownedControls = name => controls().filter(c => c.owner === node(name)?.id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext');
    assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ controls: controls(), stats: test.stats(), actual: controller?.actual.value })}`);
}
async function request(name) {
  Focus.clear(); assert.equal(Focus.requestNamed('parent'), true);
  await until(() => controller.actual.value === 'parent', 'unrelated focus before request');
  const candidates = ownedControls(name), eligible = candidates.some(c => c.eligible);
  controller.request(name); test.flush(); await sleep(30);
  assert.equal(controller.desired.value, name);
  assert.equal(controller.actual.value, eligible ? name : 'parent');
  assert.equal(Focus.requestNamed(name), eligible);
  if (eligible) {
    eligibleChecks++; assert.ok(ownedControls(name).some(c => c.focused));
    const target = Focus.capture(); assert.ok(target); Focus.clear(); assert.equal(Focus.request(target), true);
    const field = (() => { Focus.requestNamed('parent'); return Focus.capture(); })(); assert.ok(field);
    assert.equal(Focus.setTraversal([field, target], { tabNavigation: true }), true);
    Focus.next(); assert.equal(Focus.currentName(), name); Focus.previous(); assert.equal(Focus.currentName(), 'parent');
    assert.equal(test.request('debug.tab').intercepted, true); assert.equal(Focus.currentName(), name);
    Focus.setTraversal([]);
  } else if (candidates.length) excludedChecks++; else missingChecks++;
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted'); shown.value = true;
await until(() => snapshot().hostedControlCount === 4 && ownedControls('count').some(c => c.kind === 'stepper') && ownedControls(choiceName).some(c => c.kind === 'segmented') && test.focusStats().listeners === 1, 'bounded native owners');
assert.equal(names(), 5); assert.ok(snapshot().nodes.every(n => !('focusBinding' in n.props)));
const keyboardAccess = test.request('debug.focusControls').fullKeyboardAccess, original = model;
for (const name of ['count', choiceName, 'menu']) await request(name);
const stepper = test.request('debug.controls').controls.find(c => c.kind === 'stepper'); assert.ok(stepper);
// SwiftUI's NSStepper adapter publishes an increment/decrement direction.
test.request('debug.control', { index: stepper.index, value: 1 });
await until(() => model.count.value === 3, 'real NSStepper action reaches scalar state');
const picker = test.request('debug.pickers').pickers.find(p => p.style === 'segmented' && p.items.includes('Beta 日本')); assert.ok(picker);
assert.equal(test.request('debug.picker', { index: picker.index, item: picker.items.indexOf('Beta 日本') }).handled, true);
await until(() => model.choice.value === 'b', 'real segmented action reaches typed selection');
const stable = snapshot().nodes, stepNode = node('count');
for (const focusName of [false, '', 1, choiceName]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...stepNode, props: { ...stepNode.props, focusName } }] }), /Focus name|Duplicate focus name/);
  assert.deepEqual(snapshot().nodes, stable); assert.equal(names(), 5);
}
stepName.value = renamed; reversed.value = true; test.flush();
await until(() => node(renamed) && ownedControls(renamed).some(c => c.kind === 'stepper'), 'exact Unicode rename and keyed reorder');
assert.equal(Focus.requestNamed('count'), false); assert.equal(model, original); assert.equal(model.count.value, 3); assert.equal(model.choice.value, 'b'); assert.equal(setups, 1);
await request(renamed); await request(choiceName);
blocked.value = true; test.flush(); await until(() => ownedControls(renamed).every(c => !c.enabled && !c.eligible), 'inherited disabled reaches bounded stepper');
assert.equal(Focus.requestNamed(renamed), false); blocked.value = false; test.flush(); await until(() => ownedControls(renamed).some(c => c.enabled), 'stepper re-enabled');
ancestorBlocked.value = true; test.flush(); await until(() => [...ownedControls(renamed), ...ownedControls(choiceName)].every(c => !c.enabled && !c.eligible), 'ancestor disabled wins over child false');
assert.equal(Focus.requestNamed(renamed), false); assert.equal(Focus.requestNamed(choiceName), false);
ancestorBlocked.value = false; test.flush(); await until(() => ownedControls(choiceName).some(c => c.enabled), 'ancestor enabled restored');
for (const next of ['menu', 'automatic', 'segmented']) {
  style.value = next; test.flush(); await sleep(50);
  await until(() => node(choiceName).props.style === next, `${next} logical style`);
  if (next === 'segmented') await until(() => ownedControls(choiceName).some(c => c.kind === 'segmented'), 'segmented surface restored');
  await request(choiceName); assert.equal(model.choice.value, 'b'); assert.equal(model, original);
}
presented.value = true; await until(() => test.request('debug.focusContext').sheet && controller.retired.value && ownedControls('sheet-count').some(c => c.kind === 'stepper'), 'named sheet stepper');
assert.equal(Focus.requestNamed(renamed), false);
const sheetEligible = ownedControls('sheet-count').some(c => c.eligible);
assert.equal(Focus.requestNamed('sheet-count'), sheetEligible); assert.equal(Focus.currentName(), sheetEligible ? 'sheet-count' : null);
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed');
assert.equal(Focus.requestNamed('parent'), true); controller.resume(); await until(() => !controller.retired.value && controller.actual.value === 'parent', 'passive parent resume');
shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, 'bounded choice retirement');
assert.equal(names(), 1); assert.equal(controls().length, 0); const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 4 && ownedControls(renamed).some(c => c.kind === 'stepper') && ownedControls(choiceName).some(c => c.kind === 'segmented'), `choice mount ${i}`);
  controller.request(renamed); controller.request(choiceName); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, `pending choice removal ${i}`);
  assert.deepEqual(test.stats(), baseline); assert.equal(names(), 1); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.equal(controls().length, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.ok(excludedChecks + missingChecks + eligibleChecks >= 8);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().hostedControlCount, 0); assert.equal(snapshot().liveCells, 0);
console.log(`PASS named choices: actual NSStepper/segmented bindings, bounded same-label owners, exact Unicode rename, atomic names, style/disabled/sheet gates, resume and 20 pending owner lifetimes; ${eligibleChecks} eligible/${excludedChecks} keyboard-excluded/${missingChecks} absent surfaces (full keyboard access ${keyboardAccess})`);
