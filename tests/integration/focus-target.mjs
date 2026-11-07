import assert from 'node:assert/strict';
import { Component, Focus, ForEach, SecureField, State, Text, TextEditor, TextField, View, VStack, runApp, __testing as test } from 'jonui';
assert.throws(Focus.capture, /mounted window/);
const shown = State(true), reversed = State(false), extra = State(false);
let plain, setups = 0, disposals = 0;
const Panel = Component(scope => {
  setups++; plain = scope.state('name'); const secret = scope.state('dummy'), note = scope.state('notes');
  scope.onDispose(() => { disposals++; });
  return () => VStack([
    ForEach(reversed.value ? ['editor', 'secure', 'plain'] : ['plain', 'secure', 'editor'], { id: id => id }, kind => {
      const options = { text: (kind === 'plain' ? plain : kind === 'secure' ? secret : note).binding };
      return kind === 'editor' ? TextEditor(options).frame({ height: 100 }) : kind === 'secure' ? SecureField('Demo secret', options) : TextField(`Name (${plain.value.length})`, options);
    }),
    ...(extra.value ? [Text('Unrelated structural addition')] : []),
  ]);
});
const app = runApp({ title: 'JonUI opaque native focus targets', width: 600, height: 350, content: View(() => shown.value ? Panel() : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot'), status = () => test.request('debug.focusStatus'), fields = () => test.request('debug.fields').fields;
const handles = () => test.request('debug.focusHandles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const index = secure => fields().find(f => f.secure === secure).index;
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(), f = status(); assert.equal(f.key, false); if (predicate(s, f)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ status: status(), handles: handles(), counts: test.stats() })}`);
}
await until(s => s.states.length === 6 && fields().length === 2 && test.request('debug.editors').count === 1, 'actual native controls');
Focus.clear(); assert.equal(Focus.capture(), null);
Focus.next(); await until((s, f) => f.fields[0] === index(false), 'capture plain field');
const nameTarget = Focus.capture(); assert.ok(nameTarget); assert.ok(Object.isFrozen(nameTarget)); assert.deepEqual(Object.keys(nameTarget), []);
for (let i = 0; i < 50; i++) assert.ok(Focus.capture());
assert.deepEqual(handles(), { targets: 1, live: 1 }, 'repeat capture reuses one weak native registration');
Focus.next(); await until((s, f) => f.fields[0] === index(true), 'capture secure field'); const secretTarget = Focus.capture(); assert.ok(secretTarget);
Focus.next(); await until((s, f) => f.editors[0] === 0, 'capture multiline editor'); const noteTarget = Focus.capture(); assert.ok(noteTarget);
assert.deepEqual(handles(), { targets: 3, live: 3 });
assert.equal(Focus.request(nameTarget), true); await until((s, f) => f.fields[0] === index(false), 'request captured plain target');
test.request('debug.field', { index: index(false), value: 'Captured 🦊 café' });
await until(() => plain.value === 'Captured 🦊 café', 'value and label update');
assert.deepEqual(handles(), { targets: 3, live: 3 });
assert.equal(Focus.request(secretTarget), true); assert.equal(status().fields[0], index(true));
assert.equal(Focus.request(noteTarget), true); assert.deepEqual(status().editors, [0]);
reversed.value = true; test.flush(); await sleep(30);
assert.deepEqual(handles(), { targets: 3, live: 3 }, 'keyed reordering keeps physical captures valid');
Focus.clear(); assert.equal(Focus.request(nameTarget), true); assert.equal(status().fields[0], index(false));
assert.equal(plain.value, 'Captured 🦊 café');
for (let i = 0; i < 20; i++) {
  assert.equal(Focus.request(secretTarget), true); assert.equal(Focus.request(noteTarget), true); assert.equal(Focus.request(nameTarget), true); Focus.clear();
}
await sleep(30); assert.deepEqual(status().fields, []); assert.deepEqual(status().editors, []);
for (const target of [true, 0, -1, 1.5, 'id', null]) assert.throws(() => test.request('focus.target', { target }), /Invalid focus target/);
assert.deepEqual(test.request('focus.target', { target: 999999 }), { focused: false });
assert.deepEqual(handles(), { targets: 3, live: 3 });
const current = snapshot().nodes, frame = current.find(n => n.props.name === 'frame');
assert.throws(() => test.request('commit', { nodes: [{ ...frame, props: { name: 'frame', height: -1 } }] }));
assert.deepEqual(handles(), { targets: 3, live: 3 }, 'rejected transactions do not invalidate captures');
assert.equal(Focus.request(nameTarget), true);
extra.value = true; test.flush();
await until(() => handles().targets === 0, 'structural changes retire all captures conservatively');
assert.equal(Focus.request(nameTarget), false); assert.equal(Focus.request(secretTarget), false); assert.equal(Focus.request(noteTarget), false);
const renewed = Focus.capture(); assert.ok(renewed); assert.equal(Focus.request(renewed), true);
extra.value = false; test.flush(); await until(() => handles().targets === 0, 'second structural invalidation');
assert.equal(Focus.request(renewed), false);
const beforeRemoval = Focus.capture(); assert.ok(beforeRemoval);
shown.value = false;
await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0 && test.request('debug.editors').count === 0, 'captured control removal does not retain cells or native views');
assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(Focus.request(beforeRemoval), false); assert.equal(Focus.capture(), null);
const baseline = test.stats();
for (let i = 0; i < 20; i++) {
  shown.value = true;
  await until(s => s.states.length === 6 && fields().length === 2, `target mount ${i}`);
  Focus.next(); await until((s, f) => f.fields.length || f.editors.length, `target focus ${i}`);
  const target = Focus.capture(); assert.ok(target); assert.equal(Focus.request(target), true);
  assert.deepEqual(handles(), { targets: 1, live: 1 });
  shown.value = false;
  await until(s => s.states.length === 3 && s.liveCells === 3 && s.liveViews === s.nodes.length && fields().length === 0, `target unmount ${i}`);
  assert.deepEqual(handles(), { targets: 0, live: 0 }); assert.equal(Focus.request(target), false); assert.equal(Focus.request(nameTarget), false);
  assert.deepEqual(test.stats(), baseline);
}
assert.equal(setups, 21); assert.equal(disposals, setups);
test.request('debug.close'); await app; assert.equal(Focus.capture(), null); assert.equal(Focus.request(nameTarget), false);
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS opaque focus targets: exact plain/secure/editor first responders, bounded weak registrations, native input and label/keyed updates, rapid request/clear ordering, atomic invalid handles, structural invalidation and 20 focused capture/unmount cycles');
