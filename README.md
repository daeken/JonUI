# JonUI

A modest proposal: native SwiftUI, written in TypeScript.

Native SwiftUI controls from TypeScript on macOS. The `jonui` launcher owns the
main AppKit thread and embeds Node 24.22.2 on a dedicated background thread.
Application code imports `jonui`; SwiftUI handles native layout and rendering.

See [SwiftUI widget/state coverage](SWIFTUI_TODO.md) for the comprehensive
implementation matrix, missing capabilities, binding contracts and platform
limits. [TODO.md](TODO.md) tracks implementation priority. Every commit must
review/update the coverage ledger; install the local enforcement hook once per clone:

```sh
python3 scripts/setup-hooks.py
```

The hooks cover ordinary commits, amendments, merges, cherry-picks, patch imports
and rebases. If a replay/import pauses for coverage review, update/stage the
ledger, run `python3 scripts/swiftui_coverage.py --staged --stamp`, then retry or
continue. Later hooks verify without changing a tree Git may already have cached.

## Build and run

Requires macOS 14+, Xcode's Swift 6 toolchain, Python 3.12+, and Ninja on `PATH`.
The first build downloads checksum-pinned Node source and builds a shared
`libnode`, which can take around half an hour on the first build. Dependencies and build outputs stay in
`.build/`. Subsequent builds are incremental. Set `JONUI_BUILD_JOBS` to change
the default six Node compilation jobs. The build also creates a development
`JonUI.app` identity for native window and accessibility integration; invoke it
through `bin/jonui` so the application entry file is supplied.

```sh
python3 scripts/build.py
bin/jonui examples/landmarks/app.ts
```

The launcher executes TypeScript using Node's built-in type stripping. Use
TypeScript syntax that Node can erase. Application modules can use Node filesystem
APIs, JSON imports, timers, and top-level `await`.

```ts
import { Button, State, View, runApp } from "jonui";

const count = State<number>(0);
await runApp({
  title: "Counter", width: 400, height: 300,
  content: View(() => Button(`Count: ${count.value}`, () => { count.value++; })),
});
```

Create state outside tracked bodies. `View(() => …)` records state reads and
reevaluates only when those states change; synchronous changes batch into one
update. SwiftUI reads committed native values and never waits for JavaScript.
Always await `runApp`; it resolves after normal window-close or Quit shutdown.
Use `onStop` to clear application timers and subscriptions.

## Component-local state

`Component(setup)` creates instances with scoped state and lifetime cleanup.
Setup returns a tracked body; keyed reordering preserves local state, and unmount
releases both Node and native cells. See [component scopes](docs/components.md).

```ts
const Counter = Component<{ title: string }>(scope => {
  const count = scope.state<number>(0);
  return props => Button(`${props.title}: ${count.value}`, () => { count.value++; });
});
```

Import `Component` with the other JonUI constructors. Use `scope.onDispose` during
setup for synchronous lifetime cleanup. Use `scope.effect` for work that tracks
State or current `scope.props`, runs after commits, and cleans up before rerun
or unmount. Effects return an explicit stop function. Use `scope.task` for async
work with tracked inputs, an `AbortSignal`, and cancellation cleanup. Obsolete
task continuations cannot overwrite local or shared State. Both APIs are
documented in [component scopes](docs/components.md).

State also supports immutable JSON records and arrays. Reads and subscriber
values are deeply readonly snapshots; assign a replacement to update a model.
Equal replacements preserve the snapshot and skip notifications. Native bindings
remain scalar, so editable controls use a separate scalar cell.

```ts
interface Row { id: string; label: string }
const rows = State<Row[]>([{ id: "a", label: "First" }]);
rows.value = [...rows.value, { id: "b", label: "Second" }];
```

`Computed(() => …)` caches a read-only derived JSON value and tracks State or
other computed inputs. Read `.value` from views, effects, or tasks. Use
`scope.computed` during setup for component-owned derivations that release their
dependencies and cache on unmount. Computed callbacks are synchronous and pure;
they allocate no native cells.

