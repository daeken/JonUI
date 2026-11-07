import assert from 'node:assert/strict';
import { Component, Focus, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
assert.throws(() => Focus.captureWindow(), /mounted window/);
const shown = State(false), presented = State(false), sheetShown = State(false), blocked = State(false), parent = State('parent'), fallback = State('sheet');
let mainWindow, sheetWindow, options, controllers, sheetController, originalModel, model, setups = 0, disposals = 0, sheetSetups = 0, sheetDisposals = 0, releaseTask, lateWindow, stopTask;
const Panel = Component(scope => {
  setups++; const named = scope.focus(null, options), boolean = scope.focusBoolean(false, options), selected = scope.focusSelection([1, '1'], null, options); controllers = { named, boolean, selected };
  const text = model = scope.state('日本 🦊'); scope.onDispose(() => { disposals++; });
  stopTask = scope.task(async () => { await new Promise(resolve => { releaseTask = resolve; }); lateWindow = Focus.captureWindow(); });
  return () => VStack([
    TextField('Named', { text: text.binding }).focused(named.binding('alpha')).disabled(blocked.value),
    TextField('Boolean', { text: text.binding }).focused(boolean.binding),
    TextField('Selected', { text: text.binding }).focused(selected.binding(1)),
  ]);
});
const SheetOwner = Component(scope => {
  sheetSetups++; sheetController = scope.focus('sheet-owned', { window: sheetWindow }); const text = scope.state('Owned sheet');
  scope.onDispose(() => { sheetDisposals++; }); return () => TextField('Owned sheet', { text: text.binding, focusName: 'sheet-owned' });
});
const app = runApp({ title: 'JonUI physical focus window guard', width: 540, height: 340, content: VStack([
  TextField('Parent', { text: parent.binding, focusName: 'parent' }), View(() => shown.value ? Panel() : Text('removed')),
]).sheet({ isPresented: presented.binding, content: View(() => sheetShown.value ? SheetOwner() : TextField('Sheet', { text: fallback.binding, focusName: 'sheet' })).frame({ width: 340, height: 150 }) }) });
const snapshot = () => test.request('debug.snapshot'), watch = () => test.request('debug.focusWatch'), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const context = test.request('debug.focusContext'); assert.equal(context.active, false); assert.equal(context.mainKey, false); assert.equal(context.activeKey, false); assert.equal(context.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}; ${JSON.stringify({ watch: watch(), stats: test.stats(), windows: test.request('debug.focusWindows') })}`);
}
await until(() => snapshot().hostedControlCount === 1, 'parent mounted'); mainWindow = Focus.captureWindow(); assert.ok(mainWindow); options = { window: mainWindow };
const mainID = test.request('focus.window.capture').window, initial = test.stats(), generation = watch().generation;
for (let i = 0; i < 50; i++) { assert.ok(Object.isFrozen(Focus.captureWindow())); assert.equal(test.request('focus.window.capture').window, mainID); }
assert.deepEqual(test.request('debug.focusWindows'), { windows: 1, live: 1 }); assert.deepEqual(test.stats(), initial); assert.equal(watch().generation, generation);
shown.value = true; await until(() => snapshot().hostedControlCount === 4 && Object.values(controllers).every(c => !c.retired.value), 'main-pinned controllers'); originalModel = model;
controllers.named.request('alpha'); await until(() => controllers.named.actual.value === 'alpha', 'pinned named focus');
controllers.boolean.request(true); await until(() => controllers.boolean.actual.value, 'pinned boolean focus');
controllers.selected.request(1); await until(() => controllers.selected.actual.value === 1, 'pinned typed focus');
assert.equal(Focus.requestNamed('parent'), true); await until(() => controllers.named.actual.value === 'parent', 'external parent focus');
blocked.value = true; test.flush(); await until(() => controllers.named.availability('alpha') === 'unavailable', 'target blocked');
controllers.named.request('alpha'); controllers.named.retryWhenReady(); await until(() => test.availabilityStats().names === 1, 'pinned retry waiting');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && Object.values(controllers).every(c => c.retired.value) && test.availabilityStats().names === 0, 'sheet retires main sessions/retry');
assert.equal(Focus.requestNamed('sheet'), true); sheetWindow = Focus.captureWindow(); const sheetID = test.request('focus.window.capture').window; assert.notEqual(sheetID, mainID);
options.window = sheetWindow; // Existing guards copied main identity during setup.
for (const c of Object.values(controllers)) c.resume(); controllers.named.request('sheet'); controllers.boolean.request(true); controllers.selected.request(1); controllers.named.retryWhenReady(); test.flush();
await until(() => Object.values(controllers).every(c => c.retired.value) && test.focusStats().listeners === 0, 'resume cannot rebind main owner to sheet');
assert.equal(Focus.currentName(), 'sheet'); assert.equal(model, originalModel); assert.equal(model.value, '日本 🦊'); assert.equal(controllers.named.availability('sheet'), 'ready', 'retired snapshots still describe current active targets');
const callbacks = []; controllers.named.subscribeAvailability('sheet', value => callbacks.push(value)); await sleep(20); assert.deepEqual(callbacks, []);
stopTask(); releaseTask(); await until(() => lateWindow === null, 'canceled capture inert');
sheetShown.value = true; await until(() => sheetController?.actual.value === 'sheet-owned', 'sheet-pinned controller initial request');
assert.equal(test.request('focus.window.capture').window, sheetID);
presented.value = false; await until(() => !test.request('debug.focusContext').sheet && sheetController.retired.value, 'sheet owner retires after dismissal');
assert.equal(Focus.requestNamed('parent'), true); sheetController.resume(); sheetController.request('parent'); test.flush(); await sleep(30); assert.equal(sheetController.retired.value, true); assert.equal(Focus.currentName(), 'parent');
blocked.value = false; test.flush(); for (const c of Object.values(controllers)) c.resume();
await until(() => Object.values(controllers).every(c => !c.retired.value) && controllers.named.actual.value === 'parent', 'main physical owner resumes passively');
assert.equal(test.request('focus.window.capture').window, mainID); assert.equal(controllers.named.desired.value, 'sheet');
controllers.named.request('alpha'); await until(() => controllers.named.actual.value === 'alpha', 'explicit new main request');
for (let i = 0; i < 20; i++) { controllers.named.resume(); await until(() => !controllers.named.retired.value, `same physical resume ${i}`); assert.equal(test.request('focus.window.capture').window, mainID); }
sheetShown.value = false; shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length && sheetDisposals === 1, 'both logical owners removed'); assert.deepEqual(test.stats(), initial);
// Physical guards are checked natively, independently of JS's activation barrier.
const stop = Focus.subscribe(() => {}), channel = watch();
const reject = test.request('focus.named', { name: 'parent', focusRequest: { token: channel.token, generation: channel.generation + 1, context: channel.context, window: sheetID } });
assert.equal(reject.focusAccepted, false); assert.equal(reject.observation.window, mainID);
const beforeInvalid = watch().generation;
for (const window of [0, -1, 1.5, '1', null, true]) assert.throws(() => test.request('focus.named', { name: 'parent', focusRequest: { token: channel.token, generation: beforeInvalid + 1, window } }), /counter/);
assert.equal(watch().generation, beforeInvalid); stop();
options = { window: mainWindow };
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 4 && Object.values(controllers).every(c => !c.retired.value), `guarded owner mount ${i}`);
  controllers.named.resume(); controllers.named.request('alpha'); controllers.named.retryWhenReady(); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 1 && snapshot().liveViews === snapshot().nodes.length, `pending guarded owner removal ${i}`);
  releaseTask(); await sleep(10); assert.equal(lateWindow, null); assert.deepEqual(test.stats(), initial); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false }); assert.deepEqual(test.availabilityStats(), { names: 0, listeners: 0 });
  assert.equal(test.request('focus.window.capture').window, mainID); assert.ok(test.request('debug.focusWindows').windows <= 2);
}
assert.equal(setups, 21); assert.equal(disposals, setups); assert.equal(sheetSetups, 1); assert.equal(sheetDisposals, 1);
test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().focusWindowCount, 0); assert.equal(Focus.captureWindow(), null);
console.log('PASS physical focus guards: opaque/deduplicated weak window identity, main/sheet isolation across watch sessions and explicit resume, named/boolean/typed requests, inactive-owner retry/subscription suppression, native stamp validation, canceled captures, passive return and 20 pending owner lifetimes without activation');
