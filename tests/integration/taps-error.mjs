import { Component, Text, runApp, __testing as test } from 'jonui';
const mode = process.env.JONUI_CASE;
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => console.log('TAP_DISPOSE'));
  return () => Text('Fail').onTapGesture(() => {
    if (mode === 'promise') return Promise.reject(new Error('consumed tap rejection'));
    throw new Error('intentional tap failure');
  });
});
const app = runApp({ title: 'Tap failure', width: 400, height: 220, content: Owner(), onStop: () => console.log('TAP_STOP') });
await new Promise(r => setTimeout(r, 100));
const node = test.request('debug.snapshot').nodes.find(n => n.props.tap); test.request('debug.tap', { id: node.id });
await app;
