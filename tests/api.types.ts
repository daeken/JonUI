// Compile-only acceptance of the proposed public API, including invalid bindings.
import { Component, Computed, Button, DatePicker, Focus, ForEach, Form, HStack, LazyHGrid, LazyHStack, LazyVGrid, LazyVStack, List, Picker, ScrollView, Section, SecureField, Slider, Spacer, State, Stepper, Text, TextField, TextEditor, Toggle, View, VStack, WebView, WebRequest } from "jonui";
import type { Alignment, FocusTarget } from 'jonui';
import type { GridItem } from 'jonui';
const columns: readonly GridItem[] = [{ size: 'fixed', value: 80 }, { size: 'flexible', min: 40, max: 'infinity', alignment: 'bottomTrailing' }, { size: 'adaptive', min: 90, max: 150, spacing: 8 }];
LazyVGrid([Text('cell')], { columns, alignment: 'trailing', spacing: 8 });
LazyHGrid([Text('cell')], { rows: columns, alignment: 'bottom', spacing: 8 });
// @ts-expect-error Fixed tracks require a dimension.
LazyVGrid([], { columns: [{ size: 'fixed' }] });
// @ts-expect-error Fixed and bounded sizing options cannot be mixed.
LazyVGrid([], { columns: [{ size: 'fixed', value: 80, min: 20 }] });
// @ts-expect-error Adaptive tracks require a minimum.
LazyHGrid([], { rows: [{ size: 'adaptive' }] });
// @ts-expect-error Grids require cross-axis tracks.
LazyVGrid([]);
// @ts-expect-error Vertical grids define columns.
LazyVGrid([], { rows: columns });
// @ts-expect-error Horizontal grids use vertical alignment.
LazyHGrid([], { rows: columns, alignment: 'leading' });

const enabled = State<boolean>(true);
const title = State<string>("Hello");
const selected = State<string | null>(null);
Button('Next', Focus.next); Button('Previous', Focus.previous); Button('Clear focus', Focus.clear);
Button('Shortcut', () => {}).keyboardShortcut('k');
Button('Wrapped shortcut', () => {}).padding(4).keyboardShortcut('k');
// @ts-expect-error Explicit modifier options are not supported in the initial command-only API.
Button('Invalid shortcut', () => {}).keyboardShortcut('k', { modifiers: ['alt'] });
// @ts-expect-error Shortcut keys are strings.
Button('Invalid key', () => {}).keyboardShortcut(1);
Text('Main').window({ isPresented: enabled.binding, title: 'Owned', width: 400, height: 300, content: Text('Other root') });
// @ts-expect-error Presentation requires a boolean binding.
Text('Main').window({ isPresented: title.binding, title: 'Owned', width: 400, height: 300, content: Text('Other root') });
const directionalMoved: boolean = Focus.move('left'); void directionalMoved;
Focus.move('right'); Focus.move('up'); Focus.move('down');
// @ts-expect-error Spatial directions are distinct from native next/previous traversal.
Focus.move('next');
// @ts-expect-error Spatial direction is required.
Focus.move();
VStack([TextField('Grouped', { text: title.binding })]).focusSection().padding(4);
TextField('Disabled', { text: title.binding }).disabled();
VStack([Button('Action', () => {})]).disabled(enabled.value);
// @ts-expect-error Disabled accepts only a boolean flag.
Text('Invalid').disabled('true');
// @ts-expect-error Native focus sections have no boolean/option argument.
Text('Invalid').focusSection(false);
const savedFocus: FocusTarget | null = Focus.capture();
if (savedFocus) { const focused: boolean = Focus.request(savedFocus); void focused; }
const traversalTargets: readonly FocusTarget[] = savedFocus ? [savedFocus] : [];
const configured: boolean = Focus.setTraversal(traversalTargets); void configured;
Focus.setTraversal(traversalTargets, { tabNavigation: true });
// @ts-expect-error Tab routing is an explicit boolean option.
Focus.setTraversal(traversalTargets, { tabNavigation: 1 });
// @ts-expect-error Traversal targets must be captured handles.
Focus.setTraversal([{}]);
// @ts-expect-error Traversal arrays do not contain null.
Focus.setTraversal([savedFocus]);
// @ts-expect-error Native target handles cannot be forged.
Focus.request({});
// @ts-expect-error Targets must be checked for null.
Focus.request(savedFocus);
// @ts-expect-error Native traversal has no target/index argument.
Focus.next('target');
// @ts-expect-error Native focus commands are read-only.
Focus.clear = () => {};
LazyVStack([Text('one')], { alignment: 'trailing', spacing: 8 });
LazyHStack([Text('one')], { alignment: 'firstTextBaseline', spacing: 8 });
// @ts-expect-error Vertical stacks use horizontal alignment.
LazyVStack([], { alignment: 'top' });
// @ts-expect-error Horizontal stacks use vertical alignment.
LazyHStack([], { alignment: 'leading' });
// @ts-expect-error Lazy stacks use numeric spacing.
LazyVStack([], { spacing: 'infinity' });
Toggle("Enabled", { isOn: enabled.binding });
TextField("Title", { text: title.binding });
List<string>({ selection: selected.binding }, ForEach(
  [{ id: "one" }], { id: item => item.id }, item => Text(item.id).tag(item.id),
));
View(() => Text(title.value).padding());
Button("Rename", () => { title.value = "Updated"; });

