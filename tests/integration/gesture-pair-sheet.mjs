import assert from 'node:assert/strict';
import { Component, State, TapGesture, SpatialTapGesture, Text, runApp, __testing as test } from 'jonui';
const presented = State(false), count = State(2); const events = []; let setups = 0, disposals = 0, hits;
const Owner = Component(scope => {
  setups++; hits = scope.state(0); scope.onDispose(() => disposals++);
  return () => test.gesturePair(Text('Sheet pair').frame({ width: 260, height: 80 }).contentShape('rectangle'), SpatialTapGesture(), TapGesture({ count: count.value }), value => { hits.value++; events.push(value); });
});
const app = runApp({ title: 'Pair sheet ownership', width: 420, height: 280, content: Text('Base').sheet({ isPresented: presented.binding, content: Owner() }) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), snapshot = () => test.request('debug.snapshot'), node = () => snapshot().nodes.find(n => n.props.dispatch);
async function until(predicate, label) {
  const end = Date.now() + 10000;
  do { const c = test.request('debug.focusContext'); assert.equal(c.active, false); assert.equal(c.activeKey, false); assert.equal(c.mainKey, false); assert.equal(c.alpha, 0);
    if (predicate()) return; await sleep(5);
  } while (Date.now() < end); assert.fail(`Timed out ${label}`);
}
const ready = () => test.request('debug.focusContext').sheet && test.pairStats().armed === 1 && test.request('debug.layoutSurfaces').surfaces.some(s => s.current && s.frames.some(f => f.id === node()?.id));
async function click(wait = 650) {
  await until(ready, 'sheet ready'); const tap = test.request('debug.tap', { id: node().id, command: true });
  await until(() => test.request('debug.tapResult', { id: tap.id }).done, 'sheet release'); await sleep(wait);
}
presented.value = true; test.flush(); await until(ready, 'first presentation'); const initial = node(); await click(); assert.equal(events.length, 1); assert.equal(events[0].second, null);
await click(10); assert.equal(events.length, 1); presented.value = false; test.flush();
await until(() => !test.request('debug.focusContext').sheet && snapshot().pairDispatchArmOwners === 0, 'dismiss pending'); await sleep(650); assert.equal(events.length, 1);
presented.value = true; test.flush(); await until(ready, 're-entry'); assert.equal(node().id, initial.id); assert.notEqual(node().props.epoch, initial.props.epoch); assert.equal(setups, 1); assert.equal(hits.value, 1);
count.value = 1; test.flush(); await until(ready, 'new count'); await click(60); assert.equal(events.length, 2); assert.equal(events[1].second.kind, 'tap');
presented.value = false; test.flush(); await until(() => !test.request('debug.focusContext').sheet && snapshot().pairDispatchArmOwners === 0, 'dismiss');
assert.equal(disposals, 0); assert.equal(snapshot().pairDispatchPendingCount, 0); test.request('debug.close'); await app; assert.equal(disposals, 1);
assert.equal(snapshot().liveViews, 0); assert.equal(snapshot().liveCells, 0); assert.equal(snapshot().pairDispatchArmOwners, 0); assert.equal(snapshot().pairDispatchPendingCount, 0); assert.deepEqual(test.pairStats(), { active: 0, armed: 0 });
console.log('PASS pair sheet: delayed partial result canceled by native disappearance, new epoch on retained owner re-entry, frozen full values and cleanup without activation');
