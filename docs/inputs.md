# Forms and inputs

`Form` and `Section` compose native SwiftUI settings screens. They use the normal
structural/keyed reconciliation and component ownership rules:

```ts
import { Form, Section, Slider, State, Stepper, TextField } from "jonui";

const name = State<string>("JonUI");
const amount = State<number>(0.5);
const content = Form([
  Section("Profile", [TextField("Name", { text: name.binding })]),
  Section("Amount", [
    Slider("Amount", { value: amount.binding, min: 0, max: 1, step: 0.05 }),
    Stepper("Amount", { value: amount.binding, min: 0, max: 1, step: 0.05 }),
  ], { footer: "Both controls update the same value." }),
], { style: "grouped" });
```

The runnable [form example](../examples/forms/app.ts) includes text input, a
toggle, and shared numeric state:

```sh
bin/jonui examples/forms/app.ts
```

## Form and section options

`Form(children, { style })` accepts `"automatic"` (default), `"grouped"`, or
`"columns"`. SwiftUI chooses the platform presentation. `Section(title,
children, { footer })` uses text for its header and optional footer. Both accept
arrays of children, including keyed `ForEach` groups. They introduce no new
application state cells or JavaScript callback registrations.

Changing form style, control labels, or numeric bounds at the same structural
position preserves component-owned state. Removing a form or section unmounts
its subtree and releases scoped state. Native focus/scroll behavior on style
changes follows SwiftUI; an explicit focus API remains separate work.

## Slider and Stepper

Both require a `Binding<number>` in `value`. Text, boolean, object, and read-only
computed values cannot be used as numeric bindings.

| Control | Default minimum | Default maximum | Default step |
| --- | --- | --- | --- |
| `Slider(title, options)` | 0 | 1 | Continuous |
| `Stepper(title, options)` | 0 | 100 | 1 |

Override `min`, `max`, or `step` in the options. Bounds must be finite, with a
positive finite span. A supplied/default step must be positive, no larger than
the span, and produce a finite `span / step` ratio. Negative minima and
fractional steps are supported. Labels must be strings.

A stepped Slider snaps native edits to the nearest `min + n * step`, clamped
within the range. It uses a continuous SwiftUI slider with quantization in its
native binding, without adding tick marks. A Stepper increments/decrements the
current bounded value by its step, so an exact non-step model value retains its
offset when incremented.

Native interactions clamp writes to the current bounds. Application State
writes retain their exact finite numeric value, including values outside the
control's range or step grid. The native display getter clamps an out-of-range
model without rewriting it. This permits shared models and application-owned
validation; initialize/update State with an in-range value when that invariant
is required by the app.

## Typed Picker

`Picker(title, { selection, options, style, placeholder })` accepts a typed
selection binding and an array of `{ value, label }` choices. Values are strings,
finite numbers, or null; labels and placeholders are text.

```ts
import { Picker, State } from "jonui";

const theme = State<"light" | "dark" | null>(null);
const content = Picker("Theme", {
  selection: theme.binding,
  options: [
    { value: null, label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
  style: "segmented",
});
```

Styles are `"automatic"` (default), `"menu"`, and `"segmented"`. The selection
binding determines the option type; options cannot widen a string binding to
accept numbers, an undeclared string literal, or null. Use an explicit union
State type for mixed or nullable choices. Boolean/object values and computed
bindings are not supported.

Values preserve their type and exact string bytes: numeric `1` and string `"1"`
are distinct, as are composed/decomposed Unicode IDs. Duplicate values are
rejected, including duplicate null and `0`/`-0`. Labels can repeat. Option records
are copied and frozen when the descriptor is created; changing the original
array does not mutate a committed picker. Replace options from a tracked body
to update the native choices.

A selection not present in the current choices shows the passive placeholder
(`"Select…"` by default). This does not rewrite the application model. An empty
picker shows that placeholder and disables interaction. Include an explicit null
option when the user should be able to choose null; the placeholder itself never
publishes a value. A segmented picker may show the placeholder as a disabled
segment while unmatched.

Reordering choices preserves selection by value. Removing the selected option
shows the placeholder until the model changes or that choice returns. Native
setters validate against the current options, so an obsolete menu choice cannot
publish after it has been removed. Style changes preserve the component's model;
native focus/menu presentation behavior remains under SwiftUI's control.

## Secure text and submit callbacks

`TextField` and `SecureField` accept the same `TextInputOptions`:

```ts
const name = State<string>("");
const secret = State<string>("");
const status = State<string>("");
const submitted = () => { status.value = `Submitted ${name.value}`; };

TextField("Name", { text: name.binding, onSubmit: submitted });
SecureField("Demo secret", { text: secret.binding, onSubmit: submitted });
```

All three text inputs accept an optional app-wide unique `focusName`. For
example, `TextField('Name', { text: name.binding, focusName: 'name' })` can receive
`Focus.requestNamed('name')` before its first user focus. TextEditor uses the same
option. Names share a namespace with WebView, and lookup respects the active
window, realization, and disabled state. It does not create a lazy row or key the
window. See [focus semantics](focus.md) for lifetime and return-value contracts.