// @ts-expect-error Boolean controls cannot bind to text state.
Toggle("Invalid", { isOn: title.binding });
// @ts-expect-error Text fields cannot bind to boolean state.
TextField("Invalid", { text: enabled.binding });
// @ts-expect-error State value writes preserve their type.
title.value = false;
// @ts-expect-error List selection and its binding must use the same ID type.
List<number>({ selection: selected.binding }, Text("Invalid"));
// @ts-expect-error SwiftUI body construction cannot return a Promise.
View(async () => Text("Invalid"));
// @ts-expect-error ForEach identities are stable scalar IDs, not object pointers.
ForEach([{ id: {} }], { id: item => item.id }, () => Text("Invalid"));

TextEditor({ text: title.binding, monospaced: true });
TextField('Named', { text: title.binding, focusName: 'plain' });
SecureField('Named', { text: title.binding, focusName: 'secret' });
TextEditor({ text: title.binding, focusName: 'notes' });
// @ts-expect-error Native focus names are strings.
TextField('Invalid', { text: title.binding, focusName: 1 });
// @ts-expect-error Editor focus names are strings.
TextEditor({ text: title.binding, focusName: false });
TextField('Editing', { text: title.binding, onEditingChanged: editing => { const active: boolean = editing; void active; } });
SecureField('Editing', { text: title.binding, onEditingChanged: editing => { void editing; }, onSubmit: () => {} });
TextEditor({ text: title.binding, onEditingChanged: editing => { const active: boolean = editing; void active; } });
// @ts-expect-error Editing callbacks receive boolean session transitions.
TextField('Invalid', { text: title.binding, onEditingChanged: (text: string) => {} });
// @ts-expect-error Multiline Return inserts a newline; editors have no submit callback.
TextEditor({ text: title.binding, onSubmit: () => {} });
View(() => Text(title.value), { fallback: error => Text(String(error)) });
// @ts-expect-error Multiline editors require string state.
TextEditor({ text: enabled.binding });
// @ts-expect-error Error fallback must return a synchronous View.
View(() => Text("body"), { fallback: async () => Text("invalid") });

