import { Component, State, Text, runApp } from 'jonui';
const mode = process.env.JONUI_CASE;
const input = State(0);
const Child = Component(scope => {
  scope.state('owned');
  scope.onDispose(() => console.log('SCOPE_DISPOSE'));
  scope.effect(() => () => console.log('OTHER_EFFECT_CLEANUP'));
  scope.effect(() => {
    input.value;
    if (mode === 'body') throw new Error('intentional effect body failure');
    if (mode === 'cycle') { input.value++; return; }
    if (mode === 'async-body') return Promise.resolve();
    return () => {
      if (mode === 'async-cleanup') return Promise.resolve();
      throw new Error('intentional effect cleanup failure');
    };
  });
  return () => Text('Effect failure fixture');
});
const app = runApp({ title: 'JonUI effect error test', width: 400, height: 300, content: Child() });
if (mode === 'cleanup' || mode === 'async-cleanup') setTimeout(() => { input.value++; }, 30);
await app;
