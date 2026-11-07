/** Public v0 contract, implemented by the native launcher and runtime module. */
declare const bindingBrand: unique symbol;
declare const viewBrand: unique symbol;
declare const focusTargetBrand: unique symbol;
declare const focusBindingBrand: unique symbol;
/** Opaque weak native responder handle; capture from an already focused control. */
export interface FocusTarget { readonly [focusTargetBrand]: true }
/** Boolean projection: native observation on read, deferred request on write. */
export interface FocusBinding {
  readonly [focusBindingBrand]: true;
  get value(): boolean;
  set value(focused: boolean);
}

export type ScalarStateValue = string | number | boolean | null;
export type StateValue = ScalarStateValue | readonly StateValue[] | { readonly [key: string]: StateValue };
/** Immutable snapshot returned by State; update by replacing value. */
export type StateSnapshot<T> = T extends ScalarStateValue ? T : { readonly [K in keyof T]: StateSnapshot<T[K]> };
/** Check record fields recursively, including named interfaces without an index signature. */
type StateInput<T> = T extends ScalarStateValue ? T
  : T extends (...args: never[]) => unknown ? never
  : T extends object ? { [K in keyof T]: K extends symbol ? never : StateInput<T[K]> } : never;
// Validate after inference so ordinary object fields and arrays retain widened types.
type StateValidation<T> = [T] extends [StateInput<T>] ? [] : [invalidState: never];
export type ItemID = string | number;

/** A typed reference to native state, not a synchronous call to a JS getter. */
export interface Binding<T extends ScalarStateValue> {
  readonly [bindingBrand]: (value: T) => T;
}

export type State<T> = {
  /** Latest value on the Node thread; reads inside View bodies track dependencies. */
  get value(): StateSnapshot<T>;
  set value(next: T | StateSnapshot<T>);
  /** Runs on Node after its state mirror updates; returns an unsubscribe function. */
  subscribe(listener: (value: StateSnapshot<T>) => void): () => void;
} & ([T] extends [ScalarStateValue] ? { readonly binding: Binding<Extract<T, ScalarStateValue>> } : {});

/** Allocate outside a View body. JSON records/arrays are detached and deeply frozen. */
export function State<T>(initialValue: T, ...validation: StateValidation<T>): State<T>;

export interface Computed<T> {
  readonly value: StateSnapshot<T>;
}
/** Lazy cached JSON derivation. Allocate outside reactive callbacks; app-owned. */
export function Computed<T>(derive: () => T, ...validation: StateValidation<T>): Computed<T>;