WebView({ html: "<button>Custom</button>", data: { value: 1, nested: [true, null] }, onMessage: message => { void message; } });
WebView({ html: '<input>', focusName: 'editor' });
WebView({ html: '<svg></svg>', tabFocusable: false });
// @ts-expect-error Tab eligibility is a boolean flag.
WebView({ html: '', tabFocusable: 0 });
interface PlotPoint { id: string; values: number[] }
const plotAPI = {
  async load(id: string): Promise<PlotPoint> { const signal: AbortSignal = WebRequest.current.signal; void signal; return { id, values: [1, 2] }; },
  select(point: PlotPoint): void { void point; },
};
WebView({ html: '', api: plotAPI });
const plotRemote = window.jonui.remote<typeof plotAPI>();
const remotePoint: Promise<PlotPoint> = plotRemote.load('one'); void remotePoint;
const remoteVoid: Promise<void> = plotRemote.select({ id: 'one', values: [3] }); void remoteVoid;
// @ts-expect-error RPC arguments keep their method types.
plotRemote.load(1);
// @ts-expect-error Remote calls always return Promises.
const synchronousPoint: PlotPoint = plotRemote.load('one'); void synchronousPoint;
// @ts-expect-error API tables expose methods, not properties.
WebView({ html: '', api: { value: 1 } });
// @ts-expect-error Functions cannot be RPC arguments.
WebView({ html: '', api: { call(callback: () => void) { void callback; } } });
// @ts-expect-error Dates are not JSON results.
WebView({ html: '', api: { date: () => new Date() } });
// @ts-expect-error Promise/serialization hooks are reserved method names.
WebView({ html: '', api: { then: () => 1 } });
const namedFocused: boolean = Focus.requestNamed('editor'); void namedFocused;
const currentFocusName: string | null = Focus.currentName(); void currentFocusName;
const stopFocus = Focus.subscribe(name => { const actual: string | null = name; void actual; }); stopFocus();
// @ts-expect-error Focus listeners receive a nullable name.
Focus.subscribe((name: number) => { void name; });
// @ts-expect-error Current native focus is nullable.
const alwaysFocusedName: string = Focus.currentName(); void alwaysFocusedName;
// @ts-expect-error Focus name snapshots take no arguments.
Focus.currentName('editor');
// @ts-expect-error Focus names are strings.
Focus.requestNamed(1);
// @ts-expect-error WebView focus names are strings.
WebView({ html: '', focusName: false });
TextField('Named native input', { text: title.binding, focusName: 'editor' });
// @ts-expect-error WebView data must be JSON, not a function.
WebView({ html: "", data: () => 1 });
// @ts-expect-error WebView expects app-authored HTML.
WebView({ url: "https://example.com" });

