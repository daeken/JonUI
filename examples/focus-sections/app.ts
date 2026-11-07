import { HStack, SecureField, State, Text, TextField, View, VStack, runApp } from 'jonui';

const first = State('Jonathan'), last = State('Swift'), secret = State(''), confirmation = State('');
const active = State('Click a field, then press Tab or Shift-Tab.');
const editing = (label: string) => (focused: boolean) => {
  if (focused) active.value = `Editing ${label}`;
  else if (active.value === `Editing ${label}`) active.value = 'No text input focused';
};

await runApp({ title: 'JonUI native focus sections', width: 620, height: 300, content: VStack([
  Text('Tab visits both fields in a column before the next column.').font('headline'),
  HStack([
    VStack([
      Text('Profile'),
      TextField('First name', { text: first.binding, onEditingChanged: editing('first name') }),
      TextField('Last name', { text: last.binding, onEditingChanged: editing('last name') }),
    ], { alignment: 'leading', spacing: 12 }).frame({ width: 260 }).focusSection(),
    VStack([
      Text('Demo credentials'),
      SecureField('Secret', { text: secret.binding, onEditingChanged: editing('secret') }),
      SecureField('Confirm secret', { text: confirmation.binding, onEditingChanged: editing('confirmation') }),
    ], { alignment: 'leading', spacing: 12 }).frame({ width: 260 }).focusSection(),
  ], { spacing: 28 }),
  View(() => Text(active.value)),
  View(() => Text(`${first.value} ${last.value}; demo secret lengths: ${secret.value.length} / ${confirmation.value.length}`)),
], { alignment: 'leading', spacing: 20 }).padding(20) });
