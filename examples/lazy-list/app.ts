import { Button, Component, ForEach, HStack, LazyVStack, ScrollView, State, Text, TextField, View, VStack, runApp } from 'jonui';
const ids = State(Array.from({ length: 250 }, (_, id) => id));
const Row = Component<number>((scope, id) => {
  const note = scope.state(`Note ${id}`), count = scope.state(0);
  return () => HStack([
    Text(`Row ${id}`).frame({ width: 70 }),
    TextField('Note', { text: note.binding }),
    Button(`Count: ${count.value}`, () => { count.value++; }),
    Button('Remove', () => { ids.value = ids.value.filter(value => value !== id); }),
  ]).padding(8).frame({ height: 50 });
});
await runApp({ title: 'JonUI lazy rows', width: 650, height: 500, content: VStack([
  Button('Reverse rows', () => { ids.value = [...ids.value].reverse(); }),
  View(() => Text(`${ids.value.length} rows; notes and counts follow their keyed row.`)),
  ScrollView(LazyVStack([
    View(() => ForEach(ids.value, { id: id => id }, id => Row(id))),
  ], { alignment: 'leading', spacing: 4 })),
], { spacing: 8 }).padding(12) });
