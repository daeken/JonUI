import assert from 'node:assert/strict';
import { Component, ForEach, LazyVStack, ScrollView, State, Text, View, WebView, runApp, __testing as test } from 'jonui';
const shown = State(true), keep = State(true); let messages = 0, disposals = 0;
const Browser = Component(scope => {
  const count = scope.state(0); scope.onDispose(() => { disposals++; });
  return () => WebView({ html: '<script>setInterval(() => jonui.postMessage("tick"), 20)</script>',
    data: count.value, onMessage: () => { messages++; count.value++; }, onError: error => { throw new Error(error); },
  }).frame({ height: 80 });
});
const app = runApp({ title: 'JonUI lazy WebView cleanup', width: 400, height: 300, content: View(() => shown.value ?
  ScrollView(LazyVStack([
    View(() => keep.value ? Browser() : Text('removed').frame({ height: 80 })),
    ForEach(Array.from({ length: 80 }, (_, id) => id), { id: id => id }, id => Text(`Row ${id}`).frame({ height: 40 })),
  ], { spacing: 4 })).frame({ width: 300, height: 180 }) : Text('hidden')) });
const snapshot = () => test.request('debug.snapshot');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const deadline = Date.now() + 6000;
  do { const s = snapshot(); if (predicate(s)) return s; await sleep(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}; ${JSON.stringify({ counts: test.stats(), messages, snapshot: snapshot() })}`);
}
const native = await until(s => s.states.length === 3 && messages >= 2, 'real lazy WKWebView timers and bridge');
const browser = native.nodes.find(n => n.kind === 'webview');
test.request('debug.scroll', { index: 0, x: 0, y: 3000 }); await sleep(50);
keep.value = false; test.flush();
await until(s => s.states.length === 2 && s.liveCells === 2 && s.liveViews === s.nodes.length && test.stats().actions === 0, 'offscreen browser and owned state teardown');
assert.equal(disposals, 1);
assert.throws(() => test.request('debug.web', { id: browser.id }), /Unknown WebView/);
assert.throws(() => test.request('debug.web.evaluate', { id: browser.id, script: 'jonui.postMessage("late")' }), /Unknown WebView/);
const stoppedAt = messages; await sleep(80); assert.equal(messages, stoppedAt);
shown.value = false;
await until(s => s.liveCells === 2 && s.liveViews === s.nodes.length, 'lazy browser container removal');
test.request('debug.close'); await app;
assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(snapshot().liveCells, 0);
console.log('PASS lazy WebView: actual WK document timers, offscreen logical removal retires native coordinator/document and scoped state, late browser operations rejected, baseline view/cell/callback counts');