## Layout and scrolling

`ScrollView(content, { axes, showsIndicators })` supports vertical, horizontal,
and two-axis native scrolling. Frames support fixed or flexible bounds, nine
alignments, and JSON-safe `"infinity"` maxima. Stack alignment, semantic edge
padding, `fixedSize`, `layoutPriority`, and Spacer minimum lengths cover common
layout needs. See [native layout and scrolling](docs/layout.md) for examples and
validation rules.

`LazyVStack`/`LazyHStack` realize native rows as the viewport needs them while
keeping keyed TypeScript component state alive offscreen. Run
`bin/jonui examples/lazy-list/app.ts` for editable notes/counters that follow rows
through reversal and removal.
`LazyVGrid`/`LazyHGrid` add typed fixed/flexible/adaptive columns or rows with
track alignment and spacing. Run `bin/jonui examples/lazy-grid/app.ts` for editable
cards that preserve their notes/counters through repacking and reversal.

## Forms and inputs

`Form` and `Section` compose native settings screens. `Slider` and `Stepper`
share typed numeric bindings and bounded edits. `Picker` supports menu and
segmented selection with string/number/null values. All use revision-ordered
state updates. Run `bin/jonui examples/forms/app.ts` for a sample. See
[forms and inputs](docs/inputs.md) for semantics and validation coverage.

`SecureField` masks native string input, and both single-line field types support
`onSubmit` callbacks after native state synchronization. The form sample includes
Return handling without displaying the demo secret's contents.
`TextField`, `SecureField`, and `TextEditor` also accept `onEditingChanged(boolean)`
for focus entering/leaving the input. Value changes remain observable through State.
`Focus.move('left' | 'right' | 'up' | 'down')` selects a visible geometric neighbor
without wrapping or intercepting text/browser arrow keys. Run
`bin/jonui examples/focus-direction/app.ts` for a mixed native/browser grid.
`Focus.next()`, `Focus.previous()`, and `Focus.clear()` use the native key-view
loop and responder chain. Run `bin/jonui examples/focus/app.ts` for Return-driven
form navigation; see [native focus](docs/focus.md) for ordering and cleanup rules.
`Focus.currentName()` reads the actual eligible responder's declared name, or
null for cleared/unnamed focus, in the active window or sheet. It is a synchronous
snapshot; it does not subscribe or establish a two-way focus binding.
`Focus.capture()` remembers the current native responder as a weak opaque target;
`Focus.request(target)` restores it while its identity remains available. Adding
or removing view handles retires saved captures; value updates/keyed reorder keep
them. The example includes Remember/Restore actions.
`Focus.setTraversal(targets)` configures a captured-target cycle for Next/Previous
commands and Return handlers; `[]` restores native order. Add
`{ tabNavigation: true }` to route the active window or sheet's Tab/Shift-Tab through that
cycle too. Modifier shortcuts and marked-text composition retain native handling.
Structural edits retire the cycle and routing with its captures.
Apply `.focusSection()` to each container to group its descendants for native
SwiftUI focus movement. Run `bin/jonui examples/focus-sections/app.ts` to try two
columns whose fields Tab visits one column at a time. No captured targets or
custom Tab cycle are needed.
Use `.disabled()` or `.disabled(flag)` on a control or container to disable its
interaction. Dynamic flags belong in a tracked `View` body. Unavailable captured
targets reject restoration, and a cycle containing one falls back to native order.
Focus commands and captures follow the active sheet when one is attached, keeping
movement out of the parent window. A detected window-context switch retires saved
targets and cycles. Try `bin/jonui examples/focus-sheets/app.ts`; its Tab-between-fields
button enables sheet routing, and Native order restores platform handling.

`DatePicker` binds Unix milliseconds with date/time components, optional bounds,
native styles, and named time zones. The example includes a UTC appointment
field; changing its presentation zone preserves the stored instant.

## Edit views at runtime

```sh
bin/jonui examples/playground/app.ts
```

