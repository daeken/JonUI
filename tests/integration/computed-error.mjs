import { Component, State, Text, runApp } from 'jonui';
const mode = process.env.JONUI_CASE;
const input = State(0);
const Child = Component(scope => {
  scope.state('owned');
  scope.onDispose(() => console.log('SCOPE_DISPOSE'));
  scope.effect(() => () => console.log('OTHER_EFFECT_CLEANUP'));
  const value = scope.computed(() => {
    if (input.value === 0) return 'initial';
    if (mode === 'body') throw new Error('intentional computed failure');
    if (mode === 'cycle') return value.value;
    if (mode === 'async') return Promise.resolve('invalid');
    if (mode === 'mutation') { input.value++; return 'invalid'; }
    return new Date();
  });
  scope.effect(() => { value.value; });
  return () => Text('Computed failure fixture');
});
const app = runApp({ title: 'JonUI computed error test', width: 400, height: 300, content: Child() });
setTimeout(() => { input.value++; }, 30);
await app;
