import { Button, Component, HStack, State, Text, TextEditor, TextField, VStack, runApp } from 'jonui';
import type { FocusAvailability } from 'jonui';

const name = State('Jonathan Swift'), notes = State('');
const Form = Component(scope => {
  const nameFocus = scope.focusBoolean(true), notesFocus = scope.focusBoolean();
  const availability = scope.state('Notes availability has not been checked');
  const observed = scope.state<FocusAvailability | 'retired' | 'waiting'>('waiting');
  scope.effect(() => {
    if (notesFocus.retired.value) { observed.value = 'retired'; return; }
    return notesFocus.subscribeAvailability(value => { observed.value = value; });
  });
  return () => VStack([
    Text('Independent boolean focus').font('headline'),
    TextField('Name — Return requests Notes', { text: name.binding, onSubmit: () => notesFocus.request(true) }).focused(nameFocus.binding),
    TextEditor({ text: notes.binding }).frame({ height: 120 }).focused(notesFocus.binding),
    HStack([
      Button('Request Name', () => nameFocus.request(true)),
      Button('Request Notes', () => { notesFocus.desired.value = true; }),
      Button('Clear Notes', () => notesFocus.request(false)),
      Button('Check Notes', () => { availability.value = `Notes availability: ${notesFocus.availability() ?? 'inactive'}`; }),
    ]),
    Text(`Name: desired ${nameFocus.desired.value}, actual ${nameFocus.actual.value}`).font('caption'),
    Text(`Notes: desired ${notesFocus.desired.value}, actual ${notesFocus.actual.value}`).font('caption'),
    Text(availability.value).font('caption'),
    HStack([Button('Resume sessions', () => { nameFocus.resume(); notesFocus.resume(); }), Text(`Observed Notes: ${observed.value}`).font('caption')]),
    Text('Moving focus updates actual state. Clear Notes leaves Name alone. Request retries; equal desired writes do not.').font('caption'),
  ], { alignment: 'leading', spacing: 12 }).padding(20);
});
await runApp({ title: 'JonUI boolean focus', width: 620, height: 450, content: Form() });
