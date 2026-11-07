import assert from 'node:assert/strict';
import { Component, Focus, ForEach, LazyVStack, ScrollView, State, Text, TextField, View, runApp, __testing as test } from 'jonui';
const ids = State(Array.from({ length: 80 }, (_, id) => id)), shown = State(true);
const models = new Map(); let disposals = 0;
const Row = Component((scope, id) => {
  const value = scope.state(`row-${id}`); models.set(id, value); scope.onDispose(() => { disposals++; });
  return () => TextField(`Row ${id}`, { text: value.binding }).frame({ height: 48 });
});
const app = runApp({ title: 'JonUI captured lazy responder lifetime', width: 400, height: 300, content: View(() => shown.value ?
  ScrollView(LazyVStack([View(() => ForEach(ids.value, { id: id => id }, id => Row(id)))], { spacing: 4 })).frame({ width: 300, height: 180 }) : Text('hidden')) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot');
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(); assert.equal(test.request('debug.focusStatus').key, false); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), handles: test.request('debug.focusHandles') })}`);
}
await until(s => s.states.length === 82 && test.request('debug.fields').fields.length > 0, 'partially realized lazy fields');
Focus.next(); const first = Focus.capture(); assert.ok(first);
assert.deepEqual(test.request('debug.focusHandles'), { targets: 1, live: 1 });
assert.equal(Focus.request(first), true);
assert.equal(Focus.setTraversal([first], { tabNavigation: true }), true);
const oldState = models.get(0), oldID = oldState.binding.id;
ids.value = ids.value.filter(id => id !== 0); test.flush();
await until(s => s.states.length === 81 && s.liveCells === 81 && s.liveViews === s.nodes.length, 'focused row removal releases logical scope');
assert.equal(disposals, 1); assert.equal(Focus.request(first), false);
assert.equal(test.request('debug.focusTraversal').count, 0);
assert.equal(test.request('debug.focusTraversal').tabNavigation, false);
assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 });
assert.throws(() => test.request('debug.write', { id: oldID, value: 'late' }), /Unknown test state/);
Focus.clear(); Focus.next(); const second = Focus.capture(); assert.ok(second); assert.equal(Focus.request(second), true);
assert.equal(Focus.setTraversal([second], { tabNavigation: true }), true);
test.request('debug.scroll', { index: 0, x: 0, y: 3000 }); await sleep(30);
ids.value = []; test.flush();
await until(s => s.states.length === 2 && s.liveCells === 2 && s.liveViews === s.nodes.length, 'all cached rows retire');
assert.equal(disposals, 80); assert.equal(Focus.request(second), false); assert.equal(Focus.request(first), false);
assert.equal(test.request('debug.focusTraversal').count, 0);
assert.equal(test.request('debug.focusTraversal').tabNavigation, false);
assert.deepEqual(test.request('debug.focusHandles'), { targets: 0, live: 0 });
shown.value = false;
await until(s => s.liveViews === s.nodes.length && test.request('debug.fields').fields.length === 0, 'cached control teardown');
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS lazy captured targets: weak first-responder registration, focused row removal, expired handle rejection, scroll/cache retirement and baseline native cells/views/registrations');