The [TypeScript playground](examples/playground/README.md) embeds a native
multiline editor next to a live SwiftUI preview. Edit a typed view body and click
Reload. Shared counter state survives, and syntax/render errors stay in the app
so the editor remains usable. Source edits are session-only.

## Custom web controls

The playground's **Web control** button demonstrates editable native/web UI with
shared state. A separate demo is also available:

```sh
bin/jonui examples/web-controls/app.ts
```

[WebView](examples/web-controls/README.md) embeds app-authored HTML and provides
two-way JSON messaging. Data updates preserve the browser document and focus;
changing the HTML explicitly reloads it. The web slider and native buttons in
the demo both update the same Node State.
The **Enable web input** toggle uses `.disabled()` to suspend native interaction
while preserving the document and data updates. Captured WebView responders also
work in native focus cycles; [focus semantics](docs/focus.md) distinguish those
physical browser targets from individual DOM controls.
For a passive visualization, `tabFocusable: false` removes its native Tab stop
while retaining pointer interaction, scripts, and data/RPC updates. The default
is true; the chart demo includes a **Chart Tab stop** toggle.
Declare `WebView({ html, focusName: 'editor' })` and call
`Focus.requestNamed('editor')` to focus a realized browser before its first user
focus. Names are app-wide unique and resolve within the active window. The demo's
**Focus web control** button exercises this API. TextField, SecureField,
TextEditor, and DatePicker also accept `focusName`; the native focus and form
demos can focus inputs before capturing a responder.
For visualization interactions, expose Node methods with `WebView({ html, data,
api })` and call `await window.jonui.remote<API>().select(id)` in browser code.
Node owns the model; snapshots redraw the visualization. Calls have typed JSON
arguments/results and document-scoped cancellation. Run
`bin/jonui examples/web-rpc/app.ts`; see [WebView RPC](docs/web-rpc.md).

## Landmarks target

The reduced [Landmarks app](examples/landmarks/app.ts) exercises a sidebar and
detail, filtering and favorites, a note editor sheet, Unicode text bindings,
and a real Node timer. It shares fictional fixtures with the
[Swift reference](examples/landmarks/swift/LandmarksReference.swift), which runs
using `swift run landmarks-reference`.

- [Public API](api/index.d.ts)
- [Behavior and integration acceptance criteria](examples/landmarks/README.md)
- [Bridge architecture and implementation](docs/bridge.md)

## Checks

```sh
deno task check                         # application and binding type checks
node --test tests/*.test.mjs       # reactive runtime unit tests
python3 scripts/test-integration.py     # offscreen native windows; GUI session required
```

After building, the pinned Node executable is also available at
`.build/node/node-v24.22.2/out/Release/node`; it may need
`DYLD_LIBRARY_PATH=.build/jonui/lib` to locate its shared library. Unit tests
can also run with an existing Node installation. The native integration suite
covers the unchanged TypeScript sample, callbacks, ordered state synchronization,
normal and error shutdown, 100 sheet presentations/dismissals, and editable
TypeScript reloads with error recovery and stable registration counts. It also
checks real WebKit messaging, document/focus preservation, reloads, and cleanup. Those native
windows run offscreen without activating the app. Test-only bridge
operations require `JONUI_TEST=1` and are unavailable in ordinary launches.

The implementation covers the declared v0 API. It does not yet distribute a
signed `.app`, generate arbitrary SwiftUI bindings, persist notes, or support
other platforms or multiple windows.


## Next library work

The core currently covers a deliberately small SwiftUI surface. The next major
steps are focus/gesture/accessibility APIs, multiple windows
and document lifecycle, full module reload with cleanup and type diagnostics,
and portable signed/notarized app packaging with assets and Node dependencies.
Performance work should measure JSON serialization and synchronous main-queue
writes under load, and introduce event backpressure/coalescing beyond the current
fatal overflow policy. Web controls also need bundled asset loading, automatic
sizing, automatic browser module bundling, and additional serialization codecs as
concrete applications require them.

The prioritized implementation roadmap is in [TODO.md](TODO.md).
