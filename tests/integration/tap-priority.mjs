import assert from 'node:assert/strict';
import { Button, Component, Focus, ForEach, State, Text, TextField, Toggle, View, VStack, runApp, __testing as test } from 'jonui';
const gesture = process.env.JONUI_CASE === 'spatial' ? 'onSpatialTapGesture' : 'onTapGesture';
const shown = State(false), priority = State('normal'), revision = State(0), reversed = State(false), blocked = State(false);
const events = []; let model, setups = 0, disposals = 0;
const Owner = Component(scope => {
  setups++; const text = scope.state('日本 🦊'), on = scope.state(false), total = scope.state(0); model = { text, on, total };
  scope.onDispose(() => disposals++);
  return () => {
    const current = revision.value, options = { priority: priority.value }, record = kind => { total.value++; events.push([kind, current]); };
    const rows = {
      field: () => TextField('Field', { text: text.binding, focusName: 'field' }).frame({ width: 260, height: 40 })[gesture](() => record('field'), options),
      button: () => Button('Button', () => record('button')).frame({ width: 260, height: 40 })[gesture](() => record('button-tap'), options),
      toggle: () => Toggle('Toggle', { isOn: on.binding }).frame({ width: 260, height: 40 })[gesture](() => record('toggle-tap'), options),
      nested: () => Text('Nested').frame({ width: 260, height: 40 })[gesture](() => record('child'))[gesture](() => record('parent'), options),
      double: () => Text('Double').frame({ width: 260, height: 40 })[gesture](() => record('double'), { ...options, count: 2 }),
    };
    const order = Object.keys(rows); if (reversed.value) order.reverse();
    return VStack([ForEach(order, { id: id => id }, id => rows[id]()), Text(`Total: ${total.value}`)], { spacing: 12 }).disabled(blocked.value);
  };
});
const app = runApp({ title: 'JonUI native tap priorities', width: 480, height: 420, content: View(() => shown.value ? Owner() : Text('removed')) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(r => setTimeout(r, ms));
function node(label) {
  const nodes = snapshot().nodes, byID = new Map(nodes.map(n => [n.id, n]));
  return nodes.find(n => { if (!n.props.tap) return false; let child = byID.get(n.children[0]); while (child?.kind === 'modifier') child = byID.get(child.children[0]); return child?.props.title === label || child?.props.value === label; });
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events: events.slice(-8), stats: test.stats(), layout: test.request('debug.layout') })}`);
}
async function click(label, expected, { count = 1, flips = false } = {}) {
  const target = node(label); await until(() => test.request('debug.layout').frames.some(f => f.id === target.id), `layout ${label}`);
  const before = events.length, oldTotal = model.total.value, oldOn = model.on.value;
  const queued = test.request('debug.tap', { id: target.id, count, command: true }); assert.equal(queued.modifiers, 1 << 20);
  await until(() => test.request('debug.tapResult', { id: queued.id }).done, 'native mouse dispatch');
  if (expected.length || flips) await until(() => events.length >= before + expected.length && model.on.value === (flips ? !oldOn : oldOn), `recognition ${label}`);
  await sleep(40); assert.deepEqual(events.slice(before).sort(), expected.map(kind => [kind, revision.value]).sort()); assert.equal(model.total.value, oldTotal + expected.length); assert.equal(model.on.value, flips ? !oldOn : oldOn);
}
async function checkMode(value) {
  priority.value = value; test.flush(); await sleep(40);
  await click('Button', value === 'normal' ? ['button'] : value === 'high' ? ['button-tap'] : ['button', 'button-tap']);
  await click('Toggle', value === 'normal' ? [] : ['toggle-tap'], { flips: value !== 'high' });
  await click('Nested', value === 'normal' ? ['child'] : value === 'high' ? ['parent'] : ['child', 'parent']);
  await click('Double', ['double'], { count: 2 });
}
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true; test.flush();
await until(() => snapshot().hostedControlCount === 1 && node('Button'), 'controls'); assert.equal(Focus.requestNamed('field'), true); const captured = Focus.capture(); assert.ok(captured);
const original = snapshot().nodes.filter(n => n.props.tap).map(n => [n.id, n.props.tap]); await checkMode('normal');
revision.value = 1; reversed.value = true; test.flush(); await sleep(40); assert.deepEqual(snapshot().nodes.filter(n => n.props.tap).map(n => [n.id, n.props.tap]), original); assert.equal(Focus.request(captured), true); await click('Button', ['button']);
for (const value of ['high', 'simultaneous', 'normal']) {
  const old = node('Button'); await checkMode(value); assert.notEqual(node('Button').props.tap, old.props.tap); assert.equal(node('Button').id, old.id);
  assert.equal(Focus.request(captured), true, 'priority changes retain the native field target'); assert.equal(Focus.currentName(), 'field'); assert.equal(model.text.value, '日本 🦊');
}
const stable = snapshot().nodes, tap = node('Button');
for (const value of [undefined, null, true, 1, '', 'exclusive', [], {}]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...tap, props: { ...tap.props, priority: value } }] }), /Invalid tap gesture/); assert.deepEqual(snapshot().nodes, stable);
}
for (const value of ['normal', 'high', 'simultaneous']) {
  priority.value = value; blocked.value = true; test.flush(); await sleep(40); await click('Button', []); await click('Toggle', []); await click('Nested', []); await click('Double', [], { count: 2 });
}
blocked.value = false; shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'owner removal'); assert.deepEqual(test.stats(), baseline); assert.equal(Focus.request(captured), false);
for (let i = 0; i < 20; i++) {
  shown.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 1 && node('Button'), `mount ${i}`); await checkMode(['normal', 'high', 'simultaneous'][i % 3]);
  shown.value = false; test.flush(); await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0); assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
console.log('PASS ' + gesture + ' priorities: real native normal/high/simultaneous Button/Toggle/nested competition, double taps, current keyed handlers, stable native field focus, disabled ancestors, atomic validation and 20 owner lifetimes without activation');
