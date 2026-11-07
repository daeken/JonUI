import assert from 'node:assert/strict';
import { LongPressGesture, Button, Component, Focus, ForEach, State, Text, TextField, Toggle, View, VStack, runApp, __testing as test } from 'jonui';
const leaf = (callback, { priority, ...settings } = {}) => LongPressGesture(settings).onEnded(callback);
const duration = State(0.5);
const shown = State(false), priority = State('normal'), revision = State(0), reversed = State(false), blocked = State(false);
const events = [], timing = []; let model, setups = 0, disposals = 0;
const Owner = Component(scope => {
  setups++; const text = scope.state('日本 🦊'), on = scope.state(false), total = scope.state(0); model = { text, on, total };
  const held = Object.fromEntries(['field', 'button', 'toggle', 'nested'].map(key => [key, scope.gestureState()]));
  scope.onDispose(() => { assert.ok(Object.values(held).every(state => !state.value)); disposals++; });
  return () => {
    const current = revision.value;
    const options = key => ({ pressing: held[key], priority: priority.value, minimumDuration: duration.value,
      onPressingChanged: active => { assert.equal(held[key].value, active); events.push(['pressing', active]); timing.push([active, Date.now()]); },
    });
    const record = kind => { total.value++; events.push([kind, current]); timing.push([kind, Date.now()]); };
    const rows = {
      field: () => TextField('Field', { text: text.binding, focusName: 'field' }).frame({ width: 260, height: 40 }).gesture(leaf(() => record('field'), options('field')), { priority: priority.value }),
      button: () => Button('Button', () => record('button')).frame({ width: 260, height: 40 }).gesture(leaf(() => record('button-hold'), options('button')), { priority: priority.value }),
      toggle: () => Toggle('Toggle', { isOn: on.binding }).frame({ width: 260, height: 40 }).gesture(leaf(() => record('toggle-hold'), options('toggle')), { priority: priority.value }),
      nested: () => Text('Nested').frame({ width: 260, height: 40 }).gesture(leaf(() => record('child'), { minimumDuration: duration.value })).gesture(leaf(() => record('parent'), options('nested')), { priority: priority.value }),
    };
    const order = Object.keys(rows); if (reversed.value) order.reverse();
    return VStack([ForEach(order, { id: id => id }, id => rows[id]()), Text(`Total: ${total.value} · ${Object.values(held).some(state => state.value) ? 'held' : 'idle'}`)], { spacing: 12 }).disabled(blocked.value);
  };
});
const app = runApp({ title: 'JonUI native long press priorities', width: 480, height: 420, content: View(() => shown.value ? Owner() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(r => setTimeout(r, ms));
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.press) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.title === label || child?.props.value === label; });
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-8), stats: test.stats(), layout: test.request('debug.layout') })}`);
}
async function holdTarget(label, expected, { hold = 0.8, move, flips = false, pressing = true } = {}) {
  const target = node(label); await until(() => test.request('debug.layout').frames.some(f => f.id === target.id), `layout ${label}`);
  const start = Date.now(), timingStart = timing.length; const before = events.length, oldTotal = model.total.value, oldOn = model.on.value;
  const queued = test.request('debug.tap', { id: target.id, hold, ...(move ? { move } : {}), command: true }); assert.equal(queued.modifiers, 1 << 20);
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native mouse dispatch');
  if (expected.length || flips) await until(() => events.slice(before).filter(e => e[0] !== 'pressing').length >= expected.length && model.on.value === (flips ? !oldOn : oldOn), `recognition ${label}`);
  await sleep(40);
  const actual = events.slice(before), trace = timing.slice(timingStart);
  assert.deepEqual(actual.filter(e => e[0] !== 'pressing').sort(), expected.map(kind => [kind, revision.value]).sort(),
    JSON.stringify({ label, hold, priority: priority.value, timing: trace.map(([kind, at]) => [kind, at - start]) }));
  assert.deepEqual(actual.filter(e => e[0] === 'pressing'), pressing ? [['pressing', true], ['pressing', false]] : []);
  if (hold < duration.value && pressing) {
    const phases = trace.filter(([kind]) => typeof kind === 'boolean');
    assert.ok(phases[1][1] - phases[0][1] < duration.value * 1000, JSON.stringify(phases));
  }
  assert.equal(snapshot().pointerTimerCount, 0);
  assert.equal(model.total.value, oldTotal + expected.length);
  assert.equal(model.on.value, flips ? !oldOn : oldOn);
}
async function checkMode(value, cancellations = true) {
  priority.value = value; test.flush(); await sleep(40);
  await holdTarget('Button', value === 'normal' ? ['button'] : ['button', 'button-hold']);
  await holdTarget('Toggle', value === 'normal' ? [] : ['toggle-hold'], { flips: true });
  await holdTarget('Nested', value === 'normal' ? ['child'] : ['child', 'parent']);
  if (!cancellations) return;
  await holdTarget('Button', ['button'], { hold: 0.01 });
  await holdTarget('Toggle', [], { hold: 0.01, flips: true });
  await holdTarget('Nested', [], { hold: 0.01 });
  await holdTarget('Nested', [], { move: { x: 40, y: 0, after: 0.01 } });
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; test.flush();
await until(() => snapshot().hostedControlCount === 1 && node('Button'), 'controls'); assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured);
const original = snapshot().nodes.filter(n => n.props.press).map(n => [n.id, n.props.press]); await checkMode('normal');
revision.value = 1; reversed.value = true; test.flush(); await sleep(40); assert.deepEqual(snapshot().nodes.filter(n => n.props.press).map(n => [n.id, n.props.press]), original); assert.equal(Focus.request(captured), true); await holdTarget('Button', ['button']);
for (const value of ['simultaneous', 'normal']) {
  const old = node('Button'); await checkMode(value); assert.notEqual(node('Button').props.press, old.props.press); assert.equal(node('Button').id, old.id);
  assert.equal(Focus.request(captured), true, 'priority changes retain the native field target'); assert.equal(Focus.currentName(), 'field'); assert.equal(model.text.value, '日本 🦊');
}
// Zero-duration recognition can arrive before pressing-start; cover that ordering
// over competing controls and a nested gesture as well as the standalone fixture.
duration.value = 0; test.flush(); await sleep(40);
for (const value of ['normal', 'simultaneous']) {
  priority.value = value; test.flush(); await sleep(40);
  await holdTarget('Button', value === 'normal' ? ['button'] : ['button', 'button-hold'], { hold: 0.02 });
  await holdTarget('Toggle', value === 'normal' ? [] : ['toggle-hold'], { hold: 0.02, flips: true });
  await holdTarget('Nested', value === 'normal' ? ['child'] : ['child', 'parent'], { hold: 0.02 });
  assert.equal(Focus.request(captured), true);
}
duration.value = 0.5; test.flush(); await sleep(40);
const stable = snapshot().nodes, target = node('Button');
for (const value of [undefined, null, true, 1, '', 'high', 'exclusive', [], {}]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...target, props: { ...target.props, priority: value } }] }), /Invalid long press gesture/); assert.deepEqual(snapshot().nodes, stable);
}
for (const value of ['normal', 'simultaneous']) {
  priority.value = value; blocked.value = true; test.flush(); await sleep(40); await holdTarget('Button', [], { pressing: false }); await holdTarget('Toggle', [], { pressing: false }); await holdTarget('Nested', [], { pressing: false });
}
blocked.value = false; shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'owner removal'); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0); assert.equal(Focus.request(captured), false);
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 1 && node('Button'), `mount ${i}`); await checkMode(['normal', 'simultaneous'][i % 2], false);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline); assert.equal(test.gestureStats().active, 0);
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS long press priorities: real normal/simultaneous Button/Toggle/nested holds and zero thresholds, early release/movement cancellation, pressing observers, current keyed handlers, stable field focus, disabling, atomic validation and 20 owner lifetimes without activation');
