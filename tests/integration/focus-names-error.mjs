import assert from 'node:assert/strict';
import { Component, DatePicker, Picker, Stepper, TextField, VStack, WebView, runApp, __testing as test } from 'jonui';
let disposed = 0, stopped = 0;
const Owner = Component(scope => {
  const text = scope.state('owned'), date = scope.state(0); scope.onDispose(() => { disposed++; });
  return () => VStack([
    TextField('Duplicate', { text: text.binding, focusName: 'duplicate' }),
    process.env.JONUI_CASE === 'date' ? DatePicker('Duplicate', { selection: date.binding, focusName: 'duplicate' }) :
      process.env.JONUI_CASE === 'stepper' ? Stepper('Duplicate', { value: date.binding, focusName: 'duplicate' }) :
      process.env.JONUI_CASE === 'picker' ? Picker('Duplicate', { selection: text.binding, options: [{ value: 'owned', label: 'Owned' }], focusName: 'duplicate' }) :
      WebView({ html: '<input>', focusName: 'duplicate', onMessage: () => {}, onError: () => {} }),
  ]);
});
try {
  await runApp({ title: 'Duplicate focus name startup', width: 400, height: 300, content: Owner(), onStop: () => { stopped++; } });
  assert.fail('Duplicate focus names must fail startup');
} catch (error) {
  assert.match(error.message, /Duplicate focus name/); assert.equal(disposed, 1); assert.equal(stopped, 1);
  assert.deepEqual(test.stats(), { actions: 0, cells: 0, dependencies: 0 });
  const native = test.request('debug.snapshot'); assert.equal(native.liveCells, 0); assert.equal(native.liveViews, 0); assert.equal(native.nodes.length, 0);
  console.log('NAMES_FAILURE_CLEANUP'); throw error;
}