export interface TaskContext {
  readonly signal: AbortSignal;
  readonly isCurrent: boolean;
  /** Run synchronous external result publication only while this task is current. */
  commit(callback: () => void): boolean;
  /** Lifetime cleanup, including after completion; late registration runs immediately. */
  onCancel(cleanup: () => void): () => void;
}
/** Component-owned focus state; a context switch retires requests until explicit resumption. */
export interface FocusController {
  /** Tracked intent; observations never write it. No native scalar Binding. */
  readonly desired: Pick<State<string | null>, 'value' | 'subscribe'>;
  readonly actual: Computed<string | null>;
  readonly retired: Computed<boolean>;
  /** Queue an after-commit request, including repeated names or explicit null/clear. */
  request(name: string | null): void;
  /** Rebind after commit to the current context without replaying retained intent. New requests may follow in the same turn. */
  resume(): void;
  /** Project a named target; apply with view.focused() inside this controller's component subtree. */
  binding(name: string): FocusBinding;
}
/** One opaque target with separate boolean intent/observation; use binding on one descendant input. */
export interface BooleanFocusController {
  readonly desired: Pick<State<boolean>, 'value' | 'subscribe'>;
  readonly actual: Computed<boolean>;
  readonly retired: Computed<boolean>;
  readonly binding: FocusBinding;
  request(focused: boolean): void;
  resume(): void;
}
/** A fixed domain of string/numeric target IDs, with null representing no selection. */
export interface SelectionFocusController<T extends string | number> {
  readonly desired: Pick<State<T | null>, 'value' | 'subscribe'>;
  readonly actual: Computed<T | null>;
  readonly retired: Computed<boolean>;
  request(value: T | null): void;
  resume(): void;
  binding(value: T): FocusBinding;
}
export interface ComponentScope<Props = unknown> {
  /** Track synchronous inputs and abort previous runs on change, stop or unmount. */
  task(callback: (task: TaskContext) => void | Promise<void>): () => void;
  /** Current props. Synchronous effect/task reads track shallow prop changes. */
  readonly props: Props;
  /** Track state/props reads after commit; clean up before rerun and unmount. */
  effect(callback: () => void | (() => void)): () => void;
  /** Allocate during setup; automatically disposed when this instance unmounts. */
  state<T>(initialValue: T, ...validation: StateValidation<T>): State<T>;
  /** Setup-only lazy derivation, automatically disposed on unmount. */
  computed<T>(derive: () => T, ...validation: StateValidation<T>): Computed<T>;
  /** Setup-only focus controller. Initial null is passive; resume or remount after context retirement. */
  focus(initialName?: string | null): FocusController;
  /** Setup-only opaque single-target focus controller. Initial false is passive. */
  focusBoolean(initialFocused?: boolean): BooleanFocusController;
  /** Setup-only. Copies the unique finite ID domain; initial null is passive. */
  focusSelection<const T extends string | number>(values: readonly T[], initialValue?: NoInfer<T> | null): SelectionFocusController<T>;
  /** Runs once on unmount, in reverse registration order, including setup failure. */
  onDispose(cleanup: () => void): void;
}
/**
 * Define a component once. Setup runs once per structural/keyed instance; its
 * returned body receives current props and tracks state reads on each render.
 */
export function Component<Props = void>(
  setup: (scope: ComponentScope<Props>, initialProps: Props) => (props: Props) => View,
): (props: Props) => View;

export type HorizontalAlignment = "leading" | "center" | "trailing";
/** Existing horizontal stack alignment alias. */
export type Alignment = HorizontalAlignment;
export type VerticalAlignment = "top" | "center" | "bottom" | "firstTextBaseline" | "lastTextBaseline";
export type FrameAlignment = HorizontalAlignment | "top" | "bottom" | "topLeading" | "topTrailing" | "bottomLeading" | "bottomTrailing";
export type FrameOptions = ({
  width?: number; height?: number;
  minWidth?: never; idealWidth?: never; maxWidth?: never;
  minHeight?: never; idealHeight?: never; maxHeight?: never;
} | {
  width?: never; height?: never;
  minWidth?: number; idealWidth?: number; maxWidth?: number | "infinity";
  minHeight?: number; idealHeight?: number; maxHeight?: number | "infinity";
}) & { alignment?: FrameAlignment };
export interface EdgeInsets { top?: number; leading?: number; bottom?: number; trailing?: number }
export type Font = "title" | "headline" | "body" | "caption";
export type ForegroundStyle = "primary" | "secondary" | "yellow";

export interface View {
  readonly [viewBrand]: true;
  /** Modifiers return new values; they do not mutate the receiver. */
  font(font: Font): View;
  foregroundStyle(style: ForegroundStyle): View;
  padding(pointsOrInsets?: number | EdgeInsets): View;
  frame(options: FrameOptions): View;
  /** With no options, fixes both axes. With options, omitted axes default false. */
  fixedSize(options?: { horizontal?: boolean; vertical?: boolean }): View;
  layoutPriority(value: number): View;
  navigationTitle(title: string): View;
  accessibilityIdentifier(identifier: string): View;
  /** Disable interaction for this subtree. Defaults to true; an ancestor's disabling wins. */
  disabled(disabled?: boolean): View;
  /** Group native focusable descendants for SwiftUI sequential/directional movement. */
  focusSection(): View;
  /** Attach an owned focus projection to a text input, DatePicker or WebView, through single-child modifiers. */
  focused(binding: FocusBinding): View;
  tag(id: ItemID): View;
  sheet(options: { isPresented: Binding<boolean>; content: View }): View;
}