const ScopedCounter = Component<{ label: string }>((scope, initial) => {
  const window = Focus.captureWindow();
  if (window) {
    scope.focus(null, { window }); scope.focusBoolean(false, { window }); scope.focusSelection([1, 'one'], 1, { window });
    // @ts-expect-error Physical windows are opaque native identities.
    scope.focus(null, { window: {} });
    // @ts-expect-error A physical window is not a captured responder.
    Focus.request(window);
    // @ts-expect-error Window guards have explicit option names.
    scope.focusBoolean(false, { owner: window });
  }
  const selectionFocus = scope.focusSelection([1, '1', 'editor'], 1);
  const stopRetry: () => void = selectionFocus.retryWhenReady(); void stopRetry;
  // @ts-expect-error Retry uses retained intent, not a new target.
  selectionFocus.retryWhenReady('editor');
  const selectedAvailability: import('jonui').FocusAvailability | null = selectionFocus.availability(1); void selectedAvailability;
  const stopSelected = selectionFocus.subscribeAvailability(1, value => { const status: import('jonui').FocusAvailability = value; void status; }); void stopSelected;
  // @ts-expect-error Subscription IDs cannot widen the domain.
  selectionFocus.subscribeAvailability('other', () => {});
  // @ts-expect-error Null is not a target.
  selectionFocus.subscribeAvailability(null, () => {});
  // @ts-expect-error Subscription callbacks are synchronous.
  selectionFocus.subscribeAvailability(1, async () => {});
  // @ts-expect-error Availability queries cannot widen the selection domain.
  selectionFocus.availability('other');
  // @ts-expect-error Null is not an availability target.
  selectionFocus.availability(null);
  const availability: import('jonui').FocusAvailability | null = Focus.availabilityNamed('target'); void availability;
  const stopAvailability: () => void = Focus.subscribeAvailability('target', value => { const status: import('jonui').FocusAvailability = value; void status; }); void stopAvailability;
  // @ts-expect-error Subscription target names are strings.
  Focus.subscribeAvailability(1, () => {});
  // @ts-expect-error Availability listeners receive status, not a focus name.
  Focus.subscribeAvailability('target', (value: number) => { void value; });
  // @ts-expect-error Listeners must be synchronous.
  Focus.subscribeAvailability('target', async () => {});
  // @ts-expect-error Availability names must be strings.
  Focus.availabilityNamed(1);
  selectionFocus.desired.value = 'editor'; selectionFocus.request(null); selectionFocus.resume();
  TextField('Selected', { text: title.binding }).focused(selectionFocus.binding('1'));
  const selectedID: 1 | '1' | 'editor' | null = selectionFocus.actual.value; void selectedID;
  selectionFocus.desired.subscribe(value => { const id: 1 | '1' | 'editor' | null = value; void id; });
  // @ts-expect-error Initial selection cannot widen the domain.
  scope.focusSelection([1, 'editor'], 'other');
  // @ts-expect-error Selection IDs are strings or finite numbers, not booleans.
  scope.focusSelection([true]);
  // @ts-expect-error Null is reserved for no selection.
  scope.focusSelection([null]);
  // @ts-expect-error Requests stay inside the declared domain.
  selectionFocus.request(2);
  // @ts-expect-error Desired selection stays inside the declared domain.
  selectionFocus.desired.value = 'other';
  // @ts-expect-error A projection requires a declared non-null ID.
  selectionFocus.binding(null);
  // @ts-expect-error Actual selection is readonly.
  selectionFocus.actual.value = 1;
  // @ts-expect-error Selection intent is not a scalar native binding.
  void selectionFocus.desired.binding;
  const booleanFocus = scope.focusBoolean();
  booleanFocus.retryWhenReady()();
  const booleanAvailability: import('jonui').FocusAvailability | null = booleanFocus.availability(); void booleanAvailability;
  booleanFocus.subscribeAvailability(value => { const status: import('jonui').FocusAvailability = value; void status; });
  // @ts-expect-error Boolean subscriptions take no target argument.
  booleanFocus.subscribeAvailability('name', () => {});
  // @ts-expect-error A boolean controller has exactly one opaque target.
  booleanFocus.availability('name');
  scope.focusBoolean(true);
  booleanFocus.desired.value = true; booleanFocus.request(false); booleanFocus.resume();
  const isFocused: boolean = booleanFocus.actual.value; void isFocused;
  booleanFocus.desired.subscribe(value => { const desired: boolean = value; void desired; });
  TextField('Boolean focus', { text: title.binding }).focused(booleanFocus.binding);
  // @ts-expect-error Initial boolean focus cannot be a name.
  scope.focusBoolean('name');
  // @ts-expect-error Boolean focus is non-nullable.
  scope.focusBoolean(null);
  // @ts-expect-error Boolean requests require booleans.
  booleanFocus.request(1);
  // @ts-expect-error Boolean desired state requires booleans.
  booleanFocus.desired.value = 'true';
  // @ts-expect-error Actual boolean focus is readonly.
  booleanFocus.actual.value = true;
  // @ts-expect-error Boolean intent is not a scalar native binding.
  void booleanFocus.desired.binding;
  // @ts-expect-error A boolean controller has one binding, not named projections.
  booleanFocus.binding('name');
  const focus = scope.focus(); focus.desired.value = 'name'; focus.request(null); focus.resume();
  focus.retryWhenReady()();
  const namedAvailability: import('jonui').FocusAvailability | null = focus.availability('name'); void namedAvailability;
  focus.subscribeAvailability('name', () => {});
  // @ts-expect-error Named subscription targets are non-null strings.
  focus.subscribeAvailability(null, () => {});
  // @ts-expect-error Availability queries require non-null names.
  focus.availability(null);
  const projected = focus.binding('name'); projected.value = true; const selected: boolean = projected.value; void selected;
  TextField('Projected', { text: title.binding }).padding(4).focused(projected);
  WebView({ html: '' }).focused(projected);
  // @ts-expect-error Projected values are boolean.
  projected.value = 'true';
  // @ts-expect-error A scalar State Binding is not a FocusBinding.
  TextField('Wrong', { text: title.binding }).focused(title.binding);
  // @ts-expect-error FocusBinding brands cannot be forged.
  TextField('Forged', { text: title.binding }).focused({ value: true });
  // @ts-expect-error Resume uses the current context and accepts no arguments.
  focus.resume('name');
  const actual: string | null = focus.actual.value; const retired: boolean = focus.retired.value; void actual; void retired;
  // @ts-expect-error Actual focus is readonly.
  focus.actual.value = 'name';
  // @ts-expect-error Retirement is readonly.
  focus.retired.value = false;
  // @ts-expect-error Desired focus is a nullable name.
  focus.desired.value = 1;
  // @ts-expect-error Controller intent is not a scalar native Binding.
  void focus.desired.binding;
  // @ts-expect-error Initial names are strings or null.
  scope.focus(1);
  const count = scope.state<number>(0);
  const note = scope.state<string>(initial.label);
  scope.onDispose(() => { void note.value; });
  return props => Button(`${props.label}: ${count.value}`, () => { count.value++; });
});
ScopedCounter({ label: 'Counter' });
Component(scope => { scope.state<boolean>(false); return () => Text('No props'); })();
// @ts-expect-error Component props stay typed.
ScopedCounter({ label: 4 });
// @ts-expect-error Component bodies are synchronous.
Component(() => async () => Text('Invalid'));