Import `SecureField` with the other constructors. It masks the native input; its
value remains an ordinary string State available to application code. The form
example uses a dummy/demo field and displays only its length after submission.
Masking does not provide encrypted storage or change State ownership.

`onSubmit` is an optional no-argument callback for Return/submit. It runs on Node
after the native text snapshot is synchronized with the state mirror. Read the
bound State in the callback. A newer acknowledged JavaScript write takes
precedence over an older queued native snapshot, just as with ordinary edits.
Each submit can notify even when the text is unchanged. Editing without a
callback still updates State normally.

Updating a handler while it remains attached to the same binding preserves its
registration and uses the latest callback. This includes inline handlers rebuilt
after typing. Removing/readding a handler or rebinding a field allocates a fresh
registration; queued submits for the previous registration are discarded.
Unmounted fields discard callbacks and stale native setters. Partial render
recovery and shutdown release registrations too.

Submit callbacks are notifications; they do not block the native UI. Synchronous
callback exceptions use the app's orderly failure path. Use scoped tasks for
asynchronous work that needs lifetime cancellation. `TextEditor` keeps normal
multiline Return behavior and has no `onSubmit` option.

## Editing sessions

`TextField`, `SecureField`, and `TextEditor` accept optional
`onEditingChanged(editing: boolean)` callbacks. SwiftUI focus entering the input
reports `true`; focus leaving reports `false`. Typing, programmatic State writes,
and focusing an already focused input do not themselves report another session
transition. Use `State.subscribe` to observe changes to the text value.

```ts
import { State, TextEditor, TextField } from "jonui";

const name = State("");
const notes = State("");
const editingName = State(false);
TextField("Name", {
  text: name.binding,
  onEditingChanged: active => { editingName.value = active; },
});
TextEditor({
  text: notes.binding,
  onEditingChanged: active => { if (!active) console.log(notes.value); },
});
```

Callbacks run on Node after the bound native snapshot is synchronized, respecting
newer acknowledged application writes. Each input keeps independent submit and
editing registrations. Updating an attached handler uses the latest callback;
removing/readding it or rebinding retires its old registration. Merely attaching
a handler to an already focused input does not replay its current focus state.
No initial `false` notification is emitted. Focus transitions between separate
inputs follow SwiftUI's delivery order; do not assume one input's exit arrives
before the other's entry.

Keyed reordering preserves the input's native focus identity. Unmounting retires
its callbacks, so disposal does not deliver a final `false`; use component
`scope.onDispose` for lifetime cleanup. Queued events from a retired registration
are ignored. Exceptions use the same orderly failure path as submit handlers.
These callbacks observe sessions. `Focus.next()`, `Focus.previous()`, and
`Focus.clear()` provide native responder-chain navigation; see [focus](focus.md).
Direct targeting and explicit traversal order remain separate work.

## DatePicker

Date/time inputs bind to Unix timestamps in **milliseconds**, using
`Binding<number>`. JavaScript Date objects and ISO strings are not binding values:

```ts
import { DatePicker, State } from "jonui";

const appointment = State<number>(Date.UTC(2026, 10, 7, 18, 30));
const content = DatePicker("Appointment", {
  selection: appointment.binding,
  components: "dateAndTime",
  style: "compact",
  timeZone: "America/Chicago",
  min: Date.UTC(2020, 0, 1),
  max: Date.UTC(2030, 0, 1),
});
```

`components` is `"date"`, `"time"`, or `"dateAndTime"` (default).
Styles are `"automatic"` (default), `"compact"`, or `"graphical"`.
Components control the visible fields; JonUI does not truncate the stored instant
to midnight or replace it with a date-only string. The native UI uses a Gregorian
calendar and native localized formatting.

An optional `focusName` registers the date control in the same app-wide namespace
as text inputs and WebView. `Focus.requestNamed(name)` selects its first realized,
eligible native date component without opening a calendar popover or choosing a
particular date/time segment. Missing, disabled, hidden, unrealized, and other-
window targets return false. Names follow the current native surface through
style changes; captured physical controls may expire when a style recreates them.
The form example's **Focus appointment** button demonstrates this. See
[focus contracts](focus.md).

Omit `timeZone` for the system zone, or supply a named zone such as `"UTC"`,
`"America/Chicago"`, or `"Asia/Kolkata"`. Node canonicalizes accepted aliases;
the native Foundation database must support the resulting name too. Bare offset
strings are not supported. Changing zones changes presentation, preserving the
timestamp. The OS calendar handles local-time editing and DST ambiguities; the
model always represents an absolute instant.

