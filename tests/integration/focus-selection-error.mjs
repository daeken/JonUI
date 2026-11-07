import assert from 'node:assert/strict';
import { Component, TextField, VStack, WebView, runApp, __testing as test } from 'jonui';
let disposed = 0, stopped = 0;
const Owner = Component(scope => {
  const focus = scope.focusSelection([1], 1), text = scope.state('owned');
  scope.onDispose(() => { disposed++; });
  return () => VStack([
    TextField('Duplicate selection', { text: text.binding }).focused(focus.binding(1)),
    WebView({ html: '<input>', api: { ping: () => true } }).focused(focus.binding(1)),
  ]);
});
try {
  await runApp({ title: 'Duplicate selection startup', width: 400, height: 300, content: Owner(), onStop: () => { stopped++; } });
  assert.fail('Duplicate selection binding must fail startup');
} catch (error) {
  assert.match(error.message, /Duplicate focus name/); assert.equal(disposed, 1); assert.equal(stopped, 1);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(test.focusStats(), { listeners: 0, watching: false });
  const native = test.request('debug.snapshot'); assert.equal(native.liveCells, 0); assert.equal(native.liveViews, 0); assert.equal(native.nodes.length, 0);
  console.log('SELECTION_FAILURE_CLEANUP'); throw error;
}
