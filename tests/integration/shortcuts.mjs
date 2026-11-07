import assert from 'node:assert/strict';
import { Button, Component, Focus, ForEach, State, Text, TextField, View, VStack, runApp, __testing as test } from 'jonui';
const shown = State(false), key = State('k'), version = State(0), blocked = State(false), ancestor = State(false), reversed = State(false), named = State(false), attached = State(true), presented = State(false), auxiliary = State(false);
const events = []; let setups = 0, disposals = 0;
const Owner = Component(scope => {
  setups++; const text = scope.state('日本 🦊'); scope.onDispose(() => { disposals++; });
  return () => {
    const current = version.value;
    return VStack([
      TextField('Field', { text: text.binding, focusName: 'field' }),
      ForEach(reversed.value ? ['other', 'plain'] : ['plain', 'other'], { id: value => value }, id => {
        let button = Button('Same title', () => events.push([id, current]), named.value ? { focusName: `button-${id}` } : {});
        if (attached.value) button = button.padding(2).keyboardShortcut(id === 'plain' ? key.value : 'm');
        return button.disabled(blocked.value);
      }),
      Button('Digit', () => events.push(['digit', current])).keyboardShortcut('2'),
    ]).disabled(ancestor.value).sheet({ isPresented: presented.binding, content: VStack([
      TextField('Sheet field', { text: text.binding, focusName: 'sheet-field' }), Button('Sheet action', () => events.push(['sheet', current])).keyboardShortcut('k'),
    ]).frame({ width: 320, height: 160 }) });
  };
});
const app = runApp({ title: 'JonUI native Button shortcuts', width: 520, height: 360, content: View(() => shown.value ? Owner() : Text('removed'))
  .window({ isPresented: auxiliary.binding, title: 'Other root', width: 340, height: 190, content: Button('Auxiliary action', () => events.push(['auxiliary', version.value])).keyboardShortcut('j') }) });
const snapshot = () => test.request('debug.snapshot'), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function dispatch(value = 'k') {
  const { id } = test.request('debug.shortcut', { key: value }); let result;
  await until(() => { result = test.request('debug.shortcutResult', { id }); return result.done; }, 'native event dispatch');
  assert.equal(result.currentFlags, result.flags); return result.handled;
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  do {
    const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.mainKey, false); assert.equal(c.activeKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(10);
  } while (Date.now() < deadline);
  assert.fail(`Timed out ${label}: ${JSON.stringify({ events, stats: test.stats() })}`);
}
async function press(value, expected) {
  const before = events.length; assert.equal(await dispatch(value), true); await until(() => events.length === before + 1, `shortcut ${expected}`); assert.deepEqual(events.at(-1), [expected, version.value]);
}
async function absent(value = 'k') { const before = events.length; assert.equal(await dispatch(value), false); await sleep(30); assert.equal(events.length, before); }
await until(() => snapshot().nodes.length > 0, 'base'); const baseline = test.stats(); shown.value = true;
await until(() => snapshot().hostedControlCount === 1 && snapshot().nodes.some(n => n.props.shortcut), 'shortcut buttons');
assert.equal(Focus.requestNamed('field'), true); const field = Focus.capture(); assert.ok(field);
await press('k', 'plain'); await press('m', 'other'); await press('2', 'digit');
assert.equal(Focus.currentName(), 'field'); await absent('x');
const ids = snapshot().nodes.filter(n => n.kind === 'button' && n.props.title === 'Same title').map(n => n.id).sort();
version.value = 1; key.value = 'j'; reversed.value = true; test.flush(); await sleep(30);
assert.deepEqual(snapshot().nodes.filter(n => n.kind === 'button' && n.props.title === 'Same title').map(n => n.id).sort(), ids); assert.equal(setups, 1);
await absent('k'); await press('j', 'plain'); await press('m', 'other');
blocked.value = true; test.flush(); await sleep(30); await absent('j'); await absent('m'); blocked.value = false; ancestor.value = true; test.flush(); await sleep(30); await absent('j'); await absent('2');
ancestor.value = false; test.flush(); await sleep(30); await press('j', 'plain');
named.value = true; test.flush(); await until(() => snapshot().hostedControlCount === 3, 'bounded named buttons'); await sleep(30); await press('j', 'plain'); await press('m', 'other');
const stable = snapshot().nodes, button = stable.find(n => n.kind === 'button' && n.props.shortcut);
for (const shortcut of [null, {}, { key: 'K' }, { key: 'k', modifiers: [] }, { key: 'k', unknown: true }, { key: '🦊' }]) {
  assert.throws(() => test.request('commit', { nodes: [{ ...button, props: { ...button.props, shortcut } }] }), /keyboard shortcut/); assert.deepEqual(snapshot().nodes, stable);
}
attached.value = false; test.flush(); await sleep(30); await absent('j'); await absent('m'); attached.value = true; test.flush(); await sleep(30); await press('j', 'plain');
presented.value = true; await until(() => test.request('debug.focusContext').sheet && test.request('debug.focusStatus').key === false, 'sheet'); assert.equal(Focus.requestNamed('sheet-field'), true); await press('k', 'sheet'); await absent('j');
presented.value = false; await until(() => !test.request('debug.focusContext').sheet, 'sheet dismissed'); await sleep(30); await press('j', 'plain');
auxiliary.value = true; await until(() => test.request('debug.windows').windows.length === 1, 'independent root'); await sleep(30); await press('j', 'auxiliary'); await absent('2');
test.request('debug.selectWindow', { id: 0 }); await press('j', 'plain'); auxiliary.value = false; shown.value = false; test.flush();
await until(() => snapshot().hostedControlCount === 0 && snapshot().ownedWindowCount === 0 && snapshot().liveViews === snapshot().nodes.length, 'shortcut owners removed'); assert.deepEqual(test.stats(), baseline); await absent('j');
named.value = false; key.value = 'k';
for (let i = 0; i < 20; i++) {
  shown.value = true; await until(() => snapshot().hostedControlCount === 1, `mount ${i}`); await sleep(20); await press('k', 'plain'); shown.value = false; test.flush();
  await until(() => snapshot().hostedControlCount === 0 && snapshot().liveViews === snapshot().nodes.length, `remove ${i}`); assert.deepEqual(test.stats(), baseline); await absent('k');
}
assert.equal(setups, 21); assert.equal(disposals, setups); test.request('debug.close'); await app; assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().liveViews, 0);
console.log('PASS native shortcuts: actual SwiftUI window key-equivalent dispatch for command letters/digits, text focus preservation, current handlers/keyed reorder, disabled/ancestor gates, bounded hosts, atomic validation, shortcut removal, sheet/root isolation and 20 owner lifetimes without desktop activation');