Selection and bounds must be finite millisecond values between
`-62135596800000` and `253402300799999` (UTC years 0001 through 9999). Bounds
are inclusive and optional; `min <= max` is required, and equal bounds permit a
single instant. Prefer whole millisecond values from `Date.now()`, `Date.UTC`, or
`Date#getTime`. Native edits round to millisecond precision and then clamp to
the current bounds. Fractional application values are retained, subject to the
native date representation's precision.

As with Slider, valid programmatic writes outside the configured control bounds
remain exact in State; the display getter clamps without rewriting the model.
Writes outside the supported timestamp domain are rejected while bound. A shared
Slider/Stepper range must also fit that domain, and Picker choices sharing a date
cell must be valid timestamps. Invalid bounds/zones/options or incompatible
shared controls fail before a native transaction is applied.

Date bindings weakly capture their cell, view box, and host, reject stale/rebound
setters, and use the existing ordered state revisions. They allocate no extra
JavaScript actions. The form example includes a UTC date/time input and ISO
summary. Civil-date-only models and explicit locale/calendar customization are
not part of this API.

## Synchronization and cleanup

Controls read native observable cells and write them on the AppKit thread.
Changes enqueue the usual revision-tagged event to update the Node mirror.
A newer acknowledged JavaScript write wins over an older queued native edit.
Multiple numeric controls can share one cell; effects, computed values, and State
subscribers observe it through the existing reactive runtime.

Native commit validation checks binding value types for toggles/sheets, text
plain/secure text fields, editors, list/picker selection, and numeric/date inputs. Later writes must remain
compatible with all controls in the committed graph. Invalid types, ranges,
steps, styles, or child counts fail before mutation. A native input cannot turn
a numeric model into a string or boolean through an unchecked binding.
Picker choices must also be valid for every other control sharing their cell;
for example, a text field cannot share a picker that offers numeric/null values.

Numeric binding closures weakly reference their cells, view boxes, and host.
Unmounted controls cannot write through stale setters, and retained framework
adapters do not retain an unmounted numeric view box. Form/section removal uses
normal scoped state release after the native transaction detaches bindings.
Picker bindings use the same weak ownership and unmount guards, with no separate
JavaScript callback per option.
Text setters likewise weakly capture the cell/view/host, check the current
binding before writing, and release callback registrations on unmount.

## Validation and current limits

Unit and type checks cover options, defaults, invalid ranges/steps/bindings,
dynamic error recovery, and keyed scoped state across style/range changes.
The offscreen native test checks rendered Slider geometry, its actual native
Binding getter/setter, and the AppKit NSStepper target/action path. It verifies
shared values, clamping/snapping, exact application writes, dynamic ranges,
Unicode text, atomic rejection, and 20 mount/unmount cycles with native views,
cells, and controls returning to baseline.

Picker checks use actual NSSegmentedControl actions for typed/null values and
exact Unicode IDs, option replacement/reordering, revision ordering, passive and
empty states, and 20 realized native mount/unmount cycles. Menu/automatic styles
are checked through rendered geometry, their native Binding, and available
AppKit menu action adapters. Raw invalid
options/styles/binding values are rejected atomically.

Secure/plain text tests inspect actual AppKit text field classes and use their
delegate-change and Return target/action paths. They cover Unicode, snapshot
ordering, latest handlers, removed/rebound queued events, invalid tokens, callback
failure cleanup, and 20 mount/unmount cycles with controls/cells/registrations at
baseline. All secure test strings are dummy data; field metadata diagnostics do
not return field contents.

Date tests use actual NSDatePicker target/actions. They cover exact millisecond
and leap-day values, UTC and named zones, the Chicago spring DST gap, a half-hour
offset, components/styles, dynamic and single-instant bounds, clamping, rebinding,
revision precedence, invalid/shared domain rejection, and 20 native mount/unmount
cycles returning to baseline. Calendar popup gestures and VoiceOver remain
manual checks; the native value/action path is automated offscreen.

Editing tests move the offscreen window's first responder among actual plain and
secure fields and an NSTextView, without activating the desktop window. They
verify begin/end callbacks, no notifications from ordinary text writes, Unicode
and multiline Return edits, focus preservation during keyed reorder/current
handler updates, retired/rebound event rejection, snapshot precedence, atomic
token validation, callback failure cleanup, and 20 focused mount/unmount cycles
with native views, cells, controls, and callback counts returning to baseline.

SwiftUI does not expose its virtual Slider accessibility node in the transparent
offscreen test window. Visible slider dragging, menu opening, and
VoiceOver interaction remain manual checks. Test-only input/control operations require
`JONUI_TEST=1`; geometry probes additionally require `JONUI_TEST_LAYOUT=1`.
Controls and containers support `.disabled()`/`.disabled(boolean)`; dynamic flags
belong in a tracked View body. An ancestor's disabling takes precedence over a
descendant's false flag, and models retain their values. See [focus](focus.md)
for captured-target availability, explicit traversal, and native control coverage.

Validation on 2026-11-06: native build, 110 unit tests, 67 offscreen native
scenarios, and Deno/TypeScript checks pass.