/**
 * A persistent dynamic view boundary. Executes on Node, tracks State reads,
 * and submits a replacement native value when dependencies change. SwiftUI
 * body evaluation reads the last committed value and never calls JS synchronously.
 */
export function View(body: () => View, options?: {
  /** Recover a body or descendant render error without stopping the app. */
  fallback: (error: unknown) => View;
}): View;

export function Text(value: string): View;
export function Image(options: { systemName: string }): View;
export function Spacer(options?: { minLength?: number }): View;
export function Divider(): View;
export function VStack(children: readonly View[], options?: {
  alignment?: HorizontalAlignment;
  spacing?: number;
}): View;
export function HStack(children: readonly View[], options?: { alignment?: VerticalAlignment; spacing?: number }): View;
/** Native lazy realization; TypeScript component scopes remain mounted while offscreen. */
export function LazyVStack(children: readonly View[], options?: { alignment?: HorizontalAlignment; spacing?: number }): View;
/** Native lazy realization; TypeScript component scopes remain mounted while offscreen. */
export function LazyHStack(children: readonly View[], options?: { alignment?: VerticalAlignment; spacing?: number }): View;
/** Cross-axis track size; spacing is the gap after this column/row. */
export type GridItem = ({ size: 'fixed'; value: number; min?: never; max?: never }
  | { size: 'flexible'; min?: number; max?: number | 'infinity'; value?: never }
  | { size: 'adaptive'; min: number; max?: number | 'infinity'; value?: never }) & {
    spacing?: number; alignment?: FrameAlignment;
  };
/** Native lazy rows; column tracks run horizontally. Scopes remain mounted offscreen. */
export function LazyVGrid(children: readonly View[], options: { columns: readonly GridItem[]; alignment?: HorizontalAlignment; spacing?: number }): View;
/** Native lazy columns; row tracks run vertically. Scopes remain mounted offscreen. */
export function LazyHGrid(children: readonly View[], options: { rows: readonly GridItem[]; alignment?: VerticalAlignment; spacing?: number }): View;
export function ScrollView(content: View, options?: { axes?: "vertical" | "horizontal" | "both"; showsIndicators?: boolean }): View;
export function Form(children: readonly View[], options?: { style?: "automatic" | "grouped" | "columns" }): View;
export function Section(title: string, children: readonly View[], options?: { footer?: string }): View;
export interface NumericInputOptions {
  value: Binding<number>;
  min?: number;
  max?: number;
  step?: number;
}
/** Defaults to 0...1, continuous unless step is supplied. */
export function Slider(title: string, options: NumericInputOptions): View;
/** Defaults to 0...100 with a step of 1. */
export function Stepper(title: string, options: NumericInputOptions): View;
/** Unix milliseconds; display components and time zones never change the stored unit. */
export function DatePicker(title: string, options: {
  selection: Binding<number>;
  /** App-wide unique name for a realized eligible native date component. */
  focusName?: string;
  min?: number;
  max?: number;
  components?: "date" | "time" | "dateAndTime";
  style?: "automatic" | "compact" | "graphical";
  /** Named time zone, e.g. UTC or America/Chicago. Omitted uses the system zone. */
  timeZone?: string;
}): View;
export interface PickerOption<ID extends ItemID | null> { readonly value: ID; readonly label: string }
/** Values keep their scalar type; unmatched selections display a passive placeholder. */
export function Picker<ID extends ItemID | null>(title: string, options: {
  selection: Binding<ID>;
  options: readonly PickerOption<NoInfer<ID>>[];
  style?: "automatic" | "menu" | "segmented";
  placeholder?: string;
}): View;
export function Button(title: string, action: () => void): View;
/** Native focus commands, captures and name snapshots in the active sheet (otherwise main window). */
export const Focus: {
  readonly next: () => void; readonly previous: () => void; readonly clear: () => void;
  /** Move to a visible geometric neighbor without wrapping; false when unavailable/refused. Does not intercept arrow keys. */
  readonly move: (direction: "left" | "right" | "up" | "down") => boolean;
  /** Null when no eligible native control is focused. Structural edits retire captures. */
  readonly capture: () => FocusTarget | null;
  /** False when the target is stale, unavailable, or refuses first responder. */
  readonly request: (target: FocusTarget) => boolean;
  /** Focus a realized named text input, date picker, or WebView in the active window. False when unavailable. */
  readonly requestNamed: (name: string) => boolean;
  /** Current eligible responder's declared name in the active window; null for unnamed/cleared focus. A snapshot, not a tracked State. */
  readonly currentName: () => string | null;
  /** Coalesced actual-name changes, without initial replay. Return cleanup from an effect; task subscriptions cancel automatically. */
  readonly subscribe: (listener: (name: string | null) => void) => () => void;
  /** Cycle for next/previous and optional Tab in the active window/sheet. [] restores native behavior. False keeps a valid prior cycle. */
  readonly setTraversal: (targets: readonly FocusTarget[], options?: { tabNavigation?: boolean }) => boolean;
};
export function Toggle(title: string, options: { isOn: Binding<boolean> }): View;
export interface TextInputOptions {
  text: Binding<string>;
  /** App-wide unique native focus name; resolves before first focus. */
  focusName?: string;
  /** Focus/editing session transitions; value changes are observed through State. */
  onEditingChanged?: (editing: boolean) => void;
  /** Return/submit callback on Node after synchronizing the native state mirror. */
  onSubmit?: () => void;
}
export function TextField(title: string, options: TextInputOptions): View;
/** Masks the native input; the string State remains accessible to application code. */
export function SecureField(title: string, options: TextInputOptions): View;
/** Native multiline text input. Monospaced uses the system code font. */
export function TextEditor(options: { text: Binding<string>; focusName?: string; monospaced?: boolean; onEditingChanged?: (editing: boolean) => void }): View;
export type JSONValue = null | boolean | number | string | readonly JSONValue[] | { readonly [key: string]: JSONValue };
type WebAPIValidation<API> = { [K in keyof API]: K extends 'then' | '__proto__' | 'prototype' | 'constructor' | 'toJSON' ? never : K extends string ? API[K] extends (...args: infer A) => infer R
  ? [A] extends [StateInput<A>] ? [Awaited<R>] extends [void] ? API[K]
    : [Awaited<R>] extends [StateInput<Awaited<R>>] ? API[K] : never : never : never : never };
