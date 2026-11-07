import type { TapLocation } from 'jonui';
import { TapGesture, SpatialTapGesture, LongPressGesture, Button, Component, Picker, Text, Toggle, VStack, runApp } from 'jonui';

const Demo = Component(scope => {
  const singles = scope.state(0), doubles = scope.state(0), actions = scope.state(0), taps = scope.state(0), disabled = scope.state(false);
  const longs = scope.state(0), longActions = scope.state(0), pressing = scope.gestureState(), together = scope.state(true);
  const priority = scope.state<'normal' | 'high' | 'simultaneous'>('normal');
  const point = scope.state<TapLocation>({ x: 0, y: 0 });
  const shape = scope.state<'rectangle' | 'circle' | 'ellipse' | 'capsule'>('rectangle');
  return () => VStack([
    Text('Native SwiftUI gestures').font('headline'),
    Picker('Priority', { selection: priority.binding, options: [
      { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'simultaneous', label: 'Together' },
    ], style: 'segmented' }),
    Button(`Button actions: ${actions.value} · outer taps: ${taps.value}`, () => { actions.value++; })
      .onTapGesture(() => { taps.value++; }, { priority: priority.value }).disabled(disabled.value),
    Toggle('Disable Button', { isOn: disabled.binding }),
    Picker('Hit region', { selection: shape.binding, options: [
      { value: 'rectangle', label: 'Rectangle' }, { value: 'circle', label: 'Circle' },
      { value: 'ellipse', label: 'Ellipse' }, { value: 'capsule', label: 'Capsule' },
    ], style: 'segmented' }),
    Text(`Single taps: ${singles.value}`).padding(20).contentShape(shape.value).gesture(TapGesture().onEnded(() => { singles.value++; })),
    Text(`Double taps: ${doubles.value}`).padding(20).contentShape(shape.value).gesture(TapGesture({ count: 2 }).onEnded(() => { doubles.value++; })),
    Text(`Local tap: ${point.value.x.toFixed(1)}, ${point.value.y.toFixed(1)}`)
      .frame({ width: 360, height: 80 }).contentShape(shape.value)
      .gesture(SpatialTapGesture().onEnded(location => { point.value = location; }), { priority: priority.value }),
    Toggle('Recognize holds together with Button actions', { isOn: together.binding }),
    Button(`Holds: ${longs.value} · actions: ${longActions.value} · ${pressing.value ? 'pressing' : 'idle'}`, () => { longActions.value++; })
      .frame({ width: 360, height: 60 }).contentShape(shape.value)
      .gesture(LongPressGesture({ pressing }).onEnded(() => { longs.value++; }), { priority: together.value ? 'simultaneous' : 'normal' }),
    Text('Hit shapes change the padded labels’ interaction area without drawing or clipping.').font('caption'),
  ], { spacing: 20 })
    .padding(20);
});
await runApp({ title: 'JonUI native taps', width: 640, height: 680, content: Demo() });