const ReactiveProps = Component<{ title: string }>(scope => {
  scope.effect(() => {
    const title: string = scope.props.title;
    return () => { void title; };
  });
  // @ts-expect-error Effect callbacks must be synchronous.
  scope.effect(async () => {});
  // @ts-expect-error Effect returns are cleanup functions or undefined.
  scope.effect(() => 42);
  return props => Text(props.title);
});
ReactiveProps({ title: 'Effects' });

const AsyncLabel = Component<{ title: string }>(scope => {
  const output = scope.state<string>('');
  const stop = scope.task(async task => {
    const title: string = scope.props.title;
    const signal: AbortSignal = task.signal;
    const unregister = task.onCancel(() => { void signal.aborted; });
    await Promise.resolve();
    output.value = title;
    const committed: boolean = task.commit(() => { void task.isCurrent; });
    void committed;
    unregister();
  });
  // @ts-expect-error Tasks return undefined or Promise<void>.
  scope.task(() => 42);
  // @ts-expect-error Async task results are published through State or commit.
  scope.task(async () => 'invalid');
  return () => Button(output.value, stop);
});
AsyncLabel({ title: 'Tasks' });

interface RowModel { id: string; label: string; flags: boolean[] }
interface CollectionModel { title: string; rows: RowModel[]; selected: string | null }
const collection = State<CollectionModel>({ title: 'Rows', rows: [{ id: 'a', label: 'First', flags: [true] }], selected: null });
collection.value = { ...collection.value, title: 'Updated', rows: [...collection.value.rows, { id: 'b', label: 'Second', flags: [] }] };
collection.value = collection.value;
collection.subscribe(snapshot => {
  const label: string = snapshot.rows[0].label;
  void label;
  // @ts-expect-error Subscriber snapshots are deeply readonly.
  snapshot.rows[0].flags.push(false);
});
const rows = State<RowModel[]>([]);
rows.value = rows.value;
ForEach(rows.value, { id: row => row.id }, row => Text(row.label));
Component(scope => {
  const local = scope.state({ nested: { count: 0 }, items: ['one'] });
  local.value = { ...local.value, items: [...local.value.items, 'two'] };
  return () => Text(String(local.value.nested.count));
})();
// @ts-expect-error Object state has no native binding.
TextField('Invalid object binding', { text: collection.binding });
// @ts-expect-error Collection snapshots are deeply readonly.
rows.value.push({ id: 'x', label: 'Invalid', flags: [] });
// @ts-expect-error Nested object fields are readonly.
collection.value.rows[0].label = 'Invalid';
// @ts-expect-error Writes preserve the model field types.
collection.value = { title: 42, rows: [], selected: null };
// @ts-expect-error Functions are not JSON state.
State({ handler: (value: string) => value });
// @ts-expect-error Dates must be explicitly serialized to strings.
State(new Date());
// @ts-expect-error Maps must be represented by records/arrays.
State(new Map<string, number>());
// @ts-expect-error Undefined cannot be state.
State(undefined);
// @ts-expect-error BigInts require explicit serialization.
State({ value: 1n });
// @ts-expect-error Symbol keys are not JSON properties.
State({ [Symbol('hidden')]: true });
const mixed = State<string | { title: string }>('first');
mixed.value = { title: 'second' };
// @ts-expect-error Mixed structured/scalar state cannot bind to a native control.
TextField('Invalid union binding', { text: mixed.binding });

