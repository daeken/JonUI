import { Component, Text, VStack, runApp } from 'jonui';

const Demo = Component(scope => {
  const singles = scope.state(0), doubles = scope.state(0);
  return () => VStack([
    Text('Native SwiftUI taps').font('headline'),
    Text(`Single taps: ${singles.value}`).padding(20).onTapGesture(() => { singles.value++; }),
    Text(`Double taps: ${doubles.value}`).padding(20).onTapGesture(() => { doubles.value++; }, { count: 2 }),
  ], { spacing: 20 })
    .padding(20);
});
await runApp({ title: 'JonUI native taps', width: 440, height: 300, content: Demo() });
