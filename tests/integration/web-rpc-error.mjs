import { Component, State, Text, View, WebView, WebRequest, runApp } from 'jonui';
const shown = State(true), revision = State(0);
const Owner = Component(scope => {
  scope.state('owned'); scope.onDispose(() => console.log('RPC_SCOPE_DISPOSE'));
  return () => WebView({ html: `<script>jonui.remote().hold().catch(() => {})</script><!-- ${revision.value} -->`, api: {
    async hold() {
      WebRequest.current.onCancel(() => { throw new Error('RPC cancellation cleanup failed'); });
      setTimeout(() => { if (process.env.JONUI_CASE === 'reload') revision.value++; else shown.value = false; }, 20);
      await new Promise(() => {});
    },
  } });
});
await runApp({ title: 'RPC cleanup failure', width: 400, height: 300, content: View(() => shown.value ? Owner() : Text('hidden')), onStop: () => console.log('RPC_STOP') });
