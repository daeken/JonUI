import { Component, ForEach, LazyVStack, ScrollView, State, Text, TextField, Toggle, View, VStack, runApp } from 'jonui';

const shown = State(true), history = State<string[]>([]);
const record = (phase: string, id: number) => { history.value = [...history.value.slice(-7), `${phase}: row ${id}`]; };
const Row = Component<number>((scope, id) => {
  const text = scope.state(`Editable row ${id}`);
  return () => TextField('Row', { text: text.binding }).frame({ height: 44 })
    .onAppear(() => record('Appeared', id)).onDisappear(() => record('Disappeared', id));
});
await runApp({ title: 'JonUI native appearance signals', width: 540, height: 520, content: VStack([
  Text('Scroll to observe native appearance').font('headline'),
  Toggle('Show list', { isOn: shown.binding }),
  View(() => shown.value ? ScrollView(LazyVStack([
    ForEach(Array.from({ length: 80 }, (_, id) => id), { id: id => id }, id => Row(id)),
  ], { spacing: 4 })).frame({ height: 250 }) : Text('List removed; row scopes are disposed')),
  View(() => Text(history.value.join('\n')).font('caption')),
  Text('Rows keep their text while scrolling. Removing the list starts fresh scopes next time.').font('caption'),
], { alignment: 'leading', spacing: 10 }).padding(16) });
