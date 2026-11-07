import { Component, State, Text, runApp } from 'jonui';
const mode = process.env.JONUI_CASE;
const input = State(0);
const Child = Component(scope => {
  scope.state('owned');
  scope.onDispose(() => console.log('SCOPE_DISPOSE'));
  scope.task(task => {
    const timer = setInterval(() => {}, 1000);
    task.onCancel(() => { clearInterval(timer); console.log('OTHER_TASK_CLEANUP'); });
    return new Promise(() => {});
  });
  scope.task(task => {
    input.value;
    if (mode === 'body') throw new Error('intentional task body failure');
    if (mode === 'rejection') return Promise.reject(new Error('intentional task rejection'));
    if (mode === 'invalid-return') return 42;
    if (mode === 'async-commit') task.commit(async () => {});
    task.onCancel(() => {
      if (mode === 'async-cleanup') return Promise.resolve();
      throw new Error('intentional task cleanup failure');
    });
    return new Promise(() => {});
  });
  return () => Text('Task failure fixture');
});
const app = runApp({ title: 'JonUI task error test', width: 400, height: 300, content: Child() });
if (mode === 'cleanup' || mode === 'async-cleanup') setTimeout(() => { input.value++; }, 30);
await app;
