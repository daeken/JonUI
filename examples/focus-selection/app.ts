import { Button, Component, HStack, State, Text, TextEditor, TextField, VStack, runApp } from 'jonui';
import type { FocusAvailability } from 'jonui';

const first = State('Jonathan'), second = State('Swift'), notes = State('');
const label = (id: 1 | '1' | 'notes' | null) => id === null ? 'none' : `${typeof id}:${id}`;
const Form = Component(scope => {
  const focus = scope.focusSelection([1, '1', 'notes'], 1);
  const availability = scope.state('Notes availability has not been checked');
  const observed = scope.state<FocusAvailability | 'retired' | 'waiting'>('waiting');
  scope.effect(() => {
    if (focus.retired.value) { observed.value = 'retired'; return; }
    return focus.subscribeAvailability('notes', value => { observed.value = value; });
  });
  return () => VStack([
    Text('Typed focus selection').font('headline'),
    TextField('First — numeric ID 1', { text: first.binding, onSubmit: () => focus.request('1') }).focused(focus.binding(1)),
    TextField('Last — string ID "1"', { text: second.binding, onSubmit: () => focus.request('notes') }).focused(focus.binding('1')),
    TextEditor({ text: notes.binding }).frame({ height: 110 }).focused(focus.binding('notes')),
    HStack([
      Button('First', () => focus.request(1)), Button('Last', () => focus.request('1')),
      Button('Notes', () => focus.request('notes')), Button('Clear', () => focus.request(null)),
      Button('Resume here', () => focus.resume()),
    ]),
    Text(`Desired: ${label(focus.desired.value)}; actual: ${label(focus.actual.value)}`).font('caption'),
    Button('Check Notes availability', () => { availability.value = `Notes availability: ${focus.availability('notes') ?? 'inactive'}`; }),
    Text(availability.value).font('caption'),
    Text(`Observed Notes: ${observed.value}`).font('caption'),
    Text('Tab and clicks update actual selection without rewriting intent. Number 1 and string "1" are distinct.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).padding(20);
});
await runApp({ title: 'JonUI typed focus selection', width: 650, height: 490, content: Form() });
