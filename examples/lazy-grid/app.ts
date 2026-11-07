import { Button, Component, ForEach, HStack, LazyVGrid, ScrollView, State, Text, TextField, View, VStack, runApp } from 'jonui';
import type { GridItem } from 'jonui';
const ids = State(Array.from({ length: 120 }, (_, id) => id));
const adaptive = State(true);
const Card = Component<number>((scope, id) => {
  const note = scope.state(`Card ${id}`), count = scope.state(0);
  return () => VStack([
    Text(`Card ${id}`).font('headline'),
    TextField('Note', { text: note.binding }),
    HStack([
      Button(`Count: ${count.value}`, () => { count.value++; }),
      Button('Remove', () => { ids.value = ids.value.filter(value => value !== id); }),
    ]),
  ], { alignment: 'leading', spacing: 8 }).padding(8)
    .frame({ minWidth: 0, maxWidth: 'infinity' }).frame({ height: 110 });
});
await runApp({ title: 'JonUI lazy grid', width: 720, height: 520, content: VStack([
  HStack([
    Button('Toggle adaptive / mixed tracks', () => { adaptive.value = !adaptive.value; }),
    Button('Reverse cards', () => { ids.value = [...ids.value].reverse(); }),
  ]),
  View(() => Text(`${ids.value.length} cards; ${adaptive.value ? 'adaptive columns' : 'fixed and flexible columns'}`)),
  ScrollView(View(() => {
    const columns: GridItem[] = adaptive.value ? [{ size: 'adaptive', min: 180, max: 280, spacing: 12 }] :
      [{ size: 'fixed', value: 200, spacing: 12 }, { size: 'flexible', min: 180, max: 'infinity' }];
    return LazyVGrid([
      View(() => ForEach(ids.value, { id: id => id }, id => Card(id))),
    ], { columns, alignment: 'leading', spacing: 12 });
  })),
], { spacing: 10 }).padding(12) });
