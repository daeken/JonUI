import { Button, DatePicker, Focus, Form, Picker, Section, SecureField, Slider, State, Stepper, Text, TextField, Toggle, View, runApp } from 'jonui';
const name = State<string>('JonUI'), percentage = State<boolean>(false), amount = State<number>(0.5);
const theme = State<'system' | 'light' | 'dark'>('system');
const secret = State<string>(''), status = State<string>('Press Return in a text field to submit.');
const editing = State<string>('');
const editingChanged = (label: string) => (active: boolean) => {
  if (active) editing.value = label;
  else if (editing.value === label) editing.value = '';
};
const submitted = () => { status.value = `Submitted ${name.value}; demo secret length: ${secret.value.length}`; };
const appointment = State<number>(Date.UTC(2026, 10, 7, 18, 30));
await runApp({ title: 'JonUI native form', width: 600, height: 400, content: Form([
  Section('Profile', [TextField('Name', { text: name.binding, onSubmit: submitted, onEditingChanged: editingChanged('name') }),
    SecureField('Demo secret', { text: secret.binding, onSubmit: submitted, onEditingChanged: editingChanged('demo secret') }),
    View(() => Text(editing.value ? `Editing ${editing.value}` : 'No text input focused')),
    View(() => Text(status.value)), Toggle('Show as percentage', { isOn: percentage.binding })]),
  Section('Appearance', [Picker('Theme', { selection: theme.binding, options: [
    { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
  ], style: 'segmented', focusName: 'theme' }), View(() => Text(`Selected theme: ${theme.value}`)),
    Button('Focus theme', () => { status.value = Focus.requestNamed('theme') ? 'Theme focused' : 'Theme unavailable for keyboard focus'; })]),
  Section('Schedule', [DatePicker('Appointment (UTC)', { selection: appointment.binding, focusName: 'appointment', components: 'dateAndTime', style: 'compact', timeZone: 'UTC' }),
    Button('Focus appointment', () => { status.value = Focus.requestNamed('appointment') ? 'Appointment focused' : 'Appointment unavailable'; }),
    View(() => Text(new Date(appointment.value).toISOString()))]),
  Section('Shared numeric value', [
    Slider('Amount', { value: amount.binding, min: 0, max: 1, step: 0.05 }),
    Stepper('Amount', { value: amount.binding, min: 0, max: 1, step: 0.05, focusName: 'amount' }),
    Button('Focus amount', () => { status.value = Focus.requestNamed('amount') ? 'Amount focused' : 'Amount unavailable for keyboard focus'; }),
    View(() => Text(`${name.value}: ${percentage.value ? `${(amount.value * 100).toFixed(0)}%` : amount.value.toFixed(2)}`)),
  ], { footer: 'The slider and stepper share one revision-ordered native binding.' }),
], { style: 'grouped' }) });