const filtered = Computed(() => collection.value.rows.filter(row => row.flags[0]));
const count = Computed(() => filtered.value.length);
const numberOfRows: number = count.value;
void numberOfRows;
ForEach(filtered.value, { id: row => row.id }, row => Text(row.label));
// @ts-expect-error Computed values are read-only.
count.value = 42;
// @ts-expect-error Computed JSON snapshots are deeply readonly.
filtered.value[0].label = 'Invalid';
// @ts-expect-error Read-only computed values have no native binding.
TextField('Invalid computed binding', { text: count.binding });
// @ts-expect-error Derivations must return synchronous JSON values.
Computed(async () => 42);
// @ts-expect-error Undefined is not a computed JSON result; use null for an absent item.
Computed(() => undefined);
// @ts-expect-error Class instances need explicit JSON conversion.
Computed(() => new Date());
const DerivedProps = Component<{ name: string }>(scope => {
  const label = scope.computed(() => ({ name: scope.props.name.toUpperCase() }));
  scope.effect(() => { const name: string = label.value.name; void name; });
  // @ts-expect-error Scoped derivations are synchronous too.
  scope.computed(async () => 'Invalid');
  return () => Text(label.value.name);
});
DerivedProps({ name: 'Computed' });

ScrollView(VStack([Text('Scrollable'), Spacer({ minLength: 20 })], { alignment: 'leading', spacing: 8 }));
const legacyStack = (alignment: Alignment) => VStack([], { alignment });
legacyStack('trailing');
ScrollView(HStack([Text('Wide')], { alignment: 'firstTextBaseline' }), { axes: 'horizontal', showsIndicators: false });
ScrollView(Text('Both'), { axes: 'both' }).frame({ width: 400, height: 300, alignment: 'topLeading' });
Text('Flexible').frame({ minWidth: 20, idealWidth: 100, maxWidth: 'infinity', minHeight: 10, idealHeight: 40, maxHeight: 80, alignment: 'bottomTrailing' });
Text('Insets').padding({ top: 4, leading: 8, bottom: 12, trailing: 16 }).fixedSize({ vertical: true }).layoutPriority(1);
Text('Appearance').onAppear(() => {}).onDisappear(() => { enabled.value = false; });
Text('Ignored synchronous return').onAppear(() => 1);
// @ts-expect-error Appearance handlers must be functions.
Text('Invalid').onAppear(true);
// @ts-expect-error Async appearance work belongs in a cancellable scoped task.
Text('Invalid').onAppear(async () => {});
// @ts-expect-error Disappearance callbacks are synchronous too.
Text('Invalid').onDisappear(() => Promise.resolve());
Text('Ideal').fixedSize().frame({ height: 0 });
// @ts-expect-error Fixed/flexible frame options use separate calls.
Text('Invalid').frame({ width: 100, minHeight: 20 });
// @ts-expect-error Unbounded size is supported only for flexible maxima.
Text('Invalid').frame({ width: 'infinity' });
// @ts-expect-error VStack alignment is horizontal.
VStack([], { alignment: 'top' });
// @ts-expect-error HStack alignment is vertical.
HStack([], { alignment: 'leading' });
// @ts-expect-error Unknown frame alignment.
Text('Invalid').frame({ alignment: 'left' });
// @ts-expect-error Scroll axes are vertical, horizontal or both.
ScrollView(Text('Invalid'), { axes: 'diagonal' });
// @ts-expect-error Scroll indicators are boolean.
ScrollView(Text('Invalid'), { showsIndicators: 1 });
// @ts-expect-error Insets use semantic leading/trailing edges.
Text('Invalid').padding({ left: 10 });
// @ts-expect-error Fixed size axes are boolean.
Text('Invalid').fixedSize({ horizontal: 'yes' });

