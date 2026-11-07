import { Component, Focus, TextField, runApp, __testing as test } from 'jonui';
const Panel = Component(scope => {
  const value = scope.state(''); scope.onDispose(() => console.log('FOCUS_SCOPE_DISPOSE'));
  scope.effect(() => Focus.subscribe(name => { if (name === 'name') throw new Error('intentional focus listener failure'); }));
  return () => TextField('Name', { text: value.binding, focusName: 'name' });
});
const app = runApp({ title: 'JonUI focus listener failure', width: 400, height: 200, content: Panel(), onStop: () => console.log('FOCUS_STOP') });
app.catch(() => {});
while (!test.focusStats().watching) await new Promise(resolve => setTimeout(resolve, 10));
Focus.clear(); await new Promise(resolve => setTimeout(resolve, 30)); Focus.requestNamed('name'); await app;