/** Browser-side proxy: every exposed Node method returns a Promise. */
export type WebRemote<API> = { readonly [K in keyof API]: API[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
export interface WebBridge {
  postMessage(value: JSONValue): void;
  onMessage(listener: (value: JSONValue) => void): () => void;
  remote<API extends object>(): WebRemote<API>;
}
declare global { interface Window { readonly jonui: WebBridge } }
/** Request-scoped signal/cleanup; available in an exposed method and its async continuations. */
export const WebRequest: { readonly current: TaskContext };
/** App-authored HTML control. Data updates do not reload its browser document. */
export function WebView<API extends object = {}>(options: {
  html: string;
  /** Exposed Node methods with JSON arguments/results (or void); browser calls are async. */
  api?: API & WebAPIValidation<API>;
  /** App-wide unique native focus name; resolves the browser before first focus. */
  focusName?: string;
  /** Participate in native Tab/key-view focus. Defaults true; pointer interaction is independent. */
  tabFocusable?: boolean;
  data?: JSONValue;
  /** Receives window.jonui.postMessage(value) from the main document. */
  onMessage?: (message: JSONValue) => void;
  onError?: (message: string) => void;
}): View;
export function NavigationSplitView(options: { sidebar: View; detail: View }): View;
export function List<ID extends ItemID>(
  options: { selection: Binding<ID | null> },
  content: View,
): View;
/** IDs survive filtering/reordering. The row factory runs on Node. */
export function ForEach<T>(
  items: readonly T[],
  options: { id: (item: T) => ItemID },
  row: (item: T) => View,
): View;

export interface AppOptions {
  title: string;
  width: number;
  height: number;
  content: View;
  /** Called once on Node for normal window-close or Quit shutdown, before teardown. */
  onStop?: () => void;
}

/** Invoked under `jonui entry.ts`; resolves after orderly app shutdown. */
export function runApp(options: AppOptions): Promise<void>;