const amount = State<number>(0.5);
Form([Section('Settings', [
  Slider('Amount', { value: amount.binding, min: 0, max: 1, step: 0.05 }),
  Stepper('Amount', { value: amount.binding, min: 0, max: 1, step: 0.05 }),
], { footer: 'Shared numeric state' })], { style: 'grouped' });
Form([], { style: 'columns' });
Slider('Continuous', { value: amount.binding });
Stepper('Default range', { value: amount.binding });
Stepper('Named stepper', { value: amount.binding, focusName: 'count' });
// @ts-expect-error Native focus names are strings.
Stepper('Invalid name', { value: amount.binding, focusName: true });
Slider('Named slider', { value: amount.binding, focusName: 'amount' });
Button('Named button', () => {}, { focusName: 'apply' });
Toggle('Named toggle', { isOn: enabled.binding, focusName: 'enabled' });
// @ts-expect-error Slider focus names must be strings.
Slider('Invalid name', { value: amount.binding, focusName: 1 });
// @ts-expect-error Button naming is an options object after its callback.
Button('Invalid name', () => {}, 'apply');
// @ts-expect-error Toggle names must be strings.
Toggle('Invalid name', { isOn: enabled.binding, focusName: false });
// @ts-expect-error Sliders require number bindings.
Slider('Invalid', { value: title.binding });
// @ts-expect-error Steppers require number bindings.
Stepper('Invalid', { value: enabled.binding });
// @ts-expect-error Numeric controls require a binding rather than a snapshot.
Slider('Invalid', { value: amount.value });
// @ts-expect-error Form styles are explicit native choices.
Form([], { style: 'table' });
// @ts-expect-error Section footer is text.
Section('Invalid', [], { footer: Text('Not a string') });

const theme = State<'light' | 'dark' | null>(null);
Picker('Theme', { selection: theme.binding, options: [
  { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: null, label: 'System' },
], style: 'segmented' });
const mixedChoice = State<string | number | null>(1);
Picker('Mixed', { selection: mixedChoice.binding, options: [{ value: 1, label: 'Number' }, { value: '1', label: 'Text' }, { value: null, label: 'None' }], placeholder: 'Choose…' });
Picker('Number', { selection: amount.binding, options: [{ value: 0.5, label: 'Half' }] });
Picker('Named choice', { selection: amount.binding, options: [{ value: 0.5, label: 'Half' }], focusName: 'choice' });
// @ts-expect-error Native focus names are strings.
Picker('Invalid name', { selection: amount.binding, options: [], focusName: 1 });
// @ts-expect-error Options cannot widen the binding's inferred ID type.
Picker('Invalid', { selection: theme.binding, options: [{ value: 'blue', label: 'Blue' }] });
// @ts-expect-error A string-only selection cannot include numeric options.
Picker('Invalid', { selection: title.binding, options: [{ value: 1, label: 'Number' }] });
// @ts-expect-error Null must be explicitly supported by the selection binding.
Picker('Invalid', { selection: title.binding, options: [{ value: null, label: 'None' }] });
// @ts-expect-error Pickers cannot use boolean bindings.
Picker('Invalid', { selection: enabled.binding, options: [] });
// @ts-expect-error Picker labels are text, rather than arbitrary child views.
Picker('Invalid', { selection: title.binding, options: [{ value: 'a', label: Text('A') }] });
// @ts-expect-error Unsupported picker style.
Picker('Invalid', { selection: title.binding, options: [], style: 'wheel' });

