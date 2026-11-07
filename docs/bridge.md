# Bridge design for the first milestone

## Process and threads

`jonui entry.ts` is a native executable. Its process main thread initializes
AppKit and owns its event loop. A dedicated thread hosts Node's environment,
V8 isolate and libuv loop. AppKit never waits synchronously for JS.

Node embedding requires a small C++ shim for Node/V8 initialization, environment
creation, execution and teardown. Swift can own the window, view wrappers and
application lifecycle, calling the shim through C functions. Node's embedding
API is not a stable C ABI, so the launcher initially pins a Node major/build.
Don't try to declare `node::Environment` or V8 C++ classes directly in Swift.

Relevant upstream contracts:

- [Node embedding](https://nodejs.org/api/embedding.html)
- [Node-API thread-safe callbacks](https://nodejs.org/api/n-api.html#asynchronous-thread-safe-function-calls)
- [NSHostingView](https://developer.apple.com/documentation/swiftui/nshostingview)

## Opaque pointers and ownership

SwiftUI views are mostly value types. A pointer represents a retained reference
box containing a value (initially often `AnyView`), not an address into a transient
Swift struct. Distinct opaque types represent views, state cells and callback
registrations. Use an explicit retain/release contract across the C boundary.

- A constructor or modifier returns an owned box reference. A modifier returns a
  new view value; it does not mutate its receiver.
- A parent retains its children and referenced state independently of temporary
  JS wrappers. A mounted window retains its root until it unmounts.
- A mounted callback registration retains its Node reference/context until the
  view unmounts or the environment shuts down. Queued events also need a lifetime
  token so an event cannot dereference freed context.
- JS GC finalizers enqueue release onto the UI queue; they never destroy a view
  box or AppKit object from the Node/GC thread. Shutdown has explicit disposal;
  it cannot depend on GC running.
- Swift errors and JS exceptions become explicit status/error events. Neither
  unwinds through a C function pointer.

The initial bridge may synchronously dispatch Node constructor calls to the main
queue so factories can return actual owned handles. This is safe only with the
one-way blocking rule: the UI thread never synchronously waits for Node. Callback
trampolines always enqueue and return. A later transaction API can batch calls
without changing the application syntax. Do not synchronously join the Node
thread on main while it may be awaiting main-queue work.

## Callbacks are not arbitrary JS function pointers

Pass a native C trampoline and an opaque callback context. The trampoline retains
or copies event payloads and uses a Node-API thread-safe function to deliver them
on the owning environment. It does not invoke JS/V8 from the AppKit thread.
Use a nonblocking enqueue with an explicit queue-full policy; the UI must never
block for queue capacity. Ordered edits/actions must not be silently dropped.

For the milestone, use a bounded reliable event queue and fail the application
with a diagnostic on overflow; later add appropriate backpressure/coalescing.
An already-closing environment rejects new events and releases their payloads.
The embedding shim exposes registration hooks while the Node environment is live.

## State and synchronous SwiftUI expectations

Primitive `State` cells (bool, number, string, nullable selection) have a native
observable cell and a Node-side mirror. A `Binding<T>` identifies that native cell;
it is not a pair of JS getter/setter callbacks SwiftUI can call synchronously.
Text input, list selection, toggles and sheet dismissal write the native cell
immediately, then enqueue mirror notifications.

Each native cell owns a monotonically increasing revision. All writes, including
JS requests, commit on main; that commit order is authoritative. Node delivers
revision-ordered notifications, ignoring stale/duplicate revisions. A JS setter
must reconcile against the acknowledged native value and revision before invoking
subscribers or scheduling body work. A queued older native event must not roll
back a later acknowledged JS write. The implementation must resolve this before
calling a text binding correct; optimistic local assignment alone is insufficient.

`State.value` reads track dependencies inside `View(() => ...)` on Node. A cell
change schedules affected bodies and commits resulting SwiftUI values on main.
Never run JS inside SwiftUI's synchronous `body`, `Binding.get`, row construction,
or layout callbacks. SwiftUI reads an already available native value/subtree.
Initial mounting waits asynchronously for the Node-built root to be ready.

Structured State uses the same native JSON cells and revision order. Node
validates and copies plain JSON records/arrays before serialization, then freezes
the acknowledged snapshot recursively. Reads track the whole cell. Native JSON
equality (sorted record keys, ordered array elements) keeps equal writes at the
same revision; Node also checks structural equality before replacing its snapshot
or notifying consumers. Native bindings remain scalar handles. Structured models
are consumed by Node view bodies rather than synchronous native field getters.

Dynamic boundaries are persistent native containers; body recomputation updates
their content. A keyed `ForEach` uses application IDs. Rebuilding a parent must
reuse boundaries at the same structural position (and matching keyed item ID),
replace their body registrations, and discard old dependencies. Removing an item
unmounts its boundaries. The implementation needs a small ownership/identity
mechanism, but layout and native view reconciliation still belong to SwiftUI.

The initial `AnyView` boundary is a practical type-erasure seam, not a promise of
perfect structural identity for arbitrary SwiftUI generic compositions. The note
field focus/caret and keyed row acceptance gates constrain how much erasure is
acceptable. Broader APIs may need typed wrapper specializations.

## Lifecycle and first implementation order

1. Native launcher runs one SwiftUI window and an actual Node timer concurrently.
2. Add the C ABI box ownership and callback trampoline; prove button round-trip
   and complete Node shutdown while AppKit is still processing releases.
3. Implement primitive State/Binding cells and ordered mirror synchronization.
4. Implement the declarations used by the sample, dynamic bodies, keyed rows and
   the editor sheet. Preserve the target TypeScript application.
5. Run all acceptance gates, then expand the SwiftUI surface.

On normal stop, reject new UI events, deliver `onStop` once on Node, dispose roots
and registrations, drain releases while both threads can still progress, stop the
environment, then end the AppKit loop and join the runtime thread. The shim must
keep Node alive while the UI is open even when there are no user timers. Startup
failure and uncaught application exceptions use the same teardown with nonzero
exit status. `runApp` resolves only for an orderly stop; it rejects on failure.

Not in this milestone: shipping all of Node in a signed `.app`, runtime downloads,
generated wrappers for every SDK API, arbitrary Swift generic instantiation,
SwiftData, MapKit, hot reload, additional windows or platforms.

## Implemented transport

`native/NodeRuntime.cpp` embeds the pinned shared Node build and registers a
Node-API linked binding. `runtime/bootstrap.mjs` resolves `jonui` imports to
the runtime and executes the application's TypeScript entry point. It handles
uncaught exceptions, rejected imports, and runtime teardown.

The C ABI owns one opaque retained Swift host pointer. UTF-8 JSON requests cross
that ABI; integer handles identify retained Swift `ViewBox` and `Cell` objects.
The first implementation batches view construction and updates in transactions,
rather than passing raw addresses to JavaScript or issuing a C call for every
SwiftUI constructor. A transaction validates child references and cycles before
committing. Native boxes retain children and the mounted root retains its graph;
unreachable handles are removed after each commit. Controls and modifiers are
real SwiftUI values created by `NativeView`, with `AnyView` at the wrapper seam.
Native view values and ForEach data carry weak `ViewReference` handles, keeping
framework caches from retaining unreachable boxes/subtrees. Deferred bodies and
child builders check mount validity; native actions carry IDs and weak hosts.
Bindings reject obsolete mounts/cells before writing.

`runtime/index.mjs` reconciles immutable constructor values into mounted
boundaries. Structural positions and typed `ForEach` keys preserve handles.
Unmounting removes body dependencies and callbacks immediately, so already queued
actions for removed handles are ignored. Native Observation keeps invalidation
local to changed boxes and state cells; unchanged properties are not assigned.

State writes synchronously commit on main and return the authoritative native
value and revision. Native control edits update that same cell immediately and
send revisioned events through a bounded Node-API thread-safe function. Its
referenced handle keeps Node alive until shutdown, including apps without timers.
Queue overflow is a reported fatal failure; payloads are freed even when Node is
closing. Workers cannot import the UI binding because it belongs to the launcher
Node environment.

Window close and the Quit menu enqueue a stop event. The runtime invokes the
stop hook once, unmounts subscriptions and actions, releases native roots, and
resolves `runApp`. After the entry module completes, Node stops, frees its
environment and V8 platform, then tells main to stop AppKit. Main joins only after
Node has stopped, so main-queue releases cannot deadlock behind the join.


## Validation

The shared Node build and launcher link successfully. The 110 runtime/compiler unit
tests and all 67 native integration scenarios pass; the Landmarks acceptance
notes record the tested behavior and remaining platform coverage. Integration
windows are created offscreen with `JONUI_TEST_OFFSCREEN=1`; their real SwiftUI
sheets still present and dismiss through AppKit. Offscreen launcher windows
ignore AppKit key/main promotion requests during sheet dismissal without
disabling responder/key-view tests, and are configured before content attachment.
Ordinary launches use visible
windows and do not expose test operations.
Offscreen launcher/sheet windows set `animationBehavior = .none`; the mixed-sheet
test asserts the actual per-window policy. This suppresses automatic window
ordering animations during focus/lifecycle automation after a reproduced
UpdateCycle crash inside AppKit's sheet-close animation loop. Ordinary app
animations retain their default behavior, and the animated framework path is
still a platform-coverage limitation. No preferences or framework delegates are
changed. Three repeated mixed-sheet runs each retire 20 pending focused owners.
The test-only programmatic scroll operation explicitly drives enclosing SwiftUI
layout after moving the native clip bounds. Transparent/inactive windows may
otherwise leave lazy realization at the previous viewport without scheduling a
display pass. Tests still require actual partial native realization and the
last row's measured geometry after scrolling; no visible/key window is needed.


## Recoverable editable views

`TextEditor` adds native multiline string bindings. The playground compiles typed
function bodies using Node's `stripTypeScriptTypes` and `vm.compileFunction`, then
changes a revision State to invalidate its existing preview boundary. State cells
live outside that body and survive code changes; compilation failures never
replace the current renderer.

`View(body, { fallback })` contains render failures within its subtree. A recovery
scope tracks existing and partial mounts so a failed descendant cannot strand
callbacks, dependencies, or queued view updates. Failed reads remain subscribed
for retries. Reactive updates below a recovery boundary reenter the outer scope,
which also catches a nested fallback failing. A successful retry replaces those
error dependencies with the reads from the new body. Action exceptions remain a
separate concern; the playground wraps edited button callbacks to show their
errors in its status area.


## Embedded web controls

`WebView` uses a persistent `WKWebView` through `NSViewRepresentable`. Node commits
HTML and JSON data as view properties. Data changes deliver a model snapshot into
the existing document; source changes create a fresh document token and load the
HTML again. Main-frame script messages enter the same bounded event queue as
native controls, and Node dispatches them to callbacks belonging to mounted IDs.

The injected `window.jonui` object provides `postMessage(value)` and
`onMessage(listener)`. Main-frame checks and document tokens reject iframe and
replaced-document messages. Navigation outside the HTML document is cancelled;
website storage is ephemeral. No Node context is exposed to page JavaScript.
Dismantling stops the view, removes its script message handler and navigation
delegate, and releases callback registrations. Web/load failures are delivered
through `onError`; stale queued errors are discarded after unmount.

WebKit integration checks run against real browser JavaScript and DOM input.
They prove round trips in both directions, stable browser boot identity and focus
under repeated data updates, HTML reload, stale-token rejection, navigation
policy, errors and unmount/remount cleanup.


## Scoped state ownership

`Component` descriptors reconcile through persistent native dynamic boundaries.
A stable factory identity and structural/keyed position select the mounted setup
scope. Setup creates local cells once, and the returned body receives fresh
props on subsequent evaluations. Component-only functions and props never enter
the JSON/native view transaction.

Unmount removes Node-owned cells and subscriptions immediately and queues their
native IDs for release. `state.release` follows the view commit that detaches
those bindings, and rejects any ID still referenced by the committed graph.
Native binding closures use weak Cell references; stale native view bodies check
whether their box remains mounted. Test diagnostics expose actual live Cell
counts as well as registered handles.

Disposal runs all child/sibling cleanups even after an exception. Shutdown always
clears native roots and cells before surfacing a cleanup failure. Setup failures
and render recovery also dispose partial instances. See components.md for the
public ownership and identity contract.


## Effect scheduling

Mounted scopes own setup-registered effects. Effects share the dependency tracker
with views but have a separate pending queue. State getters subscribe a running
effect immediately so read/write feedback is detected on its first execution.
Writes invalidate observers after native acknowledgement, and subscriber callbacks
run without inheriting the writer's tracking context.

The scheduler settles dirty views, commits their native transactions, then starts
queued effects. Writes from an effect return to reconciliation before another
queued effect starts, so an owner removed by that write does not start stale
work. Cleanup is untracked, occurs before rerun, and removes subscriptions before
invocation. Stop/unmount removes pending entries and retains no cleanup callbacks.

`scope.props` is a component-local dependency signal, separate from native cells.
Shallow prop changes invalidate only observers that read it. Prop signals and
State cells share lifetime validation, so render recovery keeps only surviving
dependencies. Cycle detection counts effect sites by structural/keyed path and
registration slot; large independent lists do not exhaust one shared run budget.

## Asynchronous task ownership

`scope.task` wraps a tracked effect with one owned run per execution. Each run has
an AbortController and a cancellation cleanup stack. The synchronous callback
prefix shares the effect dependency tracker; Promise continuations run outside
that tracker. Cancellation marks a run obsolete before aborting its signal and
running every cleanup, so even synchronous abort handlers cannot publish stale
State. Failed starts cancel their partially registered resources too.

Node's AsyncLocalStorage carries the run through Promise continuations and
timers. State writes and subscription creation check that context before crossing
the native bridge. State subscribers installed by a task restore its context and
are removed on cancellation. `task.commit` explicitly guards synchronous external
publication and callbacks whose source does not preserve async context. Stale
root State allocation is rejected to prevent late cells from leaking into the
application. Component-local disposal remains a second guard for scoped cells.

Settled Promises leave the pending set, while their run retains lifetime cleanup
until input changes, stop, or owner disposal. Canceled runs leave the pending set
immediately; an uncooperative operation may still physically finish later. Its
State writes are ignored and rejection consumed. Current failures cancel their
run and follow normal app failure teardown. Test diagnostics expose pending task
counts; native lifecycle tests verify subscriptions, timers, and actual live
cells return to baseline.

The app scheduler and ordinary State subscriber dispatch clear task async context
before running. Only task-owned subscribers restore their run explicitly. This
keeps a task that cancels itself through a State write from suppressing unrelated
effects, component disposal hooks, or subscriber continuations.

## Computed graph and lifetime

Computed values are Node-only observers and dependencies. A lazy getter records
the consumer's edge, tracks its own synchronous State/props/computed inputs, and
caches an immutable JSON snapshot or the thrown error. Native getters never
execute these callbacks, and no additional native cell is needed. Derivations
share the normal tracker but reject State mutations and owned resource work;
an async context guard also prevents writes from invalid Promise-returning
derivations after await.

Input invalidation marks each reachable cache stale, immediately detaches its
input edges, and propagates to dependent views/effects/computations. All caches
are invalidated before ordinary State subscribers run. Recalculation happens on
the next read, so synchronous subscribers see fresh chained/diamond values while
view/effect changes batch. Consumers rerun on input invalidation; structural
output equality preserves snapshot identity rather than suppressing invalidation.
Error caches retain their tracked inputs for recovery, and an evaluation guard
diagnoses recursive dependency cycles.

Scopes own their derivations just as they own state and effects. Unmount lets
cleanup inspect an already successful cached value without reevaluating disposed
inputs, then removes all derived edges, callbacks, and cached values. Failed
mounts and shutdown use the same teardown. Root computations are app-owned and
released at shutdown. Computed liveness participates in render recovery so a
fallback does not subscribe to an already disposed local derivation. Test-only
diagnostics report active computation and dependency counts.

## Layout descriptors and native verification

Scroll descriptors own exactly one content node and render through SwiftUI
ScrollView. Frames use SwiftUI's fixed or flexible overload according to their
option form. The JSON string `"infinity"` maps to a native infinite maximum;
numeric nonfinite dimensions are rejected. Frame/stack alignment enums, edge
insets, fixed size axes, layout priority, and spacer minimum length are validated
on both sides of the bridge. Native validation runs before any reachable view
descriptor is applied, preserving the previous committed tree after a failure.

Layout tests opt into GeometryReader preferences with `JONUI_TEST_LAYOUT=1` in
addition to `JONUI_TEST=1`. The normal renderer has no geometry probes. Test-only
operations inspect actual SwiftUI node rectangles and AppKit NSScrollView
document/viewport bounds, then move the native clip view without interacting
with the desktop. Preferences store rectangles rather than retaining view boxes,
and shutdown clears their data. Offscreen integration checks cover measured
geometry, native scroll movement, keyed bindings, malformed transaction rejection,
and return to baseline native views/cells after repeated removal.

## Forms and numeric bindings

Form and Section are ordinary native containers with no additional JS actions.
Slider and Stepper reference native number cells through typed handles. Their
SwiftUI Binding getter clamps presentation to the current bounds; its setter
clamps native edits and snaps stepped Slider values on the main thread. Stepper
uses SwiftUI's numeric step from the current value. Programmatic State writes
remain exact. Numeric closures weakly capture the cell, view box, and host, and
reject writes after that view leaves the committed graph.

Native validation checks every bound cell against the types required by all its
committed consumers. Later JS/native writes must preserve those binding types.
Form styles and numeric bounds/steps are validated before any view transaction
mutates the graph. Native edits and JS writes keep the existing cell revision
ordering, including when a numeric cell is shared by multiple controls.

Offscreen tests use actual NSStepper actions and the native SwiftUI number
Binding for Slider edits. Test-only geometry confirms Slider rendering. SwiftUI's
virtual Slider accessibility element is unavailable in the transparent offscreen
window, so visible pointer dragging is outside this automated coverage. Repeated
style changes/removal verify all native controls, cells, and view boxes release.

## Picker identity and selection

Picker descriptors carry a copied array of scalar values and text labels.
Native SwiftUI option tags use base64-encoded JSON bytes. These ASCII tokens
preserve type and exact Unicode representation, avoiding Swift String's
canonical-equivalence comparison for composed/decomposed selection IDs. The
native getter and option tags use the same encoder; tokens never enter the
application State value.

A reserved token represents an unmatched selection and renders a passive
placeholder without changing the cell. Empty choices disable the picker.
Setters look up tokens in the current descriptor's options and publish the
original typed value. Removed tokens, unmounted view boxes, and stopped hosts
cannot write. Weak captures let framework adapters release view boxes/cells on
removal. No per-option JS actions or native state handles are allocated.

Validation rejects duplicate IDs, invalid option shapes/types, invalid styles,
and incompatible selection cells before native graph mutation. It also checks
every choice against other controls sharing that cell, so a text/numeric consumer
cannot receive an incompatible value from an otherwise valid Picker. Native segmented
target/action tests cover typed and exact Unicode round trips. Menu rendering
and its native Binding are checked offscreen; opening a menu remains a manual
check. Available AppKit menu target/action adapters are exercised without
opening a menu on the desktop.

The hosting view leaves window dimensions under AppKit/AppOptions control rather
than tracking SwiftUI's intrinsic minimum/maximum sizes. This prevents a small
transient root (such as an unmounted-state label) from shrinking the window and
leaving a subsequently remounted flexible form/picker at zero width. Geometry
tests check configured content bounds across that transition.

## Lazy container realization and grid tracks

LazyVStack and LazyHStack unwrap unmodified foreach/dynamic component boundaries
into direct native ForEach items keyed by the actual row handle. Without this,
an erased wrapper containing a whole group would turn that group into one eager
item. Modifiers/eager containers remain intentional row boundaries. Native
controls and layout are lazy; Node still mounts all logical descriptors/scopes.
Offscreen scopes retain state/effects/tasks until explicit logical removal.

LazyVGrid/LazyHGrid use the same direct keyed-item expansion and weak ownership.
The public columns/rows arrays normalize to a `tracks` descriptor array, avoiding
the runtime's internal ForEach row metadata. Each track is copied/frozen and
validated before serialization. Native validation independently rejects empty or
malformed track arrays, unknown options, invalid alignment/gaps, mixed fixed and
bounded sizing, and invalid or inverted dimensions before committing any boxes.
JSON-safe `"infinity"` maxima convert to CGFloat infinity only when building
SwiftUI GridItem values. The native grid owns packing and cross-axis measurement;
track/viewport changes preserve the keyed item handles and logical scopes.

SwiftUI may cache platform controls and render values after a row disappears.
Weak native view references and collection data release logical boxes immediately;
retired binding/action callbacks cannot reach removed cells. The native host
tracks mounted WebView coordinators in ordinary launches as well as tests, and
invalidates them when a commit removes their node or the host disposes. This
clears navigation/script handlers and replaces cached documents with an empty
document. Framework dismantling follows the same idempotent path. Old documents
cannot retain a row box or publish messages while waiting for cache eviction.

Offscreen tests cover partial realization, actual viewport movement, stable
keyed Unicode cells/actions across reorder, empty/removal cleanup, stale cached
adapters, and 20 mount/unmount cycles in each direction. A native WebView timer
case verifies coordinator and scoped state retirement after offscreen removal.
Grid scenarios add actual fixed/flexible/adaptive measurement, viewport repacking,
per-track alignment, malformed atomic transaction rejection, Unicode input/action
identity through track updates/reorder, and 20 cleanup cycles in each direction.

## Native focus traversal

The frozen Node `Focus` API sends `focus.move` with next/previous/clear. The host
validates direction and mounted-window availability, lays out pending content,
and recalculates AppKit's key-view loop. For field editors it resolves the
delegate control before selecting the following/preceding key view; traversing
from the shared NSTextView editor itself can reselect the same field. Clear
uses makeFirstResponder(nil) and reports a refusal. Commands never activate the
app or make the window key, and allocate no state cells or callbacks.

Node rejects calls from render/computed work and suppresses them after shutdown
or from canceled scoped tasks. Normal actions, submit handlers, effects, and
current tasks can move focus. The bridge returns after the native operation;
editing notifications still arrive through the ordinary asynchronous event queue.
An actual first-responder test covers plain/secure/multiline inputs, Return,
Unicode, keyed reorder, native traversal order, rapid movement, empty content,
invalid directions, and 20 focused mount/unmount cycles offscreen.

`Focus.capture` resolves the current physical key-view responder (a field editor
maps to its delegate control), storing one weak NSView reference per native
control. Node wraps the monotonically allocated handle in a frozen object backed
by a private WeakMap. `Focus.request` rejects forged/foreign objects before the
bridge and asks makeFirstResponder to focus an eligible captured view synchronously.
An already focused target is a no-op. The host verifies window ownership,
descendancy, hidden/key-view eligibility, and releases expired weak entries.
No State cells or JS callback registrations are introduced.

Any commit adding/removing native handles retires all captures before mutating
the graph, including references to otherwise unaffected controls. This conservative
invalidation rejects cached adapters without guessing a logical owner from view
geometry or accessibility metadata. Property-only commits and keyed reorder keep
valid physical identities; failed transactions leave registrations untouched.
Shutdown clears the registry, and handles are never reused. Tests cover exact
plain/secure/editor restoration, bounded recapture, ordered rapid requests/clear,
keyed/value updates, structural edits, lazy cache retirement, and 20 unmount cycles.

`Focus.setTraversal` transports a copied array of captured target IDs. Both Node
and native validate distinct identities; the host validates all views before
replacing the window-global cycle. Stale/unavailable configuration returns false
without changing a valid existing cycle. Next/Previous use direct native
makeFirstResponder calls to advance/wrap the cycle, entering at the first/last
target when the current responder is outside it. Clear retains the configured
cycle; an empty array restores native command traversal. Repeated traversal of a
single already focused target is a no-op.

Only numeric IDs are stored, so cycles add no strong view references. Expired
registrations, structural retirement, and disposal clear the cycle; unavailable
members cause traversal to discard the whole cycle and fall back to native order.
The custom order is not installed into key-view links. Without an explicit opt-in,
Tab/Shift-Tab use native handling.
Tests cover real first responders, copied/atomic configuration, Return ordering,
keyed identity, outside/single-target cycles, invalid input, lazy cache retirement,
and 20 configured mount/unmount cycles with baseline resource counts.

`tabNavigation: true` enables window-local Tab/Shift-Tab routing through the same
weak cycle. The bundle's `NSPrincipalClass` is the owned `JonUIApplication`
subclass. Its `sendEvent` override delegates eligible Tab key-down messages for
the active window/sheet to the host, which checks marked-text composition and
target eligibility before making the next native responder first.
Command/Control/Option shortcuts, key-up, marked text, disabled/retired cycles,
and all other events pass to `super.sendEvent` for ordinary AppKit dispatch.
Native resignation refusal consumes that traversal key without retrying.
This uses the documented [NSApplication dispatch extension point](https://developer.apple.com/documentation/appkit/nsapplication/sendevent(_:)).

Mode flags are type-checked on both sides and committed only with a valid full
target list. Default/false and empty configurations disable routing; invalid
updates preserve a valid prior cycle/mode. Expiry, ineligibility, structural edits,
and disposal clear both. No global monitors, native key-view links, strong target
references, state cells, or callback registrations are installed. Real NSEvent
tests cover dispatch, modifiers/composition, native reset behavior, keyed identity,
lazy cache retirement, and 20 non-key window mount/unmount cycles.

`view.focusSection()` emits a single-child modifier with no additional options.
Native validation checks keys and child count before committing; NativeView
applies SwiftUI's `.focusSection()` directly to its child. It adds no cells,
callbacks, responder registry, or event interception. SwiftUI owns native grouping;
an enabled explicit captured Tab cycle still takes precedence in the application
dispatcher. Tests compare native forward/reverse grouped and geometric order,
unchanged frames, Unicode/keyed/captured identity, reset from custom routing,
empty sections, atomic validation, and 20 focused owner mount/unmount cycles.
The test-only NSEvent generator preserves Shift in both character strings so
native reverse traversal receives a proper backtab event.

`view.disabled(flag)` emits a single-child modifier with a required boolean value
(the Node default is true). Native validation rejects unknown keys, non-booleans,
or incorrect child counts atomically, then applies SwiftUI's `.disabled(flag)`.
SwiftUI propagates inherited availability to native controls. Property-only
updates introduce no new handles, cells, callbacks, or ownership, so weak captured
identities survive disable/re-enable while their physical controls remain alive.
Existing eligibility checks reject unavailable/hidden targets and discard a cycle
containing one when traversed. A non-text integration scenario verifies this on
real NSDatePicker controls, native date edits, command/Tab traversal with a text
field, keyed reorder, malformed transactions, and 20 focused owner lifetimes.
Test-only diagnostics inspect actual NSControl eligibility and keyboard-access
settings without overriding them; stepper/segmented exclusion is verified on the
current machine, with their enabled-keyboard path still unverified.

The WebKit representable explicitly reads Context.environment.isEnabled on
creation and update. A native ControlWebView gate declines key-view/first-responder
entry and pointer hit testing while disabled, and clears an existing descendant
responder using NSWindow.makeFirstResponder. JonUI's eligibility check walks
ancestors so an internal WebKit responder cannot bypass its disabled container.
See Apple's [hit-testing contract](https://developer.apple.com/documentation/appkit/nsview/hittest%28_%3A%29/)
and [responder-entry contract](https://developer.apple.com/documentation/appkit/nsresponder/becomefirstresponder%28%29/).
Availability changes preserve documents, data delivery, and weak physical targets.
Invalidation disables cached adapters; every deferred update checks the logical
mount before applying enabled state, so retired adapters cannot reactivate.

Mixed-focus tests cover two real WebKit responders versus DOM inputs, native
command/Tab cycles and default DOM navigation after reset, Unicode/selection/keyed
identity, inherited disabling, pointer/key-view exclusion, source/data lifetimes,
late-message rejection, and 20 focused mount/unmount cycles at baseline resources.

Focus operations select the deepest attached sheet, falling back to the main
window, before layout and key-loop preparation. A weak focus-context reference
detects window switches and retires captured identities/cycles independently of
logical graph edits. This prevents requesting a parent control behind a modal
sheet and discards dismissed-sheet targets on the next parent-window operation.
Command cycles and opt-in Tab routing support the active sheet. The owned
application dispatcher filters to that window without replacing SwiftUI's sheet
delegates. Empty resets restore native sheet handling; invalid/stale target lists
leave the configured cycle/mode intact. Parent-window events are never routed
through the active sheet's cycle.
Tests inspect actual sheet responders plus the parent window, verify Return/Unicode,
application-dispatched Tab/Shift-Tab, native Tab/multiline reset, bounded captures,
marked-text/modifier bypass and atomic stale-target rejection,
disabled/keyed identity, context retirement with unchanged logical handles, and
20 focused owner removals returning views/cells/callbacks/targets to baseline.

WebView `tabFocusable` is a boolean descriptor flag, true by default. The
representable forwards it to ControlWebView.canBecomeKeyView; existing pointer
hit testing/first-responder acceptance stay governed by interaction availability.
Eligibility also checks the ancestor flag for captured internal WebKit responders.
Flag-only commits preserve documents, request epochs, callbacks, and weak target
IDs; inactive targets reject capture/named restoration and invalidate a traversal
cycle when used. Native Tab-boundary tests verify forward/reverse DOM entry/exit,
disabled/passive skipping, the default empty-browser container stop, live data/RPC
while excluded, malformed-flag atomicity, re-enabled captures, keyed reorder/reload,
and 20 owner removals during an asynchronous boundary handoff.

TextField, SecureField, TextEditor, DatePicker, Stepper, Picker and WebView `focusName` options supply
declarative registration before first focus, sharing the same namespace.
Commit validation builds an per-root maps from UTF-8 Data keys to logical node IDs,
checking nonempty names and duplicates across the reachable graph before mutating
anything. Byte keys preserve exact JS Unicode identity. Successful commits replace
the map; invalid transactions leave it intact. The map stores no native views or
callbacks and is cleared on removal/disposal.

`Focus.requestNamed` validates well-formed nonempty strings and sends `focus.named`.
The host resolves the current node's live coordinator, checks the active window's
eligibility, and focuses its native target through NSWindow. A post-request responder
check resolves shared field editors to their control and accepts the target or
its descendants; an already-focused request is a
no-op. Missing, unrealized, disabled, hidden, other-window, or refusing views return
false. Requests create no weak capture IDs and leave cycles unchanged. Property-
only rename/reassignment does not reload WebKit or change captured physical IDs.
Tests cover naming/Unicode/renaming, atomic rejection, document/cycle identity,
modal/lazy/disabled availability, 20 focused owner lifetimes, and duplicate-name
startup cleanup.

Text inputs, date pickers, steppers and choice pickers each own a bounded NSHostingView through
HostedNativeControl, using their existing SwiftUI control implementation and forwarding
the representable's full environment. Intrinsic sizing participates in surrounding
layout without imposing window min/max constraints. Coordinators weakly reference
the host, native hosting view, and logical box. Resolution walks only that owned
subtree for public editable NSTextField, non-field-editor NSTextView, or eligible
NSDatePicker/NSStepper/NSPopUpButton/NSSegmentedControl types. A date control chooses its first eligible native component,
without opening a popover or targeting a specific date/time segment.
It never matches display labels, global enumeration order, geometry, private
SwiftUI classes, or accessibility identifiers. Inputs use the same hosting path
with or without names, retaining physical identity when registration changes.
Logical removal/shutdown immediately invalidates the coordinator, clears cached
root content, and removes the registry entry. Deferred make/update/dismantle work
cannot re-register a retired input or remove a newer coordinator. Native tests
verify actual first responders, bindings/Return/newline ordering, inherited
disabled state, physical cycles, sheets, lazy realization, cross-kind duplicate
rejection and 20 owner retirements with zero retained adapters/cells/callbacks.
Date-name tests additionally cover two controls with identical labels, actual
NSDatePicker actions and physical Tab cycles, property/keyed identity,
native/native-date/web namespace collisions, inherited disabled/hidden targets,
compact/automatic/graphical styles and component/zone changes, active-sheet
isolation, actual lazy realization, 20 focused owner retirements, and duplicate-
name startup failure cleanup. Test snapshots retain a text-only adapter count
and report the total hosted-control count for teardown assertions.

Stepper/Picker hosts are shared by named and unnamed controls. Picker styles
replace only their SwiftUI content within the same logical owner. Name lookup
does not open a menu or change values. `debug.focusControls` adds a test-only owner
node ID by checking native ancestry inside each bounded host; this proves ownership
without matching labels or using the resolver under test. The focused native gate
verifies real NSStepper delta actions and segmented typed selection, same-label
owners, exact Unicode rename/reorder, atomic name validation, inherited disabling,
styles, sheet isolation/resume and 20 pending owner removals. On this machine full
keyboard access is false: five checks encounter ineligible Stepper/segmented
surfaces and three encounter absent menu/automatic AppKit surfaces. No successful
new-control focus/capture/Tab path is claimed verified. Those branches are tested
conditionally when real eligibility is available; tests neither change preferences
nor override platform key-view flags.

Button/Toggle/Slider also accept focusName and owned projections. Their bounded
host is opt-in: unnamed controls retain their original SwiftUI rendering path.
Within an opted-in subtree lookup uses public NSButton, NSButton/NSSwitch or
NSSlider respectively, plus enabled/key-view/responder gates. No private SwiftUI
classes, label matching, forced host responder or AppKit replacement is used.
Names join global atomic UTF-8 validation; Button/Toggle descriptors now validate
title/allowed keys as well. Button functions remain solely in Node's current
action table, and existing weak scalar bindings and environment forwarding remain
unchanged. A name/property update within the host does not intentionally rebuild
it; removing/readding the name switches hosting paths and may replace physical
identity. Dismantle and logical retirement invalidate cached content/registrations.

The focused offscreen gate reports zero eligible and twelve absent public
Button/Toggle/Slider surfaces on this SDK with full keyboard access false. Names
therefore report unavailable and reject movement without stealing the parent
responder. Positive focus/capture/Tab branches run only when a real eligible
public target exists; no successful path is claimed here. Tests cover same-label
and private projection owners, action/scalar bridge updates, current handlers,
atomic malformed/cross-kind duplicates, keyed rename, opt-in removal/reinsertion,
disabled/sheet/session policy and 20 pending owner lifetimes. Duplicate startup
fixtures verify stop/disposal and zero resources. The contract test supplies a
valid Toggle title so its missing-binding case still isolates binding validation.
Actual custom-drawn pointer/key interaction and an asynchronous SwiftUI FocusState
adapter require a separate contract from synchronous responder acknowledgements.

`Focus.availabilityNamed` sends `focus.availability` through the ordinary request
path, without a focusRequest stamp. After normal active-window preparation, lookup
uses the exact UTF-8 name registry. Missing names return missing. Absent/inactive
coordinators or detached surfaces return unrealized; attached hosting/browser
surfaces in another window return inactiveWindow. Otherwise the existing
namedFocusView resolver determines ready versus unavailable. No separate raw
control resolver or duplicated eligibility policy is introduced. The temporary
surface reference lives only during the request; no registry, subscription or
resource is added. Unavailable intentionally groups no supported native surface
with disabled/hidden/keyboard-ineligible states. Realization precedes the window
comparison, because an unrealized adapter has no physical window identity.

Queries perform no responder operation, scrolling or desired writes, and consume
no movement generation. Existing context preparation can retire captures/cycles
when the active window changed, as with currentName. Render/computed purity and
canceled/post-shutdown guards run before name validation. Native integration
covers exact names, text/date/choice/WebKit gates, missing and unrealized names,
actual lazy scrolling followed by an explicit retained-intent retry, active-sheet
isolation, passive query behavior and 20 owner lifetimes. Same-context query loops
preserve captures/cycles, focus/intent, request generations, viewport and resources.

Owned `availability` methods reuse this operation: named controllers guard the
read with their existing owner/task lease before calling availabilityNamed;
boolean wrappers supply their generated name; selection wrappers guard before
mapping a declared non-null ID and delegate to the named controller. The request
retirement gate is deliberately omitted for these read-only snapshots, so current
retired owners can inspect the active context without resuming observation.
Stale/canceled/disposed callers return null before validation/availability work.
RPC claim guards remain part of normal task checks. No native source/protocol or
owned resource layout changes. Unit/native tests cover mapping, purity/validation,
per-controller stale task/RPC leases and explicit self-resume, retired contexts,
conditional target removal/reinsertion, lazy explicit retry, canceled RPC cleanup
and 20 late-query owner lifetimes. Boolean/selection names remain private to the
wrapper; global name APIs continue exposing names under their existing contract.

`Focus.subscribeAvailability` adds watch/unwatch operations and a focusAvailability
event carrying monotonic token/sequence plus the five-state value. Node shares
one native token per exact JS name, maintains per-listener initial/last delivery,
coalesces queued values and drops stale tokens/sequences. Initial delivery is
asynchronous. Listener additions/removals during delivery are checked against
current membership; task/RPC resources own unsubscribe and callback task context.
Registration errors roll back; malformed initial observations trigger unwatch.
Throwing/Promise callbacks use normal failure teardown. Shutdown clears callback
references, maps and the native watcher set.

Native watches retain names/status/counters only. One set of four window
notifications is installed while any watch exists. Bounded NSHostingView and
ControlWebView subclasses notify on layout/window attachment; coordinator update/
invalidation and graph commits also schedule sampling. Weak host references avoid
view ownership cycles. One main-queue job coalesces work, a sampling guard prevents
layout reentrancy from scheduling itself, and an epoch invalidates jobs after the
last watch stops. The existing namedAvailability helper serves snapshots and
watchers; no second eligibility policy is introduced. No timer, first-responder
KVO, focus request, generation or capture is added by availability watching.
OS changes without these triggers are outside the immediate-notification contract.

Native coverage checks missing/realized/disabled/passive/lazy/context changes,
exact Unicode sharing, effect/task ownership, RPC document cancellation, status
State updates, no focus/retry/generation/capture mutation, 20 owner lifetimes and
final native observer removal, including app-owned shutdown. Diagnostic snapshot
counts remain readable after disposal for cleanup verification. Session-owned
helpers and explicit one-shot retry are described below.

Owned subscribeAvailability helpers map named/boolean/typed targets to the same
global watcher. Each controller holds stop functions for one lease. Retirement,
resume, canceled resumption and owner disposal stop all of them; the global
subscription's private stop hook removes owner tracking on task/RPC cleanup too.
This adds no new native source/protocol/cells/effects. Registration guards suppress
stale task/retired/disposed callers before validating names/IDs. Resuming callers
can register immediately; delivery waits for the after-commit activation to bind
the new context. Asynchronous initial replay prevents calling an unassigned stop
function during registration.

Delivery verifies the lease, readiness and caller, then reads focus.snapshot with
the controller's observation token. The acknowledgement must be fed into shared
focus observation before checking context mismatch: native sampling advances its
context/sequence and could otherwise consume a transition without sibling
controllers learning it. Mismatch retires the controller and drops delivery.
Valid current-session callbacks use the global synchronous/error path. Snapshot
acknowledgements consume observation sequences, not movement generations.
Tests force availability-before-focus context ordering, verify sibling retirement,
private numeric/string target mapping, resume-before-initial cancellation, explicit
same-turn re-subscription, task/RPC lease/source cancellation, sheet/parent rebinding
and 20 pending owner lifetimes, plus throw/Promise/snapshot failure cleanup.

`Focus.move(direction)` sends `focus.direction` with one of four spatial directions.
After layout/key-loop recalculation, the host resolves a shared field editor to
its control and normalizes internal WebKit responders to the browser container.
It walks nextValidKeyView with cycle detection, or uses eligible explicit-cycle
members, deduplicates normalized views, and excludes fully clipped targets.
Geometry uses bounds intersected with visibleRect; an unclipped view's visible
extent can exceed its own rectangle. Window coordinates account for flipped
vertical axes. Aligned candidates rank by forward-edge gap then center distance;
other candidates must lie inside a 90-degree cone and rank by center distance.
Key-loop order breaks ties, with leaf views preferred over their parent
containers. The winning target receives one makeFirstResponder request with a
post-request responder check. No candidate/refusal returns false; there is no
wrapping, explicit scroll request, new registration, or arrow event interceptor. Active-
window, disabled, WebView Tab eligibility, purity, canceled-task, and shutdown
guards apply. A native matrix test covers all four axes with plain/secure/editor/
date/WebKit controls, visible lazy targets, sheets, cycle fallback, DOM selection,
keyed identity, atomic directions, and 20 owner retirements.

Mixed-sheet integration covers plain/secure/editor/date/WebKit responders in one
real AppKit sheet. It verifies captures/command cycles, application-dispatched
mixed-control Tab/Shift-Tab and wrapping, native DOM Tab boundaries after reset,
actual text/newline/date actions, disabled/passive
browser eligibility, keyed identity, snapshot/selection preservation, and retained
logical state/handles through dismissal/reopening. The test-only `debug.dates`
and `debug.date` adapters enumerate/act in the active sheet (otherwise main
window), matching existing field/editor/focus adapters; an independent parent
date proves that sheet actions reach the correct scoped binding.
Pending browser calls are canceled on document reload and focused logical-owner
removal. Twenty repeated sheet-owner retirements assert aborted signals, zero
pending replies/requests, retired native views/cells/names/callbacks, and guarded
late shared-state/focus work while every window remains transparent/non-key and
the app inactive. Native date binding lookup by logical node ID remains separate
from the active-window enumeration/action adapters.

## WebView RPC

WebView `api` tables are copied/frozen on Node and stripped from native view
descriptors. Only method names and a source epoch cross with ordinary view props.
The document's `jonui.remote()` Proxy invokes a separate
WKScriptMessageHandlerWithReply channel; WebKit supplies its Promise transport.
The coordinator validates the main frame, current document token/epoch, exported
method, JSON arguments, and a 128-call limit before queuing a Node request.

Node runs the selected handler in request-owned AsyncLocalStorage context using
the existing task signal/cleanup/late-write guards. A request is keyed by native
document token and call ID, so framework view recreation cannot alias a new call
with an old one. Native `web.claim` validates the pending call before dispatch and
guarded continuation work; replies also verify the token/epoch and committed graph
before removing their completion block. No synchronous wait for Node runs on the
AppKit thread. Successful JSON/void results and normalized name/message errors
settle the original WebKit Promise.

HTML changes retire Node work before deferred SwiftUI realization. Coordinator
replacement, navigation failure, process termination, logical removal, and shutdown
drain native reply blocks and send cancellation IDs. Epoch changes force reload
even when coalesced source bytes match the old document. Completed/canceled calls
abort their signal and release registered work; late continuations cannot publish
State or replies. Handler/data updates retain the epoch. There are no extra native
state cells; test callback counts include exported API methods. See
[API contracts and validation](web-rpc.md).

`Focus.currentName()` sends `focus.currentName` for a synchronous `{ name }`
snapshot. The host prepares the active focus window, resolves its actual responder
(including a shared field editor's owning control), and matches only eligible
live targets in the existing name registry. Request-by-name and query share the
same native target resolver. Browser descendants match their WKWebView container;
text/date controls match within their owned hosting subtree. The response uses
the committed descriptor's exact Unicode name or null for an unnamed/unavailable
responder. No target registration, native cell, callback, subscription or focus
request is created. Node rejects render/computed queries and suppresses queries
from canceled work or after shutdown. This is a point-in-time read; the bridge
emits no observed-focus event and establishes no two-way binding.

An offscreen gate verifies all supported native control kinds, actual DOM focus
and preserved caret, exact Unicode, empty/unnamed/unavailable names, repeated
reads without editing-session churn, keyed rename/removal/reassignment, sheet
isolation and 20 focused owner retirements with baseline resources.

`Focus.subscribe` shares a `focus.watch` session among Node listeners. A new
monotonically increasing token starts native observation and acknowledges a
baseline `{ name, sequence, context, window, generation, responderRevision }` without initial callback replay. A stale
watch token is rejected before replacing a session; a stale `focus.unwatch`
cannot stop a newer one. Last-listener cleanup stops the matching session.

The host observes the active NSWindow's documented KVO-compliant firstResponder
property. Window update, sheet begin/end and close notifications plus graph
commits schedule a coalesced main-queue sample. The sample lays out the active
window, rebinds KVO on a context switch, and resolves the actual live named
responder. It never consumes the KVO payload's old responder. UTF-8 comparison
detects canonically equivalent name changes. It emits `focusChanged` with token,
increasing sequence, context counter, request generation, responder revision and
nullable name when the name/context/responder owner changes. A weak responder
reference resolves shared field editors to their owning view; no capture or strong
view retention is added. Snapshots and movement acknowledgements update that same
revision. Sampling guards prevent reentrant layout notifications from queuing a
feedback loop. Stop/disposal invalidate KVO and all notification registrations;
queued samples also require their original session token.

Node validates name/sequence/context/generation, optional positive safe-integer
physical window IDs and nondecreasing safe-integer responder revisions, ignoring retired/out-of-order events. Internal
controller listeners receive revision changes; context/responder-only changes
update the baseline without duplicate public name callbacks.
Listeners run untracked outside the delivering task context; task-owned listeners
retain their own cancellation checks and cleanup. Components use effect cleanup.
Callbacks may stop siblings or add listeners without changing the current delivery
set. Failure takes the normal app-stop/owner-disposal path. Observer callbacks
contribute to callback counts; they allocate no native state cells or capture IDs.

The offscreen subscription gate covers native text/date/WebKit and shared field
editors without polling for one traversal, DOM-name stability, exact Unicode
renames, inherited disabled/passive eligibility, active sheet context switches,
shared observers and 20 queued focused owner retirements. A separate native
failure gate verifies one stop/disposal. These observations remain asynchronous;
the owned named projection subset is described below.

Focus-mutating operations (`focus.move`, `focus.direction`, `focus.named`,
`focus.target`, `focus.blurNamed`) accept an internal `focusRequest` stamp: session `token`, strictly
increasing positive safe-integer `generation`, optional positive `context` and
optional physical `window` ID, and a nonnegative logical `root` ID.
Unknown stamp fields and invalid counters throw without consuming the generation.
An operation that reaches its validator also throws without consuming a generation
when its arguments are invalid. A stale token is rejected without disturbing the newer
session. Replayed generations and mismatched context reject movement and return
the current observation acknowledgement; a context rejection consumes its new
generation so an old request cannot be replayed after another window switch.

An accepted operation returns its ordinary result plus `focusAccepted: true` and
`observation: { token, generation, sequence, context, root, window, responderRevision, name }`. `focusAccepted`
describes protocol acceptance; an unavailable/refusing target can still return
`focused: false` or `moved: false`. The acknowledgement resolves actual focus,
updates the watch baseline and advances sequence even if the name is unchanged.
Sequence gaps in emitted events are therefore expected. Old queued samples
resample current focus under the latest generation; already emitted older events
fall below the acknowledged sequence/generation floor.

Node stamps imperative commands only while a watch session exists, preserving
ordinary unobserved bridge calls. It accepts the acknowledgement before returning
the public boolean/void result, then coalesces callback delivery in a microtask.
One listener's reentrant focus request invalidates the old delivery for later
listeners. Per-listener name baselines preserve no replay for a listener joining
pending work, including same-name acknowledgements and rapid round trips.
Imperative commands omit the optional context to retain active-window semantics;
a future declarative controller can bind desired requests to a captured context.
The existing public Focus method signatures do not change.

Native tests queue a real gain event while Node is synchronous and acknowledge a
newer blur before delivery; the old gain never reaches listeners. They also cover
captured/geometric/unavailable results, request replay, retired-sheet contexts,
stale sessions and atomic malformed-stamp rejection. Runtime tests cover queued
gains, consecutive requests, acknowledgement floors, stale generations and
reentrant/joining listeners. No desired state is written by these observations.

`scope.focus` owns a desired-name cell, actual-name cell, retirement cell,
attempt counter and activation counter, plus two effects and two read-only computations. Desired exposes
tracked value/subscription operations with focus-name validation, without a scalar
Binding. The activation effect subscribes to internal metadata and uses
`focus.snapshot { token }` to obtain a fresh observation barrier. That operation
checks the active watch token, advances observation sequence and resolves name/
context without moving focus or consuming a request generation. It seeds actual
and captures the session/context for the controller.

The request effect tracks desired intent and explicit attempt revision. It runs
after view commit, skips initial null, and uses the existing request protocol with
the captured context. Actual observations never write desired intent or retrigger
that effect. Unavailable targets are one attempt, preserving desired state and
reporting the native result. An explicit repeated request advances the attempt
counter without requiring a different desired value.

Internal metadata subscribers also receive context-only changes when the nullable
name is unchanged; public name-only subscriptions retain their duplicate filtering.
A controller retires on a session/context mismatch or a rejected context-bound
acknowledgement. Retirement clears actual, stops its subscription and disables
requests until explicit resumption. Desired may still change as local data. Owner disposal
releases private cells/effects/computations and cancels pending work through the
normal scope lifecycle. Snapshot failure stops the newly registered observer
before propagating the error. No new native controller registry, responder,
capture ID, timer or input interceptor is allocated.

This provides an owned context session, with explicit resume or remount after modal context
changes. It does not automatically resume an old physical window or implement
standalone SwiftUI FocusState overloads. Named projections are described below.
Native tests verify passive activation,
initial named requests, mixed text/date/WebKit focus, desired/actual isolation,
repeated/failed requests, availability, keyed identity, modal retirement and 20
pending/canceled owner lifetimes with baseline resources.

`FocusController.resume()` stops its old subscription, invalidates readiness and
advances the activation counter. The activation effect reruns after commit,
obtains a fresh watch/snapshot and clears retirement. A baseline of desired value
and attempt revision is captured at the call: unchanged retained intent is skipped,
while requests queued after the call apply against the new context. Later resume
calls replace that baseline. A resume during an active session is also passive.
Per-listener/session barriers make old queued observations inert without replacing
the controller, native view graph or model cells.

Task and RPC run records capture a private focus lifetime clock at start. Each
controller resume advances that clock and its lease; older runs cannot write that
controller's desired state or queue focus requests. Other controllers keep their
own leases. A weak task-to-lease grant permits a current task explicitly resuming
the controller to issue its own following requests. Cancellation still takes
precedence. Pending request/resume callers are checked again before effects touch
native focus or start a new observer. Disposal also clears pending caller and
baseline references. Canceled callers are released; retained
desired data is not rolled back. This adds no native counter or task permission
change for ordinary State writes or global imperative Focus commands.

Runtime coverage includes passive/same-turn/repeated resumes, pending observer
delivery, task/RPC leases, explicit authorizers, cancellation before commit and
document replacement. Native coverage keeps one controller/model through sheet
and parent resumption, rejects an earlier task's writes, repeats 20 observer
resumes and disposes 20 owners with queued resume/request work at baseline resources.

Button keyboard shortcuts add an immutable `{ key }` descriptor to the existing
Button node. Keys are single lowercase ASCII letters/digits; options/modifier
arguments are rejected in this Command-only increment. The native input validator
checks exact keys and ASCII range before graph mutation. Rendering uses the native
SwiftUI Button.keyboardShortcut(KeyEquivalent, modifiers: .command) path, including
inside named bounded hosts. Existing action IDs/current handlers, disabled
environment and owner retirement apply; no new production callback/state/key
interceptor or registry is added. Removing the descriptor/owner removes recognition.

The native test hook posts synthetic key events through NSApplication's real event
loop and calls NSWindow.performKeyEquivalent while checking current-event flags.
Only registered test events are intercepted, with pending/results cleared on
consumption/disposal; production event routing is unchanged. Tests assert native
handled results plus Node callbacks, including false for disabled/removed chords,
text focus, keyed/current-handler identity, named hosts, sheets/root isolation and
20 owners. Callback failure verifies one stop/disposal. Modifier selection remains
deferred: shifted/unshifted same-letter dispatch was inconsistent offscreen; no
working custom modifier contract is claimed from those probes. See shortcuts.md.

Owned windows are modifier nodes with a boolean cell, copied title/initial size,
base child and an optional content child. Node tracks the presentation cell on the
modifier itself and reconciles content only while true. Native validation permits
one/two children during queued native state transitions but rejects other counts,
malformed dimensions/options and shared handles across root domains. A full graph
walk assigns root zero to the launcher and each window-content branch its modifier
ID. Names validate in per-root UTF-8 maps; sheets keep their enclosing root domain.

After a valid graph commit the host synchronizes an OwnedWindow registry. Each
coordinator owns an independent LauncherWindow/hosting root and weakly refers to
the host. Property updates change title; initial dimensions do not override user
geometry. Closing/removing a root clears native content and retires its descendant
WebView/adapters, including nested roots, while siblings remain. Main close/Quit
disposes the registry. Auxiliary delegates forward key changes and suppress sheet
alpha/animations in offscreen mode; global focus chooses an owned key root or its
deepest sheet. No external app window can become a JonUI focus namespace.

Native user close writes the binding and emits windowClosed with its content ID
and state snapshot. Node matches that opening before unmounting, then accepts the snapshot,
before State subscribers can reopen it. This prevents same-turn reopening from
preserving old scopes. A queued event follows old content across a presentation
binding replacement but cannot unmount a newer opening. Native retired-node IDs block cached body/representable,
action, appearance, scalar and browser callbacks during the close-to-commit gap;
the next graph commit prunes them. Retirement never deletes graph nodes outside
the transaction, preserving queued state/commit validation. Ordinary coalesced
false/true writes need not close a window.

Components capture their logical root from the mounted ancestor chain. Projection
validation rejects a different root. Controller activation, metadata, availability
delivery and request stamps enforce that root; stamps accept a nonnegative root
ID in addition to optional physical window/context constraints. Owned availability
queries pass the owner root explicitly, while global watches follow the active
namespace. Internal metadata includes root IDs without duplicate public same-name
callbacks. Captures/traversal remain context-scoped and reset on root switches.
Tests cover native roots/state/names, bindings, Tab dispatch, sheets/nesting,
atomic validation, task/RPC cancellation, 20 closes, immediate subscriber reopen,
shutdown with an open root and four setup/projection/duplicate/cleanup failures.

Physical-window guards add `Focus.captureWindow()` and a last `{ window }` options
argument to all three scope focus constructors. Node wraps a validated positive
native ID in a frozen object branded by a private WeakMap; constructors copy the
ID before allocating any state. A separate native registry deduplicates weak
NSWindow references, independent of observation tokens and capture/traversal IDs.
Destroyed entries are pruned on identity lookup; shutdown clears the registry.
No observer/timer, retained window, or new controller cell/effect is added.

Watch baselines, events, snapshots and movement acknowledgements carry the actual
physical window ID. Internal metadata delivery considers that ID, while public
listeners still filter by name only. Guarded activation and availability snapshots
retire on a physical mismatch before user callbacks or requests. Inactive-owner
activation is a normal retired state, not startup failure. Resume never changes
the copied guard. Movement stamps optionally carry `window` alongside token,
generation and context; the host validates the counter and checks the registry's
weak window against the current physical window immediately before the operation.
A wrong/destroyed/unknown window rejects movement with a fresh actual observation
and consumes that request generation; malformed counters throw without consuming
one. Ordinary unguarded/global calls keep their existing active-context behavior.

An ID describes a physical object, not one sheet presentation. A framework-cached
NSWindow can retain its ID across presentations, but its controller still requires
explicit session resume. Capabilities do not retain/activate/open windows, and
availability queries inspect the owner's logical namespace against the active context. Native
tests cover main and sheet guards, all controller variants, native stamp rejection,
passive return, immutable options, canceled captures, stable identity across watch
sessions and 20 pending owners. Owned logical roots and their name domains, close
lifetime and event routing are described in [owned windows](windows.md).

`retryWhenReady()` uses one private waiter and the existing owned availability
subscription, adding no cells/effects/native registry. It snapshots the current
desired name, context and responder revision; same-turn resume defers the baseline
until activation. A ready callback rechecks native availability/context/responder,
queues the normal after-commit intent effect and releases its availability watch.
The effect checks the baseline and caller again, then ends the waiter after one
attempt even on native refusal. A source marker distinguishes canceled queued
retry work from newer normal requests and conditional clears. Cancellation
releases callback/baseline references without changing desired intent. New intent,
rearming, responder changes, task/RPC/session retirement and disposal invalidate
the waiter. An old stop closure cannot affect a later waiter. Shared field editor
owners are distinguished without exposing responder identities to Node. Public
name observation remains deduplicated by name; this revision is a coalesced
responder guard, not a DOM selection/typing activity stream. No polling, explicit
scrolling, lazy realization or automatic resume/rearm is introduced. Native tests
cover disabled-to-ready attempts, private boolean/typed mapping, real unnamed
field movement, lazy scrolling driven by the test, resume/sheet/task/RPC guards
and 20 pending owner lifetimes. Unit tests also cover ready refusal and cancellation
between queueing and the effect, including protection of newer conditional clears.

`FocusController.binding(name)` creates a frozen boolean projection backed by
the existing actual computation and deferred controller intent queue. A private
WeakMap brands each object with its controller owner/name. Creation adds no cells,
computations, subscriptions or callbacks. The getter compares exact JS strings;
the setter validates booleans and uses the controller's task/context guards.
It never feeds native observations into desired state.

`view.focused(projection)` copies supported input descriptors with a focusName
and JS-only focusBinding metadata. Single-child modifier chains are copied down
to the input; no extra native box is added. Mount validation requires the
controller component to be an ancestor of the focused input, preventing a
projection-backed view from outliving its logical owner. The projection metadata
is removed before commit serialization. Existing native name uniqueness,
realization, eligibility and weak coordinator rules remain authoritative.

False cancels matching retained/pending intent, unless a valid newer pending
intent selects another name. Canceled pending callers do not mask a newer clear.
A conditional clear travels as `focus.blurNamed` with the normal request stamp.
The host resolves actual focus, compares UTF-8 names and rechecks the active window
after layout; it clears only a match. A different responder returns cleared false
with the current acknowledgement. Resignation refusal follows normal clear errors.
This protects against observation lag, including canonically equivalent distinct
names. Owner disposal and canceled resumption also clear conditional intent data.

Native projection coverage includes text/date/WebKit, nested components/modifiers,
Return/mirror ordering, Unicode conditional blur, newer intent, unavailable/disabled
targets, modal resumption and 20 pending owner lifetimes. Runtime cases cover
brands, readonly wire data, observation/deferred writes, caller cancellation,
ownership and failure teardown.

`scope.focusBoolean` uses a UUID-backed opaque name and one existing named
controller. Its frozen desired wrapper maps boolean intent to that name/null;
the actual wrapper reads the existing named projection. The private projection
metadata also holds a guarded state-like desired writer: equal values do nothing,
while a changed false queues conditional blur rather than global clear. Explicit
requests use the projection setter and can retry equal values. Observer delivery
never writes desired. This adds no bridge operations, observers, cells, effects
or computations beyond the backing controller. Names persist across reorder and
explicit resume; remount creates a new name. Only the generated name reaches the
wire; global name observations can expose it, but it has no public stable identity.
Native checks cover five independent control types, conditional false with another
target focused, keyed identity, per-controller task leases, sheet retirement and
passive parent resume, plus 20 owners removed with pending requests/resumes.

`scope.focusSelection` snapshots a finite string/number domain into two Maps:
ID-to-UUID-name for writes/projections and name-to-ID for desired/actual reads and
subscriptions. Null represents no selection; names outside this domain map to
null for observation. IDs never travel on the native wire. Map identity separates
numeric/string IDs and exact Unicode strings; zero is normalized to positive zero.
Domain validation precedes controller allocation. One existing named controller
backs all IDs, so domain size adds no native cells/effects/computations/observers.
Private WeakMap metadata reuses that controller's owner/task/context write guards
before validating a selection. Requests also check retirement (unless resuming).
Thus obsolete or disposed callers cannot publish intent or throw late validation
errors, while a current retired owner can still edit desired data. Resume remains
passive; the next explicit/changed request resolves through the same mappings.
Named projection conditional blur and native name uniqueness remain unchanged.
Tests verify typed/cross-controller identity, unknown/null/invalid domains,
snapshotting, signed zero, stale writers, text/date/WebKit selection, Return
ordering, keyed identity, modal retirement/resume, 20 pending owner lifetimes and
duplicate-projection startup cleanup.

An earlier two-way boolean FocusState synchronization prototype was discarded:
late framework observations could revive an obsolete blur request, so it is not
part of the public API or native graph validation. SwiftUI accessibility identifiers
were also absent from the underlying NSViews in the offscreen probe, so identifier
matching is not used for targeting.

## Appearance callback registrations

onAppear/onDisappear are single-child modifiers with positive integer appearance
tokens. Native commit validation checks exact props/child count. Node stores the
current callback by token and logical modifier ID/phase; functions stay outside
the native descriptor. Tokens survive callback replacement and keyed reorder,
while phase changes allocate a new token. Native SwiftUI hooks emit appearance
events only when the logical box still has that ID/phase/token. Node checks the
same tuple, clears inherited task/dependency context, and invokes the latest
handler. No new native view, state cell, observer or timer is added by the hook.

Logical unmount immediately removes callback registrations, so native disappear
events from cached/removed views cannot invoke obsolete handlers. Shutdown clears
the map and counts it among action registrations. Promise/thenable returns are
consumed and diagnosed; throws trigger normal failure teardown. Native callback
failure exits the embedded runtime immediately, so integration error fixtures
verify synchronous stop/disposal markers; unit tests verify zero retained cells,
dependencies and callbacks. Startup failures also verify native zero counts.

Startup reconciliation now records partial mounts as a transaction. On failure,
shutdown runs onStop first and retires partial mounts in reverse order, preserving
child-before-parent disposal even when a failed sibling prevented the root/child
array assignment. Successful startup releases the temporary tracking set.
Focused tests cover actual lazy/sheet events, callback-driven State updates,
current handlers/phase retirement, Unicode keyed identity, native validation,
discarded post-removal events, 20 owner lifetimes and four native failure paths.
Appearance does not guarantee target eligibility, viewport visibility or WebKit
document readiness; availability subscriptions/automatic focus retry are separate.

## Text callback registrations

Plain and secure single-line inputs use string cells. Their weak native setters
check both mount identity and the currently bound cell before publishing an edit.
SwiftUI's `onSubmit` emits a view ID, opaque registration token, and the native
cell snapshot. Node verifies the registration/source, accepts the snapshot with
normal revision precedence, then invokes the latest current callback. Functions
never enter native descriptors; only the integer token is serialized.

Tokens persist across handler replacements on one binding, so a state-triggered
render between the edit and submit events does not lose a valid submit. Removing
the handler, rebinding, or unmounting retires the token; queued events for it are
ignored. Native closures also reject tokens that no longer match the committed
box. Partial mounts, render recovery, and failure shutdown clear all registrations.
Text callbacks contribute to test callback counts alongside button/web handlers.

Offscreen tests use real NSTextField/NSSecureTextField delegate updates and their
Return action adapters, without focusing a visible window. They verify ordering,
registration rotation, rebinding, failures, and repeated cleanup. SecureField
masks presentation while its application-owned string still traverses the normal
state bridge; it introduces no separate secret-storage mechanism.

TextField, SecureField, and TextEditor each use a stable SwiftUI wrapper with
private FocusState for editing-session observation. Focus changes emit a
`textEditing` event containing the view ID, its independent `editing` token,
boolean session state, and the bound cell snapshot. Node checks the token,
view/binding source, and boolean flag before accepting the snapshot, then invokes
the latest handler with normal revision precedence. Tokens follow the same
retirement and cleanup rules as submit registrations. The wrapper stores only
weak bridge callbacks/bindings, so removed focused inputs release their view boxes
and cells. Initial focus state is not replayed on callback attachment; unmount
retires callbacks before framework focus teardown can publish a final exit.

Tests move the offscreen window's first responder directly without keying or
activating it, exercising SwiftUI's actual FocusState notifications for all three
input types. Editor changes and newline insertion use NSTextView's normal
text-change path. Guarded test events additionally exercise registration races.

## Date/time value boundary

DatePicker stores Unix milliseconds in ordinary number cells. Its native Binding
converts to/from Foundation Date seconds only at the UI boundary. The getter
clamps display to optional inclusive bounds, while the setter rounds native edits
to millisecond precision and clamps the result. Programmatic supported timestamps
remain exact in the model, even outside the control's configured bounds.

The supported numeric domain spans UTC years 0001...9999. Bound-cell validation
rejects nonnumeric/out-of-domain writes, checks shared Picker options, and rejects
shared numeric input ranges that could publish unsupported timestamps. Bounds,
components, styles, and time-zone names are validated before graph mutation.
Node's Intl validation canonicalizes zone names; Foundation supplies native
Gregorian calendar/time-zone presentation without changing the stored instant.

Weak date bindings also check the currently committed cell/mount before writing.
Native NSDatePicker target/action tests verify millisecond and zone/DST behavior,
range updates, rebinding, revision precedence, and repeated release. Test-only
date diagnostics do not open a calendar popup or interact with the desktop.
