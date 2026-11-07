import { Button, Component, Picker, Text, Toggle, VStack, runApp } from 'jonui';

const Demo = Component(scope => {
  const singles = scope.state(0), doubles = scope.state(0), actions = scope.state(0), taps = scope.state(0), disabled = scope.state(false);
  const priority = scope.state<'normal' | 'high' | 'simultaneous'>('normal');
  return () => VStack([
    Text('Native SwiftUI taps').font('headline'),
    Picker('Priority', { selection: priority.binding, options: [
      { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'simultaneous', label: 'Together' },
    ], style: 'segmented' }),
    Button(`Button actions: ${actions.value} · outer taps: ${taps.value}`, () => { actions.value++; })
      .onTapGesture(() => { taps.value++; }, { priority: priority.value }).disabled(disabled.value),
    Toggle('Disable Button', { isOn: disabled.binding }),
    Text(`Single taps: ${singles.value}`).padding(20).onTapGesture(() => { singles.value++; }),
    Text(`Double taps: ${doubles.value}`).padding(20).onTapGesture(() => { doubles.value++; }, { count: 2 }),
  ], { spacing: 20 })
    .padding(20);
});
await runApp({ title: 'JonUI native taps', width: 540, height: 420, content: Demo() });