SecureField('Secret', { text: title.binding, onSubmit: () => { void title.value; } });
TextField('Name', { text: title.binding, onSubmit: () => { title.value = 'submitted'; } });
// @ts-expect-error Secure fields require string bindings.
SecureField('Invalid', { text: amount.binding });
// @ts-expect-error Submit handlers are functions.
TextField('Invalid', { text: title.binding, onSubmit: true });
// @ts-expect-error Submit callbacks read State; no raw text argument is passed.
SecureField('Invalid', { text: title.binding, onSubmit: (text: string) => { void text; } });
// @ts-expect-error Multiline Return remains text input, rather than submit.
TextEditor({ text: title.binding, onSubmit: () => {} });

const instant = State<number>(Date.UTC(2026, 10, 7, 18, 30));
DatePicker('Appointment', { selection: instant.binding, components: 'dateAndTime', style: 'compact', timeZone: 'America/Chicago', min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });
DatePicker('Day', { selection: instant.binding, components: 'date', style: 'graphical' });
DatePicker('Time', { selection: instant.binding, components: 'time' });
DatePicker('Named', { selection: instant.binding, focusName: 'appointment' });
// @ts-expect-error Native date focus names are strings.
DatePicker('Invalid', { selection: instant.binding, focusName: false });
// @ts-expect-error Dates use Unix millisecond number bindings, not strings.
DatePicker('Invalid', { selection: title.binding });
// @ts-expect-error Date inputs require a binding, not a Date object.
DatePicker('Invalid', { selection: new Date() });
// @ts-expect-error Bounds use the same Unix millisecond unit as selection.
DatePicker('Invalid', { selection: instant.binding, min: new Date() });
// @ts-expect-error Displayed components are an explicit union.
DatePicker('Invalid', { selection: instant.binding, components: 'seconds' });
// @ts-expect-error Time zones are named strings.
DatePicker('Invalid', { selection: instant.binding, timeZone: 3600 });

Text('Tap').onTapGesture(() => { enabled.value = true; });
Text('Double').onTapGesture(() => 1, { count: 2 });
// @ts-expect-error Only single/double taps are supported.
Text('Invalid').onTapGesture(() => {}, { count: 3 });
// @ts-expect-error Tap callbacks are synchronous.
Text('Invalid').onTapGesture(async () => {});
// @ts-expect-error Promise-returning functions are rejected too.
Text('Invalid').onTapGesture(() => Promise.resolve(), { count: 2 });
// @ts-expect-error Location callbacks are not implemented.
Text('Invalid').onTapGesture(() => {}, { location: true });

Text('High').onTapGesture(() => {}, { priority: 'high', count: 2 });
Button('Together', () => {}).onTapGesture(() => {}, { priority: 'simultaneous' });
// @ts-expect-error Only native normal/high/simultaneous priorities are supported.
Text('Invalid').onTapGesture(() => {}, { priority: 'exclusive' });
// @ts-expect-error A priority does not permit Promise callbacks.
Text('Invalid').onTapGesture(async () => {}, { priority: 'high' });

Text('Target').frame({ width: 240, height: 80 }).contentShape('rectangle').onTapGesture(() => {});
Text('Circle').contentShape('circle').contentShape('ellipse').contentShape('capsule');
// @ts-expect-error Arbitrary paths are not part of this primitive interaction API.
Text('Invalid').contentShape('path');
// @ts-expect-error Interaction kind options are not implemented.
Text('Invalid').contentShape('rectangle', { kind: 'dragPreview' });
// @ts-expect-error A native shape name is required.
Text('Invalid').contentShape({ shape: 'circle' });
