import { Button, Component, runApp, __testing as test } from 'jonui';
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => console.log('SHORTCUT_DISPOSE'));
  return () => Button('Fail', () => { throw new Error('intentional shortcut action failure'); }).keyboardShortcut('k');
});
const app = runApp({ title: 'Shortcut failure', width: 400, height: 220, content: Owner(), onStop: () => console.log('SHORTCUT_STOP') });
await new Promise(resolve => setTimeout(resolve, 80)); test.request('debug.shortcut', { key: 'k' }); await app;
