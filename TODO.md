# JonUI TODO

Work in priority order. Keep completed items checked, split large items into
reviewable increments, and mark an item complete only after its behavior and
cleanup are implemented and verified. Record useful implementation notes beside
an in-progress item so the next run can continue it.

The comprehensive [SwiftUI widget/state coverage ledger](SWIFTUI_TODO.md) records
available, partial, missing and platform-gated APIs. Review/update it **in every
commit**, including an explicit review note when coverage is unchanged. Install
the versioned commit hook with `python3 scripts/setup-hooks.py`; see AGENTS.md.

The project is named for Jonathan Swift. The TypeScript package and command are
`jonui`; the native development bundle is `JonUI.app`.

## 1. Component lifetimes and state

- [x] Add component scopes with local state that preserves component/key identity and releases its Node/native cells on unmount.
- [x] Add effects with dependency tracking and cleanup on dependency changes and unmount.
- [x] Add scoped asynchronous tasks with cancellation and protection against late updates after unmount.
- [x] Support immutable structured object/collection state.
- [x] Add reusable derived/computed values.
- [x] Test repeated mount/unmount cycles, keyed reordering, state isolation, and return to baseline resource counts.

Completed 2026-11-06: `Component(setup)` creates mounted scopes with typed
`scope.state` and synchronous `scope.onDispose`. Factory/structural/keyed identity
preserves local state, bodies receive fresh props, and cleanup runs on unmount or
setup failure. Owned cells are detached from Node immediately and released
natively after view commits. Late events/actions are ignored. Failed renders do
not resubscribe to disposed local cells. See [component scopes](docs/components.md).

Effects completed 2026-11-06: setup-only `scope.effect` tracks synchronous State
reads and current shallow `scope.props`. Effects start after native commits and
clean up before dependency-triggered reruns, explicit stop, and unmount. Failed
mounts never start effects. Cleanup/subscriber reads are untracked, self-stop is
safe, and stopped effects release pending work and dependencies. Effects may
write State; feedback loops get a diagnostic without treating large independent
keyed lists as cycles. Callback/cleanup failures still dispose all owned work.

Tasks completed 2026-11-06: setup-only `scope.task` tracks synchronous State/props
inputs, starts after native commits, and cancels prior runs on input changes,
explicit stop, unmount, or shutdown. Runs provide an AbortSignal, synchronous
`onCancel` cleanup, and guarded `commit` for external publication. Async context
prevents obsolete Promise/timer/finally/abort callbacks from writing local or
shared State, creating subscriptions, or allocating late cells. Task subscriptions
are lifetime-owned, including after Promise settlement. Canceled rejections are
consumed; current errors still clean up sibling tasks and stop the native host.
Scheduler work and ordinary subscribers do not inherit a writing task's context.

Validation: 110 runtime/compiler unit tests, Deno and TypeScript checks, and all
67 native integration scenarios pass. Component coverage includes Unicode
bindings, keyed identity, 50 mount/unmount cycles, and zero retained native cells.
Effect coverage includes native input/output, batching, conditional dependencies,
props, explicit stop, timer cleanup over 20 owner mount/unmount cycles, failure
teardown, Promise-return rejection, and feedback diagnostics. An additional unit
case exercises 150 independent state-writing effects. Task coverage includes
out-of-order results, obsolete rejection/finally/abort writes, current props,
synchronous-only conditional tracking, explicit/self stop, late allocation and
cleanup registration, subscription/timer ownership, native Unicode results,
20 mount/unmount cycles, pending-work shutdown, and six native error paths.
Root-level `State` remains app-owned until shutdown.

Structured state completed 2026-11-06: `State` and `scope.state` accept JSON
records and dense arrays with detached, deeply frozen snapshots. Replacement
updates compare structurally, preserve equal snapshots, and share existing native
revision ordering. Invalid data fails before crossing the bridge. Typed reads
and subscribers are deeply readonly; named model interfaces work without an
index signature. Native bindings remain scalar; editable fields use separate
scalar cells. Field/path bindings and per-property tracking are not implemented.
Validation adds five unit cases, compile-time positive/negative model examples,
and a native scenario covering Unicode round trips, scalar input synchronization,
keyed array identity, structural equality, stale native events, scoped actions,
and 30 mount/unmount cycles with no retained cells.

Computed values completed 2026-11-06: app-owned `Computed` and setup-only
`scope.computed` expose lazy, cached, read-only JSON snapshots. Conditional
State/current props/derived reads track inputs; chained values stay fresh even
inside synchronous State subscribers. Invalidation detaches stale subscriptions
immediately, propagates to consumers, and preserves equal output snapshot
references after recalculation. Consumers still rerun on input invalidation.
Derivations allocate no native cells. Cycle, purity, and async-return diagnostics
are implemented; errors cache and retry when tracked inputs change. Scoped
cleanup may inspect a successful cached result before final disposal releases
dependencies, callbacks, and caches. All post-disposal reads throw.
Validation adds ten unit cases and six native scenarios covering native Unicode
input/output, current props, effect/task inputs and cancellation, collection
filtering, batching, recovery, 30 mount/unmount cycles, and five failure paths.

## 2. SwiftUI coverage and composition

- [x] Add scroll views and richer frame/alignment/layout modifiers.
- [x] Add native forms/sections, sliders, and steppers.
- [x] Add typed native pickers.
- [x] Add SecureField and single-line text submit callbacks.
- [x] Add date inputs.
- [x] Add text editing-change callbacks.
- [x] Add lazy stacks and grids with stable item identity.
- [ ] Add focus and keyboard-navigation APIs.
- [ ] Add gestures, animation, and transitions.
- [ ] Add accessibility labels, values, actions, and grouping beyond identifiers.
- [ ] Expand native identity/focus tests as the wrapper surface grows.

Layout completed 2026-11-06: native `ScrollView` supports vertical, horizontal,
and both axes with indicator visibility. Frames support fixed or flexible sizes,
JSON-safe `"infinity"` maxima, and nine alignments. HStack vertical/baseline
alignment, edge padding, `fixedSize`, `layoutPriority`, and Spacer minimum length
are implemented. The existing horizontal `Alignment` alias and prior frame and
padding defaults remain compatible. Fixed/flexible calls stay separate, and both
Node and native validate enums, flags, finite metrics, and ordered bounds before
applying a transaction. See [layout and scrolling](docs/layout.md).
Validation: incremental native build, Deno/TypeScript checks, 110 unit tests, and
all 67 offscreen native scenarios pass. The layout scenario measures real SwiftUI
geometry for sizing/alignment/insets/priority, verifies native viewport movement
and indicators on both axes, keeps keyed Unicode bindings/actions through axis
changes/reorder, rejects malformed transactions atomically, and repeats 20
scroll mount/unmount cycles with native views/cells/callbacks returning to
baseline. Geometry probes require opt-in test flags and do not run in normal apps.
Public scroll position control, lazy content, and focus expansion remain separate
work.

Forms/numeric inputs completed 2026-11-06: `Form` supports automatic/grouped/
columns styles; `Section` adds text headers/footers. Typed Slider/Stepper number
bindings share native observable cells and revision ordering. Native edits clamp
to dynamic bounds, stepped Slider edits snap from the minimum, and Stepper
increments exact current values. Programmatic State writes remain exact; native
display getters clamp without rewriting models. Node/native validate ranges and
steps before mutation, and the native bridge now checks all mounted binding
types on commits and subsequent writes. Weak numeric binding captures release
view boxes/cells and ignore stale setters. See [inputs](docs/inputs.md) and the
runnable [form example](examples/forms/app.ts).
Validation adds four unit cases, positive/negative type checks, and an offscreen
native scenario with real NSStepper actions, rendered Slider geometry and its
actual native Binding getter/setter, shared revisions, dynamic styles/ranges,
Unicode input, atomic rejection, and 20 mount/unmount cycles returning views,
cells, and controls to baseline. Native build and all 110 unit/67 native checks
pass. SwiftUI's Slider accessibility node is unavailable in the transparent
offscreen window; visible pointer dragging and VoiceOver remain manual checks.

Typed Picker completed 2026-11-06: automatic/menu/segmented styles accept typed
string/number/null choices with copied immutable options. Native ASCII tags encode
JSON bytes, preserving value types and exact Unicode IDs. Unmatched values show a
passive placeholder without rewriting the model; empty choices disable the
control. Reordering retains selection by value, removed choices cannot publish,
and weak native bindings ignore stale/unmounted setters. Choice types are checked
against every other control sharing the cell before committing a transaction.
The forms example now includes a typed segmented selection.
Validation adds four unit cases, strict inference/type rejection checks, and a
native scenario with actual NSSegmentedControl actions, typed/null/Unicode round
trips, option replacement, menu rendering/bindings, revision ordering, atomic
rejection, and 20 realized mount/unmount cycles with baseline native views/cells.
The remount test also found and fixed NSHostingView intrinsic sizing shrinking
the window to a temporary hidden label; AppOptions dimensions now survive root
content swaps. Native build, 110 unit tests, 67 offscreen native scenarios, and
Deno/TypeScript checks pass. Visible menu opening and VoiceOver remain manual
checks on the current SDK; segmented target/actions are automated offscreen.

SecureField/submit completed 2026-11-06: masked native string fields and optional
`onSubmit` for TextField/SecureField synchronize a native snapshot before invoking
the latest Node handler. Registration tokens stay stable during handler updates
and rotate on removal/readdition or rebinding; stale/unmounted submissions are
discarded. Weak text setters check their current cell and mount. Function values
are stripped from native descriptors, failed mounts release registrations, and
submit errors use normal orderly teardown. Multiline Return behavior is unchanged.
The forms example now includes secure input and Return handling.
Validation adds six unit cases and two native scenarios covering actual plain/
secure AppKit classes, delegate edits and Return actions, Unicode, callback
updates, queued removal/rebind races, newer JS acknowledgements, invalid tokens,
failure cleanup, and 20 mount/unmount cycles at baseline resource counts. Native
build, 110 unit tests, 67 offscreen native scenarios, and Deno/TypeScript checks pass.
SecureField masks display; its value remains ordinary application string State.

DatePicker completed 2026-11-06: Unix millisecond number bindings support date,
time, or combined components; automatic/compact/graphical styles; optional
inclusive bounds; and named time zones with a Gregorian native calendar. The
native date boundary converts seconds/milliseconds, rounds/clamps native edits,
and preserves valid exact application writes. Node/native validation checks
timestamp domains (UTC years 0001...9999), bounds, zones, and shared control
compatibility before mutation. Weak date bindings reject stale/rebound setters.
The form example includes a UTC appointment and ISO summary.
Validation adds four unit cases and an offscreen native scenario with actual
NSDatePicker actions, exact millisecond/leap-day values, UTC and named zones,
spring DST and half-hour offsets, components/styles, dynamic/single-instant
bounds, native clamping, rebinding/revisions, atomic rejection, and 20 realized
mount/unmount cycles returning views/cells/controls to baseline. Native build,
110 unit tests, 67 offscreen native scenarios, and Deno/TypeScript checks pass.
Calendar popup gestures and VoiceOver remain manual checks.

Editing-change callbacks completed 2026-11-06: TextField, SecureField, and
TextEditor accept optional `onEditingChanged(boolean)` for native focus/session
entry and exit. Ordinary value changes remain observable through State. Stable
SwiftUI input wrappers preserve focus across handler updates/keyed reorder;
weak native captures release focused controls on unmount. Native snapshots
synchronize before Node callbacks with the usual revision precedence. Editing
and submit registrations are independent; removal/readdition, rebinding,
unmount, recovery, and shutdown retire registrations and discard stale events.
No initial/attachment replay or final disposal callback is synthesized; scope
cleanup handles owner teardown. The forms example shows the active text input.
Validation adds five unit cases, positive/negative type checks, and two offscreen
native scenarios. Actual NSTextField/NSSecureTextField/NSTextView first-responder
changes exercise begin/end transitions without activating the desktop. Tests
cover Unicode/newline edits, no value-change notifications, focused keyed reorder,
current handlers, attachment to an active editor, retired/rebound queued events,
newer acknowledgements, atomic token validation, failure cleanup, and 20 focused
mount/unmount cycles returning cells/views/controls/callbacks to baseline.
Native build, 110 unit tests, 67 offscreen native scenarios, and Deno/TypeScript
checks pass.

Lazy stacks completed 2026-11-06: LazyVStack/LazyHStack are implemented and
verified with axis-specific alignment/spacing and native viewport-driven
realization. Native containers expose individual keyed rows through unmodified
ForEach/dynamic/component boundaries. TypeScript descriptors/scopes still mount
eagerly and remain alive offscreen; explicit item removal owns disposal. Modifiers
around an entire group remain one native item, so apply row modifiers inside
ForEach. See [lazy layouts](docs/layout.md) and the editable 250-row
[example](examples/lazy-list/app.ts).
Native SwiftUI caches initially retained deleted row boxes. NativeView values and
ForEach data now use weak view references; deferred bodies/actions and bindings
check current mounts/cells. Deleting rows releases logical views/cells/callbacks
even while hidden platform adapters are cached; stale setters are inert. Removing
the container releases cached controls. WebView coordinators also use weak boxes
and retire explicitly on logical removal/disposal, clearing handlers/navigation
and replacing cached documents so scripts/timers stop. Normal launches track
coordinators for cleanup, independently of test diagnostics.
Validation adds three unit cases and three native scenarios covering both axes,
partial realization of 80 rows, actual scrolling to the last row, measured dynamic
alignment/spacing, nested keyed groups, Unicode native input/action identity,
reorder and offscreen row deletion, empty groups/stale adapters, malformed atomic
transactions, 20 mount/unmount cycles per axis, and offscreen WKWebView timer/
scoped-state retirement. Native build, 110 unit tests, all 67 offscreen native
scenarios (including existing bridge/lifecycle tests), and Deno/TypeScript checks
pass.

Lazy grids completed 2026-11-06: LazyVGrid columns and LazyHGrid rows accept typed
GridItem definitions for fixed, flexible, and adaptive tracks. Tracks support
cross-axis spacing/alignment; grid spacing controls the scrolling axis. Fixed
dimensions are finite/nonnegative, flexible bounds default to 10...infinity, and
adaptive minima must be positive. JSON-safe infinity maxima, ordered bounds,
nonnegative gaps, allowed keys, and axis-specific alignment validate on Node and
again natively before a transaction mutates the graph. Arrays/tracks are detached
and frozen; public columns/rows normalize to native tracks without colliding with
ForEach metadata. Native SwiftUI owns sizing and adaptive packing. Grids reuse
direct keyed item expansion and weak native references; offscreen scopes remain
mounted, and track replacement/viewport repacking preserve logical identities.
The editable [card grid example](examples/lazy-grid/app.ts) toggles adaptive/mixed
columns and supports keyed reversal/removal with preserved notes/counters.
Validation adds four unit cases, positive/negative type checks, and two native
scenarios. Both axes measure actual fixed/flexible sizes (including finite maximum
caps), adaptive packing and viewport repacking, gaps and track alignment, partial
realization of 80 controls, Unicode delegate input/actions, stable handles/scopes
through track replacement/reorder, atomic malformed-track rejection, offscreen
deletion/empty groups/inert cached adapters, and 20 mount/unmount cycles per axis
returning cells/views/callbacks/platform controls to baseline. Native build, all
110 unit tests, all 67 offscreen native scenarios, and Deno/TypeScript checks pass.
The combined lazy stack/grid item is complete. Next priority: focus and
keyboard-navigation APIs. Node-side virtualization, cell spans, and pinned headers
remain outside the current lazy-layout API.

Focus/navigation in progress (2026-11-06): `Focus.next()`, `Focus.previous()`, and
`Focus.clear()` implement native key-view traversal/first-responder resignation.
The host lays out content and recalculates the key loop, resolving a shared text
field editor to its delegate control so traversal advances correctly. Commands
do not activate/key the window, allocate cells, or register JS callbacks. They
reject render/computed use and ignore canceled tasks or calls after shutdown.
Calls before a mounted window and malformed native directions are diagnosed.
An editable [form navigation example](examples/focus/app.ts) adds Next/Previous/
Clear buttons and Return-driven movement; see [focus](docs/focus.md).
An attempted two-way boolean FocusState adapter was discarded after native race
tests showed stale framework focus notifications could revive a newer blur
request. No `focused` option or experimental focus cells/tokens are shipped.
Remaining: named/declarative target registration before first focus and
non-text/mixed-web focus coverage. Keep this combined item unchecked.
Validation adds three unit cases for transport/frozen API, render/computed purity,
effects, canceled tasks and post-shutdown no-ops, plus positive/negative type
checks. A native scenario verifies actual plain/secure/editor first responders,
Return/Unicode ordering, keyed active focus/reordered traversal, rapid movement,
empty controls, invalid directions, and 20 focused mount/unmount cycles at baseline
views/cells/callbacks while asserting the window never becomes key. Native build,
110 unit tests, all 67 offscreen native scenarios (including existing bridge and
lifecycle gates), and Deno/TypeScript checks pass. Named targets remain;
the broader item stays unchecked.

Captured native targets completed 2026-11-06: Focus.capture() returns an
opaque, frozen, runtime-branded FocusTarget for an already focused native control;
Focus.request(target) synchronously restores it and reports acceptance. Shared
field editors resolve to their actual delegate controls. The native registry
stores/deduplicates weak NSView references, checks window/descendant/key-view/
hidden eligibility, prunes expired entries, and never reuses IDs. Repeated capture
does not grow registrations. Existing purity/canceled-task/shutdown guards apply.
Value/label updates and keyed reordering preserve captures if physical views
survive. Adding/removing any native handle conservatively retires all captures,
including unaffected controls, so retired cached adapters cannot be requested.
Invalid transactions leave captures intact; structural retirement and shutdown
release the registry without retaining views/cells/callbacks. Main-window native
text controls are verified; sheets and mixed-web targets remain separate work.
An offscreen probe showed SwiftUI accessibility IDs are absent on the underlying
NSViews, so name lookup is not used. Named/declarative targets before first focus
still require a proper logical-to-native registration path. This partial API
intentionally keeps the item unchecked.
Validation adds three unit cases and two native scenarios for opaque/foreign/
invalid handles, purity/cancellation, actual plain/secure/editor restoration,
50 recaptures with one registration, value/reorder identity, 20 rapid request/
clear batches, atomic validation, structural retirement, lazy row/cache removal,
and 20 focused capture/unmount cycles at baseline. Native build, 110 unit tests,
all 67 offscreen native scenarios, and Deno/TypeScript checks pass. Named targets
and non-text/sheet/mixed-web coverage
remain; keep the broader focus/navigation item unchecked.

Explicit command traversal completed 2026-11-06: Focus.setTraversal(targets)
configures a window-global cycle for Focus.next()/previous() and Return handlers
using those commands. Input arrays are copied; duplicate physical identities,
invalid/foreign targets, and malformed native IDs are rejected before mutation.
Stale/unavailable target lists return false without replacing a valid cycle.
Forward/reverse wrap, outside-cycle entry, single-target no-op sessions, clear
while retaining the cycle, and [] to restore native command order are implemented.
The cycle stores only existing weak target IDs; capture retirement/disposal clears
it, and expired/ineligible members discard the whole cycle on traversal. Native
Tab/Shift-Tab links are not rewritten. Named/declarative targets and
non-text/sheet/mixed-web coverage remain.
Validation adds three unit cases, type checks, a native traversal scenario, and
lazy cache retirement checks: real responder order, Return/Unicode snapshots,
keyed identity, single/outside-target cycles, copied/atomic configuration, stale
and invalid inputs, native-order reset, canceled work, and 20 configured
capture/unmount cycles at baseline. An additional real-control availability check
disables a captured field, verifies automatic native-order fallback and atomic
rejection of an unavailable replacement, then restores it. Native build, all
110 unit tests, all 67 offscreen native scenarios, and Deno/TypeScript checks pass.
The broader focus/navigation item remains unchecked for named/declarative targets
and non-text/sheet/mixed-web coverage.

Window-local Tab routing completed 2026-11-06: optional
Focus.setTraversal(targets, { tabNavigation: true }) routes plain Tab/Shift-Tab
key-down events through the captured main-window cycle, including multiline
editors. Default/false remains command-only; empty cycles disable routing. The
window dispatcher preserves Command/Control/Option shortcuts, key-up events, and
marked-text composition handling. It uses synchronous native responders, keeps
focus when resignation is refused, and installs no key-view links or global event
monitors. Weak-target expiry, ineligible members, structural edits, and disposal
clear both cycle and routing. Invalid configurations preserve a valid prior mode.
Validation adds a runtime option/type case and a native NSEvent scenario for
forward/reverse/wrap/cleared entry, multiline focus without inserting Tab, Unicode
and keyed reorder, modifier/key-up/marked-text bypass, native multiline Tab
insertion after reset, atomic mode changes, unavailable fallback, and 20 non-key
focused mount/unmount cycles at baseline. Lazy cache tests verify routing clears
with retired targets. Native build, all 110 unit tests, all 67 offscreen native
scenarios, and Deno/TypeScript checks pass. Named/declarative targets and
non-text/sheet/mixed-web coverage remain; keep the broader item unchecked.

Native focus sections completed 2026-11-06: `view.focusSection()` applies
SwiftUI's native grouping modifier to a single child, with no options, cells,
callbacks, captured-target registrations, or event routing. Real native Tab and
Shift-Tab now visit both fields in each column before the next column, while
the same ungrouped layout uses row order. The modifier leaves geometry unchanged;
empty/passive sections add no focusable targets. An explicit captured Tab cycle
continues to take precedence; resetting it resumes native section handling.
See [focus semantics](docs/focus.md) and the runnable
[two-column example](examples/focus-sections/app.ts).
Focused validation passes: two new runtime cases, type checks, strict native
modifier/child-count validation, native plain/secure Tab/Shift-Tab ordering,
Unicode edits, captured/keyed identity, custom-cycle reset, empty groups, and
20 focused owner mount/unmount cycles at baseline views/cells/callbacks. The
test-only Shift-Tab generator now preserves Shift in charactersIgnoringModifiers
so native reverse traversal receives a correct backtab; existing Tab routing
tests pass. Native build, all 110 unit tests, all 67 offscreen native scenarios
(including bridge/lifecycle gates), and Deno/TypeScript checks pass.
Named/declarative targeting before first focus and non-text/sheet/mixed-web
coverage remain next; the combined
focus/navigation checkbox stays unchecked. Directional arrow movement remains
an uncovered/manual check.

Disabled subtrees and non-text focus completed 2026-11-06:
`view.disabled()`/`view.disabled(boolean)` applies native SwiftUI interaction
availability to a control or subtree. The default is true; ancestor disabling
wins over a descendant's false flag. Node validates flags before transport and
native validates keys/required boolean/single child before committing. Dynamic
flags in tracked bodies update existing modifiers, with no extra state cells or
callbacks; scoped models and captured physical identities survive disable/re-enable.
The [focus example](examples/focus/app.ts) now toggles its demo secret's availability.
See [focus semantics and coverage](docs/focus.md).
Focused checks pass: native build, 110 unit tests, Deno/TypeScript checks, and a
new offscreen native scenario covering actual NSDatePicker capture/restoration,
bounded recapture, command/Tab/Shift-Tab cycles with a text field, Unicode/date
edits, inherited disabling, unavailable-member fallback, atomic malformed flags
and child counts, hidden-target rejection, keyed identity, and 20 focused
disable/re-enable/mount/unmount cycles returning cells/views/callbacks/targets to
baseline. Existing production focus handling required no control-specific branch.
All 67 offscreen native scenarios pass, including existing bridge/lifecycle gates.
Concrete coverage limit: keyboard access is off on this machine. Tests verify
native NSStepper/NSSegmentedControl exclusion without changing preferences; their
eligible path needs a run with keyboard access enabled. This SDK's offscreen
hierarchy has no NSControl instances for SwiftUI Button/Toggle/Slider/menu Picker,
so those controls' capture/keyboard behavior remains unverified. Named/declarative
registration before first focus, those non-text paths, sheets/mixed-WebView focus,
and directional arrows remain; keep the broader focus/navigation item unchecked.

Mixed native/WebKit focus completed 2026-11-06: actual browser responders
work with capture/request, command cycles, and optional window-local Tab/Shift-Tab
alongside native text fields. DOM inputs in one browser share one physical target;
distinct WebViews have distinct targets. Reset restores native DOM Tab movement.
Ordinary data/keyed updates preserve document focus/selection; HTML replacement
replaces DOM state while physical target validity follows WebKit's native view.
The new scenario exposed inherited `.disabled()` not reaching WKWebView. The
representable now forwards environment.isEnabled to a native WebKit adapter that
declines pointer hits and first-responder/key-view entry and resigns current native
focus. Captured descendants also check the ancestor gate. Disabling preserves
document/scripts/data delivery; re-enabling restores interaction and existing
physical targets. Invalidation disables cached adapters, and deferred updates
check logical mount validity before applying enabled state so removed adapters
cannot reactivate. The [web control example](examples/web-controls/app.ts) now
includes **Enable web input**; see [focus](docs/focus.md).
Focused native validation passes with two actual WKWebViews, native command/Tab
cycles, DOM Tab/Shift-Tab reset, Unicode/selection/keyed identity, inherited
availability, disabled pointer/key-view exclusion and DOM-script focus attempts,
data delivery while disabled, HTML replacement, stale-target/late-message
rejection, and 20 focused owner mount/unmount cycles at baseline native
views/cells/handlers/targets. Native build, 110 unit tests, all 67 offscreen native
scenarios (including existing WebKit/lazy-cache/bridge/lifecycle gates), and
Deno/TypeScript checks pass.
Remaining: named/declarative registration before first focus, broader non-text
paths under keyboard access, sheets, WebKit IME/composition/accessibility and
native document-boundary Tab exit, plus directional arrows. Keep the broader
focus/navigation item unchecked; mixed physical browser targeting is now verified.

Active sheet focus completed 2026-11-06: focus preparation now follows the
attached-sheet chain before selecting the responder window. Next/Previous/Clear,
capture/request, and command cycles stay inside the active sheet, preventing
movement behind its modal boundary. Detecting a different window context retires
captures/cycles even with unchanged logical view handles; the context reference
is weak. Dismissed-sheet targets reject restoration on the next parent operation.
At this checkpoint, custom Tab routing was main-window-only (superseded by the
2026-11-07 single-sheet routing increment below): nonempty opt-in configurations in a
sheet return false without replacing a valid command cycle; empty resets succeed.
The parent dispatcher ignores routing while a sheet is attached. Sheet windows
retain native Tab/Shift-Tab and multiline insertion with no framework delegate
replacement or global event monitor. See [sheet focus](docs/focus.md) and the
runnable [sheet example](examples/focus-sheets/app.ts).
Focused native validation passes: actual plain/secure/editor responders, parent
isolation with unchanged handles, Return/Unicode snapshots, bounded captures,
command cycles, native Tab/Shift-Tab and multiline reset, atomic unsupported-mode
rejection, disabled/keyed identity, dismissal context retirement, and 20 focused
owner mount/unmount cycles at baseline native views/cells/callbacks/targets.
The app stays inactive and both windows stay non-key with zero alpha throughout.
Native build, 110 unit tests, all 67 offscreen native scenarios (including existing
bridge/lifecycle gates), and Deno/TypeScript checks pass. Native sheet
dismissal preserves models while their logical content declaration remains mounted;
owner removal disposes them. Remaining focus work: named/declarative registration
before first focus, keyboard-access-enabled/non-text paths, nested sheets, sheet
custom Tab routing and non-text/WebKit content, WebKit IME/accessibility/native
document-boundary Tab exit, and directional arrows. Keep the broader checkbox open.

Declared WebView names completed 2026-11-06: WebView accepts an optional
`focusName`; `Focus.requestNamed(name)` focuses its realized native browser before
first user focus. This uses the existing logical-node/coordinator registration
point. Names are app-wide unique across the mounted logical graph, including
unrealized rows and hidden sheet content; native commits validate and replace a
map of exact UTF-8 names to node IDs atomically. It holds no native controls,
cells, or callbacks. Renaming/removing/reassigning names changes lookup without
document reload or physical capture retirement. Lookup checks active-window and
native eligibility, returns false for missing/unrealized/disabled/hidden/other-
window targets, preserves DOM selection when already focused, and allocates no
capture handles. Existing purity/cancellation/shutdown guards apply. The
[web example](examples/web-controls/app.ts) now includes **Focus web control**;
see [named focus semantics](docs/focus.md).
Focused validation passes: two new runtime cases and type checks, first focus
without capture, exact composed/decomposed Unicode and case sensitivity, repeated
requests without registrations, rename/reassignment/removal, physical-cycle
interoperability, atomic malformed/duplicate-name rejection, disabled availability,
named sheet isolation, actual lazy realization through scrolling, and 20 focused
owner lifetimes at baseline resources. A duplicate-name startup fixture verifies
one disposal/stop and zero remaining native/Node views/cells/callbacks. Native
build, all 110 unit tests, all 67 offscreen native scenarios (including existing
bridge/lifecycle gates), and Deno/TypeScript checks pass.
This first increment identifies WebView containers; native text registration is
implemented in the following increment below. DOM element targeting remains
app-authored browser behavior. The combined focus/navigation item stays unchecked
for non-text controls and the other recorded keyboard-access/sheet/WebKit/directional gaps.

WebView Tab eligibility and native document boundaries completed (2026-11-06):
`WebView({ tabFocusable: false })` excludes a browser from native Tab/Shift-Tab
without disabling pointer interaction, scripts, data, or RPC. The default remains
true. Node/native validate boolean flags, and the native representable changes
key-view eligibility without recreating its document or request epoch. Internal
captured responders respect the ancestor gate; named/captured focus is unavailable
while excluded, configured cycles fall back, and re-enabling preserves physical
captures. An already focused browser can still leave through native Tab. The
[chart demo](examples/web-rpc/app.ts) now includes **Chart Tab stop**.
Focused checks pass: 110 unit tests, type checks, native forward/reverse entry at
the proper DOM input, boundary exit to native neighbors, Unicode/caret data
updates, disabled/passive skipping, default empty-document container stop, live
data/RPC while excluded, atomic malformed-flag rejection, captured/keyed identity,
source replacement, and 20 owner removals during pending native boundary handoff
at baseline views/cells/callbacks/targets. Offscreen launchers now suppress
AppKit's key/main promotion attempts during sheet dismissal and apply their
transparent/offscreen configuration before attaching SwiftUI content; keyboard
eligibility remains available for real responder tests. This followed an observed
parent-window key promotion in the existing repeated sheet-owner removal test.
Two focused 20-cycle sheet runs pass with that guard. One earlier focused run
crashed inside SwiftUI/AppKit sheet-animation layout (UpdateCycle during
NSSheetMoveHelper.closeSheet); its cause is unresolved and remains a sheet stress
coverage limitation. The final native build, all 110 unit tests, all 67 offscreen
native scenarios (including bridge/lifecycle gates and the updated chart demo),
and Deno/TypeScript checks pass.
Concrete IME blocker: in the permitted inactive/non-key window, WebKit accepted
NSTextInputClient.setMarkedText into the DOM but both direct and input-context
clients kept reporting hasMarkedText false. That does not establish a genuine
composition session to verify routing bypass. No input-source settings, key
windows, or active input context were forced. Actual WebKit IME/candidate handling
remains manual; provisional probe-only changes were removed. Native NSTextView
marked-text bypass remains automated. Remaining focus work: native named targets,
keyboard-access-enabled/non-text paths, nested/custom-routing/non-text/WebKit
sheets, WebKit IME/accessibility, and directional arrows. Native document-boundary
Tab exit is now covered; keep the broader focus/navigation checkbox unchecked.

Native text names completed (2026-11-06): TextField, SecureField, and TextEditor
now accept `focusName` in the same exact-UTF-8/global namespace as WebView.
`Focus.requestNamed` resolves their actual first responder before first user focus,
with existing active-window/disabled/realization/purity/cancellation guards and
without allocating capture handles, cells, or callbacks. Each input owns a bounded
NSHostingView subtree around the existing SwiftUI text control; the full parent
environment is forwarded, and intrinsic sizing participates in normal layout.
Lookup uses public editable NSTextField/NSTextView types only in that owned
subtree, avoiding global index/label/geometry/private-class matching. The same
host is used with and without a name, so rename/removal/reassignment preserves
physical captures and keyed input/binding identity. Coordinators hold weak native
view/host/box references. Removal/shutdown immediately invalidates cached root
content and registrations; late representable lifecycle work cannot resurrect an
obsolete adapter or remove a newer one. The [native focus demo](examples/focus/app.ts)
adds **Focus name**, **Focus secret**, and **Focus notes** buttons.
Focused validation: native build, 110 unit tests, Deno/TypeScript checks, existing
native focus-section and editing-callback gates, and a new native scenario pass.
The scenario verifies plain/secure/editor first responders, exact composed versus
decomposed Unicode, binding/Return/newline order, repeated-request session stability,
keyed/captured cycles and rename/reassignment/removal, atomic malformed names and
native/native/native-web duplicates, inherited disabling, active sheet isolation,
actual lazy realization, and 20 focused owner removals at baseline adapters/native
views/cells/Node callbacks. The startup-duplicate fixture now checks a native text
name colliding with a WebView and full failure cleanup. During full regression,
programmatic horizontal clip scrolling in the inactive/transparent test window
left SwiftUI layout at its old viewport despite the clip moving. The test-only
scroll operation now explicitly drives the enclosing layout after changing clip
bounds; realization/partial-control/geometry assertions remain intact. This
changes no ordinary app scroll behavior or window activation. The final native
build, all 110 unit tests, all 67 offscreen native scenarios (including existing
bridge/lifecycle, both lazy stack/grid axes, focus, WebView, and teardown gates),
and Deno/TypeScript checks pass.
Remaining: named non-text controls, declarative focus bindings, keyboard-access-
enabled paths, nested/custom-routing/non-text/WebKit sheets, WebKit IME/accessibility,
directional arrows, and the recorded intermittent SwiftUI sheet-animation crash.
Keep the broad focus/navigation item unchecked.

Named date controls completed (2026-11-06): DatePicker now accepts `focusName`,
sharing the exact-UTF-8/global namespace with text inputs and WebView. The existing
owned hosting adapter is generalized to HostedNativeControl and reused for all
date styles, with and without a name. It preserves the parent SwiftUI environment
and uses the existing native date binding, bounds, components, and time zone.
Lookup selects the first realized, eligible NSDatePicker in that owned subtree;
it does not open a popover or promise a specific date/time segment. Disabled,
hidden, unrealized, stale, and other-window targets return false. Renaming,
removing, or reassigning names leaves keyed native identity and physical captures
intact; native recreation during style changes can expire physical captures,
while names resolve the current surface. Lifecycle guards/weak references and
immediate retirement are shared with text inputs. Text-only adapter counts remain
available in test snapshots, with a new total hosted-control count for cleanup.
The [form example](examples/forms/app.ts) adds **Focus appointment**.
Focused validation passes: native build, 110 unit tests, Deno/TypeScript checks,
two identically labeled native date controls with distinct exact Unicode names,
first focus without captures, date target/actions, explicit physical Tab cycles,
keyed rename/reassignment/removal, atomic malformed names and date/text/web
namespace collisions, inherited disabling/hidden availability, graphical/date,
automatic/time, compact/date and compact/date-and-time native eligibility,
time-zone changes, active-sheet isolation, real lazy realization, and 20 focused
owner removals at baseline adapters/views/cells/callbacks. A startup duplicate-
name fixture now additionally covers a DatePicker/text collision and full failure
cleanup. Final validation passes: native build, all 110 unit tests, all 67
offscreen native scenarios (including existing bridge/lifecycle, date styles/
bounds/zones/bindings, text registration, and WebView gates), and Deno/TypeScript
checks. The broader focus/navigation checkbox remains unchecked.
Remaining focus work: named buttons/toggles/sliders/steppers/choice pickers,
declarative focus bindings, keyboard-access-enabled paths, nested/custom-routing/
non-text/WebKit sheets, WebKit IME/accessibility, directional arrows, and the
recorded intermittent SwiftUI sheet-animation crash. Keep the broad item unchecked.

Directional commands completed (2026-11-06): `Focus.move('left' | 'right' | 'up' |
'down')` returns whether the active native window moved to a visible geometric
neighbor. It walks the recalculated AppKit key-view loop with cycle detection, or
uses a valid explicit traversal cycle as its candidate set. Shared field editors
resolve to their controls; internal WebKit responders normalize to one browser
container. Eligibility/visible clipping exclude disabled, hidden, fully clipped,
unrealized, other-window, and Tab-excluded browser targets. Geometry intersects
native bounds with visibleRect (non-clipping views can expose a larger visible
extent), converts into window-content coordinates, and handles flipped vertical
axes. Perpendicular overlap is preferred, then forward-edge gap and center
distance; other candidates use a 90-degree direction cone and center distance.
Native key-loop order breaks ties. Parent containers yield to eligible leaf key
views. There is no edge wrapping, explicit scroll request, capture allocation,
or event interceptor. No current eligible responder/no neighbor/refusal returns false;
existing purity, canceled-task, shutdown, and active-sheet guards apply. Text
caret, multiline/IME, and browser arrow keys retain native handling. The new
[directional demo](examples/focus-direction/app.ts) shows mixed native/web input.
Focused validation passes: native build, 110 unit tests, Deno/TypeScript checks,
and a native 2×3 plain/secure/editor/date/WebKit matrix. Tests cover four axes,
no wrapping, aligned/diagonal and cone choices, explicit membership/unavailable
fallback, preserved DOM selection, keyed/captured identity, atomic invalid
directions, sheet isolation, real lazy realization, and 20 focused owner removals
at baseline native views/cells/registrations/Node callbacks without activating or
keying windows. Final validation passes: native build, all 110 unit tests, all
67 offscreen native scenarios (including existing bridge/lifecycle, text/date/
WebView, sheets, lazy realization, and teardown gates), and Deno/TypeScript checks.
Concrete non-text verification blocker remains: current full keyboard access is
false, and real NSStepper/NSSegmentedControl views report ineligible (the existing
native test observed one eligible date control and two excluded controls). Do not
change the user's keyboard preferences or force native eligibility to claim those
paths verified. Their named eligible paths remain open; directional commands can
be verified independently with the real eligible text/date/web controls above.
Remaining: named buttons/toggles/sliders/steppers/choice pickers, declarative focus
bindings, full-keyboard-access paths, optional non-editing arrow-event routing,
nested/custom-routing/non-text/WebKit sheets, WebKit IME/accessibility, and the
recorded intermittent SwiftUI sheet-animation crash. Keep the broad item unchecked.

Mixed-sheet focus/RPC coverage completed (2026-11-06): a new real AppKit sheet
combines plain/secure text fields, a multiline editor, DatePicker, and a two-input
WebView. It exercises captured command cycles, atomic rejection of unsupported
custom sheet Tab routing, native forward/reverse DOM entry/exit, Return/Unicode/
secure/newline edits, actual sheet NSDatePicker actions, inherited disabled and
passive-browser Tab eligibility, live snapshot/RPC data, preserved DOM selection,
and keyed identity. The test-only date enumeration/action adapters now follow
currentFocusWindow like field/editor/focus adapters; previously they always
inspected the parent. An independent parent date verifies correct sheet binding
and isolation. No ordinary application API or date behavior changes.
Normal dismissal/reopening retains the logical owner's scopes, edited state,
and node handles; physical captures still retire on window-context changes.
Reload and logical owner removal cancel pending browser calls, abort signals,
and suppress late writes to shared/local State and late focus attempts. Twenty
focused owner removals with pending calls return native views/cells/names,
hosted controls, Node callbacks, exported APIs, and pending requests to baseline.
Focused native validation passes with all windows transparent/non-key and the
app inactive. The initial full run passed the 66 existing gates, then the new
mixed-sheet gate reproduced the recorded framework crash: UpdateCycle
UC::DriverCore::continueProcessing called a null address inside AppKit's
NSSheetMoveHelper.closeSheet animation loop during normal display-cycle layout.
Offscreen launchers and sheets now set the public NSWindow.animationBehavior
policy to .none, retaining real sheet presentation/teardown without automatic
order-front/out animation. The mixed-sheet test asserts that policy in both
parent and sheet contexts; ordinary launches keep their existing animation
behavior and no user preference is changed. Focused policy validation passes;
three additional 20-owner stress runs and all 67 native integration scenarios
pass with the policy applied. The animated framework path
remains a platform limitation, rather than a claimed production crash fix. The existing
110 unit tests and Deno/TypeScript surface are unchanged by this test-adapter/
integration increment. This closes the mixed text/date/WebKit single-sheet
coverage gap. Custom sheet Tab routing was still open at this checkpoint and is
implemented in the increment below. Nested sheets, additional non-text
keyboard-access paths, declarative bindings, optional arrow-event routing,
WebKit IME/accessibility, and the recorded intermittent sheet-animation crash
remain open. Keep the broad focus/navigation item unchecked.

Single-sheet captured Tab routing (2026-11-07): the owned `JonUIApplication`
subclass now routes eligible Tab/Shift-Tab events before AppKit dispatches to
launcher or SwiftUI-owned sheet windows. The bundle declares that principal
class and startup verifies it. The host filters to the active focus window,
preserving parent isolation and context retirement. No framework window delegate,
global monitor or key-view links are replaced. Unhandled production events pass
to AppKit's application dispatcher. The sheet example can enable a named-field
captured cycle and reset native traversal.

Focused offscreen gates pass for text-only and mixed text/date/WebKit sheets.
Handled Tab/Shift-Tab events exercise the actual application `sendEvent` override,
including wrapping, multiline non-insertion and mixed-control responder changes.
Composition/shortcut/key-up bypass and native reset use window-local default
dispatch in the test adapter because these windows deliberately remain non-key.
Atomic stale-target rejection preserves the active mode. Existing tests retain
disabled/keyed identity, dismissal/reopen model preservation, parent isolation,
RPC cancellation and 20 pending focused owner retirements per sheet scenario.
Validation: native build, all 67 offscreen native integration scenarios, 110
runtime/compiler unit tests, Deno/TypeScript checks and API classification pass.
Keep the broad focus/navigation item unchecked: nested sheets,
generation-safe declarative bindings, remaining named
controls, real keyboard/IME/AX and non-text keyboard-access paths remain open.

Actual focus-name snapshots completed (2026-11-07): `Focus.currentName()` reads
the current eligible responder's declared name in the active window or sheet.
This provides actual-focus inspection before designing generation-safe declarative
requests. It does not infer focus from queued SwiftUI notifications, publish a
binding, subscribe or allocate cells/callbacks/capture IDs. Native name queries
and requests share a target resolver; plain/secure field editors map to their
owning control and WebKit DOM descendants map to the named browser. Unnamed,
cleared, hidden/disabled and passive-browser responders return null. Exact Unicode,
committed rename/removal/reassignment and keyed physical identity are preserved.
Node rejects render/computed use and suppresses canceled-task/post-shutdown reads.
The sheet example displays the actual name after navigation commands.

Focused native validation passes for text/date/WebKit/DOM, repeated queries with
no editing/caret churn or query allocations, unavailable/unnamed controls,
active-sheet isolation, name changes and 20 focused owner retirements. Two runtime
cases and positive/negative type checks pass (112 unit tests total), including
canceled RPC reads returning null without querying native focus. Final validation:
native build, all 68 offscreen native integration scenarios, 112 unit tests,
Deno/TypeScript checks and API classification pass. The native gate also follows
actual Tab/Next/Clear changes independently of the last named request.
The broader focus item stays unchecked.
Concrete blockers remain: keyboard access is false, excluding real stepper/choice
eligible-focus paths; do not change preferences to claim them verified. Nested
sheets need a guaranteed early offscreen policy for every framework window before
testing presentation. Next: separate generation-stamped desired requests from
actual focus observations; stale framework notifications must never write a newer
desired request. Define native observation/acknowledgement and owner/window
retirement semantics before exposing a two-way binding. Eligible named controls
and IME/AX/hardware coverage remain open.

Focus observation completed (2026-11-07): `Focus.subscribe` reports coalesced
actual native name changes without replay or desired-state writes. One shared
native KVO observer follows the active window; window notifications and commits
also schedule fresh responder samples for sheets, shared field editors, names
and availability. The public callback receives the same nullable-name contract
as currentName. Internal watch acknowledgement and events carry a fresh session
token, sequence and context counter; old sessions, nonmonotonic sequences and
older contexts cannot replace a newer observation. Native samples read actual
focus on delivery instead of trusting queued framework values. Context-only
events update the baseline without duplicate public callbacks.

Last-listener cleanup invalidates KVO/notification registrations, task cancellation
owns subscriptions, and components return cleanup from effects. Queued samples
and callbacks are inert after retirement. Native listeners never write a desired
request, activate windows or change event dispatch. The sheet example displays
an observed field label. Four runtime tests cover exact Unicode, malformed/stale
events, failure rollback, listener reentrancy, shared sessions, reactive purity,
task/effect cleanup and callback-error shutdown (116 total tests).
Focused offscreen validation passes for native text/date/WebKit, shared field
editor movement without query polling, DOM-name stability, canonical Unicode
rename, disabled/passive controls, sheet observer/context retirement, 20 queued
focused owner removals and intentional callback-failure teardown. RPC cancellation
also releases task-owned focus subscriptions in runtime tests. Final validation:
native build, all 70 offscreen native integration scenarios, 116 unit tests,
Deno/TypeScript checks and API classification pass. Keep broad focus/navigation unchecked.
Next: define generation-stamped desired requests and their native acknowledgements
against observation sequence/context before exposing a two-way Binding; the
current asynchronous observation stream may lag a synchronous snapshot. Keyboard-
access/IME/AX and safe nested-sheet coverage remain blocked as recorded above.

Focus request acknowledgement completed (2026-11-07): while subscriptions are
active, imperative focus movements carry a monotonically increasing request
generation. Native acknowledgement includes the actual name, session, observation
sequence, generation and window context before the method returns. Older queued
events cannot overwrite that newer result. Native replay/stale-session rejection
and an optional expected-context guard establish the protocol for future owned
declarative requests. Imperative methods retain active-window semantics and
their public boolean/void return types. Invalid stamps and operation-validation
failures do not consume generations; context rejection acknowledges actual focus
without moving it before evaluating the operation.

Node coalesces delivery in a microtask and compares each listener's own baseline.
A newer request replaces pending old observations, including a reentrant request
from another listener; newly joining listeners get no initial replay. Two new
runtime cases cover queued gain/blur, consecutive requests, acknowledgement floors,
stale generations, reentrant movement, pending joins and round trips (118 total).
The focused offscreen gate passes a real queued native gain followed by a newer
blur, captured/directional/unavailable requests, replayed generations, a retired
sheet context, stale sessions, invalid counters/options and 20 queued owner
retirements. Final validation: native build, all 70 offscreen native integration
scenarios, 118 unit tests, Deno/TypeScript and API classification pass. An
additional focused run also verifies unacknowledged native shared-field-editor
traversal independently of the request acknowledgement path.
Keep the broad item unchecked. Next: an owned declarative controller must keep
desired state separate from observed state and bind requests to owner/context
lifetime; no public two-way Binding or FocusState is shipped in this increment.
The previously recorded keyboard-access/IME/AX/nested-sheet gaps remain open.

Owned focus controller completed (2026-11-07): setup-only `scope.focus` exposes
tracked validated desired intent and read-only actual/retired computations. Two
owned effects establish a fresh active-context snapshot and apply requests after
view commit. Initial null is passive; an initial name attempts once. Explicit
request(name) retries unchanged names or clears with null. Native movement and
availability update actual without writing desired or causing focus feedback.
Unavailable targets keep the desired value and require an explicit retry.

The controller binds generations to its initial watch session/window context.
Context-only observations and native rejection retire it permanently, clear
actual and stop its observer. Retired desired data remains editable; requests
cannot affect a new sheet or resume on the parent automatically. Remount starts
a fresh controller. Owner cleanup releases four cells, two effects, two computed
values and its shared-watch subscription; canceled/disposed work cannot issue
late requests. The new example demonstrates modal retirement and a reset that
preserves app-owned form values. General projected/boolean FocusState bindings,
safe context resumption and availability/realization-aware policy remain open.

Focused native validation passes for passive activation, initial named requests
over 20 mounts, native text/date/WebKit, repeated/failed requests, desired/actual
isolation, Unicode editor bindings, keyed identity, modal retirement and 20 pending/
canceled owner lifetimes with baseline resources. Five runtime cases (123 total)
cover validation/read-only state, timing, context-only retirement, native context
rejection before notification, multiple controllers without feedback, keyed
ownership, canceled work, purity and snapshot-failure cleanup. Deno/TypeScript
checks pass. Final validation: native build, all 71 offscreen native integration
scenarios, 123 unit tests, Deno/TypeScript checks and API classification pass.
Keep the broad focus item
unchecked; next define context resumption and a projected binding contract without
reintroducing observation-to-desired feedback. Hardware/IME/AX/nested-sheet gaps
remain recorded above.

Explicit focus resumption completed (2026-11-07): `FocusController.resume()`
preserves controller/model identity and desired intent while stopping the old
observation and queuing a fresh context snapshot after commit. It is passive;
older queued requests and retained intent are not replayed. Requests or changed
desired values after resume can apply in the same turn. Repeated resumes use the
last baseline; disposal prevents queued activation. The controller now owns five
cells (including activation), two effects and two computations.

Task/RPC birth epochs and per-controller leases prevent earlier work from writing
into a controller resumed by another caller. A current task explicitly resuming
can authorize its following writes; cancellation takes precedence. Pending
request and resume callers are checked again before after-commit native work,
including RPC document replacement. Accepted desired data remains local data.
The example offers passive resume alongside full component reset.

Six new runtime cases bring the total to 129, covering passive/queued/same-turn
resumption, no replay, identity, task/RPC leases, explicit authorization, disposal,
cancellation and document replacement. Focused native checks pass through
same-window/sheet/parent resumption with preserved model identity, an older task,
20 observer resume cycles and 20 canceled/pending owner lifetimes. Deno/TypeScript
checks pass. The first full regression run reproduced the recorded framework
sheet-close crash in the mixed-sheet gate (which does not call resume): the
2026-11-07 01:41:33 -0600 report again shows a null call from
UC::DriverCore::continueProcessing inside NSSheetMoveHelper.closeSheet's nested
animation loop. NSWindow.animationBehavior.none alone has not eliminated this
intermittent platform failure. The focused mixed-sheet rerun and all 71 scenarios
in the full-suite recheck pass. Final caller-reference cleanup also passes the
focused controller gate. All 129 unit tests, Deno/TypeScript checks and API
classification pass. No framework crash fix is claimed. Keep the broad focus item
unchecked. Next: define projected focused bindings and boolean variants without
observation-to-desired feedback. Automatic physical-window resumption, lazy target
realization policy and recorded hardware/IME/AX/nested-sheet gaps remain open.

Projected focus bindings completed (2026-11-07): `FocusController.binding(name)`
returns a branded boolean projection. Reads track actual focus and writes queue
requests without observation-to-desired feedback. `view.focused(projection)` wires
TextField/SecureField/TextEditor/DatePicker/WebView through single-child modifiers
and nested components. Only the name reaches native; projections allocate no
cells, callbacks or handles. Focused views must descend from the controller's
component so owner retirement removes all associated registrations.

False cancels retained/pending intent for its target while preserving a valid
newer request for another name. Native `focus.blurNamed` checks exact UTF-8 actual
name and the active window before clearing, using generation/context acknowledgement
guards. Observation lag, canonical-equivalent names and canceled pending callers
cannot clear a newer different responder. The example now uses projected widgets.
FocusState is Partial for this named subset; standalone boolean controllers,
typed selections and broad SwiftUI overloads are not claimed complete.

Five new runtime cases (134 total) cover tracked observed/deferred values, modifier
wiring, wire metadata exclusion, retained/unavailable/conditional clears, canceled
callers, brands, unsupported targets, ownership and disposal. Focused native checks
pass text/date/WebKit/child/modifier paths, exact Unicode conditional blur, newer
intent, Return snapshot ordering, disabled and sheet/resume behavior and 20 pending
owner lifetimes. Final validation: native build, all 72 offscreen native integration
scenarios, 134 unit tests, Deno/TypeScript checks and API classification pass.
Keep the broad focus item unchecked. Remaining: standalone boolean/
typed projections, additional named native controls subject to keyboard-access
eligibility, physical-window resumption/realization policy, IME/AX/nested-sheet
coverage and the recorded intermittent AppKit sheet-close crash.

Standalone boolean focus controllers completed (2026-11-07): setup-only
`scope.focusBoolean(initialFocused = false)` exposes desired boolean intent,
read-only actual/retired state, one opaque `binding`, deferred requests and passive
resume. Each controller generates its own name and reuses the named controller's
resource ownership/context/task guards. Independent desired values do not feed
back from native observations. Changed false intent conditionally clears its own
target, preserving an unrelated responder; equal desired writes are inert and
explicit requests retry. The binding attaches to one supported descendant input;
duplicate use follows native duplicate-name rejection. Global name observations
can expose generated names, which have no stable public identity. Added a runnable
boolean example and compile-time positive/negative API checks.

Validation: all 137 runtime/compiler cases, Deno and TypeScript checks pass.
The focused offscreen native gate verifies five independent text/secure/editor/
date/WebKit targets, Unicode Return ordering, keyed identity, conditional clear,
per-controller stale-task leases, modal retirement/passive parent resume and
20 pending-request/resume owner lifetimes at baseline resources. All 73 offscreen
native integration scenarios and API classification pass. No native source or
bridge protocol changed. The recorded AppKit crash did not recur in this run;
no framework fix is claimed. Keep the broad focus item unchecked. Next: typed
non-string selections/general overloads; additional controls subject to native
eligibility, realization/physical-window policy, IME/AX/nested-sheet coverage and
the recorded intermittent AppKit sheet-close crash remain open.

Typed focus selection completed (2026-11-07): setup-only `scope.focusSelection`
copies a fixed domain of unique well-formed string/finite-number IDs and exposes
typed nullable desired/actual selection, retirement, requests, resume and
`binding(id)` projections. Literal inference prevents an initial value or write
from widening the domain. Runtime validation rejects unknown/invalid IDs before
native work. Opaque names distinguish numeric/string IDs and independent domains;
signed zero is normalized and later domain-array edits are ignored. Unrelated
focus observes as null without overwriting desired selection. Null intent clears
the active context; projection false remains conditional. The named controller's
owner/task/context guards run before selection validation so stale/disposed
callers stay inert. One controller backs every ID with no additional native
resources. Added a runnable typed example and positive/negative API checks.

Validation: all 140 runtime/compiler cases, Deno and TypeScript checks pass.
Focused offscreen native selection passes text/secure/editor/date/WebKit targets,
numeric/string and cross-controller identity, Return Unicode ordering, conditional
and global clear, keyed identity, per-controller stale-task leases, modal
retirement/passive resume and 20 pending owner lifetimes at baseline resources.
All 75 offscreen native integration scenarios pass, including duplicate-projection
startup cleanup with zero cells/views/listeners/callbacks; API classification also
passes. Native source/protocol are unchanged. The recorded AppKit sheet-close
crash did not recur; no fix is claimed. Keep the broad focus item unchecked.
Next: resolve additional native
control registration/eligibility and physical-window/realization policy before
claiming wider focus parity. Dynamic domains/object/symbol IDs and general
overloads, IME/AX/nested-sheet coverage and the recorded intermittent AppKit
sheet-close crash remain open.

Stepper/Picker focus registration implemented (2026-11-07): both accept explicit
focusName and `.focused` projections through modifiers. All named/unnamed instances
share the bounded native host, preserving their existing SwiftUI binding and
environment. Lookup uses public NSStepper/NSPopUpButton/NSSegmentedControl types
inside the owner subtree and real key-view eligibility. Global exact-UTF-8 name
validation includes both controls. Style changes retain logical ownership;
physical captures may expire when the platform recreates a control. Host removal
invalidates cached content/registrations normally. Slider focusName remains
explicitly unsupported. The forms example includes focus requests/status for
theme and amount; the widget ledger and native docs explain platform limits.

Validation: native build, 142 unit/compiler cases, Deno and TypeScript
checks pass. The focused offscreen gate verifies real NSStepper increment actions
and segmented selection, same-label owner mapping, Unicode rename/keyed identity,
atomic malformed/duplicate names, style/disabled/sheet gates, passive resume and
20 owners removed with queued requests at baseline cells/views/listeners. The
NSStepper fixture sends direction values to its native delta adapter. All 78
offscreen native integration scenarios pass, including Stepper/Picker cross-kind
duplicate-name startup cleanup. API classification also passes. The recorded
AppKit sheet-close crash did not recur; no framework fix is claimed.

Concrete validation blocker: this machine has full keyboard access off. The
focused gate records zero eligible new-control requests, five keyboard-excluded
Stepper/segmented checks and three absent public menu/automatic Picker surfaces.
No successful new-control focus/capture/Tab behavior is claimed verified. The test
conditionally exercises those paths when genuinely eligible and never changes
preferences or native key-view flags. Keep the broad focus item unchecked.
Next: define a supported public targeting surface for custom-drawn Button/Toggle/
Slider controls or progress independent realization/context policy work. Full
keyboard access verification, object/dynamic selection domains, general
overloads, physical windows, IME/AX/nested sheets and the recorded intermittent
AppKit sheet-close crash remain open.

Named focus availability completed (2026-11-07): `Focus.availabilityNamed(name)`
returns a synchronous missing/unrealized/inactiveWindow/unavailable/ready snapshot,
or null for canceled/post-shutdown callers. It reuses the native name registry,
adapter attachment and existing target eligibility, with no additional retained
resources. Queries enforce render/computed purity and do not issue focus movement,
consume request generations, scroll, retry intent or resume an owner. Normal
pending layout/context preparation still applies. Unrealized precedes inactive
window because no native owner-window identity exists yet. Unavailable groups
disabled/hidden/ineligible/unsupported-style targets; ready cannot guarantee
responder acceptance. Lazy caches may remain realized outside the viewport.

The focus example can inspect Demo secret without moving focus. Validation:
144 runtime/compiler cases, native build, Deno/TypeScript and focused offscreen
mixed text/date/choice/WebKit checks pass. Repeated same-context queries preserve
actual focus, desired intent, captures/cycles, request generation and resources;
the actual viewport rectangle stays unchanged.
The native gate covers exact Unicode rename, disabled/hidden/passive targets,
actual lazy scrolling followed by explicit retained-intent retry, sheet isolation
without resumption and 20 owner lifetimes at baseline resources. All 79 offscreen
native scenarios and API classification pass. The recorded AppKit sheet-close
crash did not recur; no fix is claimed. Next: per-controller boolean/typed-ID
availability without exposing generated names; realization subscriptions and
automatic scrolling/retry remain open. Keep the broad focus item unchecked.
Button/Toggle/Slider public targeting,
physical-window ownership/resumption, full keyboard access verification,
object/dynamic selections, general overloads, IME/AX/nested sheets and the recorded
AppKit sheet-close crash remain open.

Owned focus availability completed (2026-11-07): named controllers expose
`availability(name)`, boolean controllers `availability()` and typed selection
controllers `availability(id)` for non-null declared IDs. Boolean/selection
wrappers map their stable generated names privately. Results use the existing
five-state snapshot in the active native context, without movement, intent
changes or resumption. Current retired owners may inspect; owner disposal,
cancellation and stale per-controller task/RPC leases return null before target
validation or the availability operation. Explicit self-resume authorizes a
task's following queries. Native protocol/source and owned resource counts are
unchanged. The boolean and typed demos store Check Notes snapshots in scoped State.

Validation: 147 runtime/compiler cases and Deno/TypeScript checks pass.
Focused offscreen native coverage passes named/opaque text/date/WebKit mapping,
disabled/passive targets, unchanged focus/intent/generation/captures/cycles/
viewport, keyed identity, lazy realization plus explicit retry, per-controller
stale task/RPC queries (including obsolete invalid IDs), fresh RPC queries,
retired sheet snapshots without observers, canceled pending RPCs and 20 owner
lifetimes with late queries returning null and baseline resources. All 80 offscreen
native scenarios pass, including declared-but-unmounted IDs and removing/
reinserting a boolean target while keeping its owner/intent alive. API
classification passes. The recorded AppKit sheet-close crash did not recur;
no framework fix is claimed.
Keep the broad focus item unchecked. Next: define an owned, cancellable native
realization/availability notification contract before adding automatic focus
retry. Button/Toggle/Slider public targeting, physical-window policy, full keyboard
access verification, dynamic/object IDs/general overloads, IME/AX/nested sheets
and the recorded intermittent AppKit sheet-close crash remain open.

Native appearance signals completed (2026-11-07): `.onAppear(callback)` and
`.onDisappear(callback)` bridge SwiftUI events to synchronous Node callbacks.
Modifiers retain ID/phase/token identity through handler replacement and keyed
reorder; queued events use the latest callback, while phase changes and logical
removal retire tokens. Native/Node checks reject stale source/phase/token events.
Functions never enter native descriptors. Callbacks run untracked without an
inherited task context, can update State/query availability, and add no native
observer/timer/cell or wrapper. Promise/thenable returns are consumed/diagnosed;
types reject inferred Promise callbacks. The demo shows editable lazy rows and
an event history. Component setup/disposal remains logical ownership; final
disappearance after removal/close may be dropped, so guaranteed cleanup stays
in scope.onDispose. Appearance is not viewport/focus/document readiness.

Failure tests exposed a startup gap: if a later child/sibling threw before root
reconciliation completed, earlier scopes could miss disposal. Startup now tracks
partial mounts, calls onStop once before teardown and retires partial children
before parents; successful startup releases the temporary tracking set.

Validation: native build, 150 unit/compiler cases and Deno/TypeScript pass.
Focused offscreen native checks pass lazy/sheet appearance and disappearance,
eager logical versus lazy native lifetime, latest callbacks/stable tokens,
Unicode keyed state, atomic native validation, discarded post-removal events and
20 owner lifetimes at baseline resources. All 85 offscreen native scenarios pass,
including callback State writes, four native error paths and partial-startup cleanup. Callback failures
stop the embedded runtime immediately, so their fixtures use synchronous stop/
disposal markers; unit tests check zero callbacks/cells/dependencies, and startup
failure checks native zero counts too. API classification passes. The recorded
AppKit sheet-close crash did not recur; no framework fix is claimed.
Keep the broad focus item unchecked. Next: availability-specific subscriptions
with cancellation/context policy; appearance hooks alone must not automatically
retry focus. Public Button/Toggle/Slider targeting, physical windows, keyboard
access/IME/AX/nested-sheet and the recorded AppKit sheet-close gaps remain open.

Named availability subscriptions completed (2026-11-07):
`Focus.subscribeAvailability(name, listener)` returns idempotent cleanup and
delivers an asynchronous initial snapshot plus coalesced five-state changes.
Exact names share a native watch; per-listener replay/dedup and token/sequence
guards prevent stale delivery. Native bounded-host/WebView attachment/layout,
coordinator changes, commits and four shared window notifications drive sampling
without timers. A sampling guard prevents layout feedback and an epoch discards
queued work after the final watch stops. Native watches retain only names/status/
counters. They follow the active native context without binding a physical window
or resuming controllers, retrying intent, scrolling, capturing or consuming focus
generations. Triggerless OS eligibility changes may need an explicit snapshot;
cached ready views do not imply viewport/document readiness.

Effect cleanup and task/RPC lifetimes remove listeners; scoped-task resources
remain owned after Promise settlement, RPC resources retire on settlement/source
replacement/cancellation. Callbacks run untracked with task context retained when
appropriate, are synchronous, and can mutate subscription membership. Invalid
registration rolls back; throws/Promise returns use normal failure cleanup. The
final name releases native window observers; shutdown also clears app-owned
watches and callback references. Added a show/disable/sheet/watch-toggle demo.

Validation: native build, 155 unit/compiler cases and Deno/TypeScript pass.
Focused offscreen native checks pass async/shared Unicode snapshots, enabled/
passive/lazy/sheet changes, State updates, unchanged focus/intent/generation/
captures, task/effect/RPC ownership and source cancellation, 20 owner lifetimes,
immediate unsubscribe and final/app-owned shutdown with zero native watches/
observers/cells. All 88 offscreen native scenarios pass, including listener
error/Promise cleanup; API classification passes. The recorded AppKit sheet-close
crash did not recur; no framework fix is claimed. Keep the broad focus item
unchecked. Next: boolean/typed owned
subscription helpers with explicit controller lifetime/context rules before
automatic focus retry. Public Button/Toggle/Slider targeting, physical-window,
full keyboard access, IME/AX/nested-sheet and recorded AppKit crash gaps remain.

Owned availability subscriptions completed (2026-11-07): controllers expose
`subscribeAvailability(name, listener)`, boolean `subscribeAvailability(listener)`
and typed `subscribeAvailability(id, listener)` with generated names kept private.
They share the global watch but belong to one controller lease/context. Retirement,
resume, canceled activation and owner disposal stop subscriptions automatically;
task/RPC cleanup removes owner tracking as well. Retired/stale/canceled/disposed
registration is inert before validation. A fresh subscription can follow resume
in the same turn; resume never restarts the old one. The demos use an effect
depending on retired state to explicitly bind observation to a new session.

Every delivery verifies lease/caller/readiness and the native focus snapshot.
Acknowledgements must reach shared focus observation before a mismatch retires
the owner, or native sampling could consume the window transition without sibling
controllers learning it. The callbacks do not cross an ended context, resume an
owner, change intent, request focus or consume movement generations. Observation
sequences may advance. Global subscriptions still follow active-window changes;
owned snapshot queries remain usable while retired. Native source/protocol and
cell/effect counts are unchanged.

Validation: 159 runtime/compiler cases and Deno/TypeScript pass. Focused
offscreen native coverage passes private numeric/string/boolean mapping, async
initial/shared watches, resume-before-initial cancellation, same-turn fresh
subscription, per-controller task/RPC leases, document cancellation, lazy readiness
without retry, sheet retirement and explicit parent/sheet re-subscription,
automatic disposal without manual stop and 20 pending owner lifetimes at baseline
resources. Unit tests force availability-before-focus delivery and confirm sibling
retirement, plus throw/Promise/native snapshot failure cleanup. All 91 offscreen
native scenarios pass, including owned listener error/Promise cleanup; API
classification passes. The recorded AppKit sheet-close crash did not recur;
no framework fix is claimed. Keep the broad focus item
unchecked. Next: a cancellable explicit retry policy for retained unavailable/lazy
targets, respecting session, caller and viewport/realization limits. Public
Button/Toggle/Slider targeting, physical windows, keyboard/IME/AX/nested-sheet and
the recorded AppKit sheet-close gaps remain open.

Explicit one-shot focus retry completed (2026-11-07): named, boolean and typed
controllers now expose `retryWhenReady(): () => void` for current retained intent.
It shares an owned availability watch, rechecks readiness/context/responder and
queues one after-commit attempt, ending even on refusal. Waiting does not poll,
scroll or realize a lazy target. Already-focused/null intent is inert. Stop,
new intent/request, applicable projected clear, rearm, resume, retirement,
disposal and task/RPC cancellation invalidate waiting or queued retry work.
Equal desired writes stay inert; old stop closures cannot cancel newer retries.
Resume requires explicit rearming and supports a same-turn fresh arm.

A weak native responder-owner revision protects against observed moves between
unnamed fields sharing AppKit's editor, including availability-before-focus event
delivery. Public named observers still notify only name changes. The guard is
coalesced, so brief round trips between samples may be missed; typing/DOM selection
within the same control is not a general user-activity signal. No new controller
cells/effects, capture retention or polling were added. Ready retains native
eligibility limits and does not mean viewport/document readiness; AppKit can
naturally scroll an already-realized target when it receives focus.

Validation: native build, 164 runtime/compiler cases and Deno/TypeScript pass.
Focused offscreen native coverage passes disabled-to-ready one-shot focus,
boolean/typed supersession, real unnamed shared-editor movement, stop/resume/
task/RPC/source/sheet cancellation, external lazy scrolling and 20 pending owner
lifetimes with baseline resources. The initial fixture incorrectly assumed native
field order; a test-only field-owner mapping now resolves real targets by identity.
Unit checks cover ready refusal, queued cancellation and newer conditional clears.
All 92 offscreen native scenarios and API classification pass; the recorded
AppKit sheet-close crash did not recur. The new focus-retry demo and
focus/bridge docs describe the lifecycle and visibility limits. Keep the broad
focus item unchecked. Next: define public targeting for custom-drawn Button/Toggle/
Slider without forcing native keyboard eligibility. Physical windows,
keyboard/IME/AX/nested-sheet policy and the recorded AppKit sheet-close crash
remain open; no framework fix is claimed.

Button/Toggle/Slider naming and projection registration implemented (2026-11-07):
Button takes optional third-argument `{ focusName }`; Toggle and Slider accept it
with their binding options. All three accept named/boolean/typed `.focused`
projections and join global atomic UTF-8 validation. Named instances opt into the
bounded SwiftUI host, resolving only enabled/eligible public NSButton,
NSButton/NSSwitch or NSSlider respectively. Unnamed rendering remains unchanged.
No AppKit replacement, private SwiftUI lookup or forced responder eligibility is
introduced. Name/property updates and keyed reorder retain logical state/current
handlers; removing/reintroducing naming switches hosting paths and may replace
physical identity. Normal coordinator invalidation and weak bindings/actions
prevent retired content from registering or mutating an old owner. The forms demo
adds names and reports unavailable targets.

Concrete positive-focus blocker: this SDK's offscreen SwiftUI versions expose no
matching public Button/Toggle/Slider control. The native fixture reports zero
eligible, zero excluded and twelve absent surfaces with keyboard access false.
Registered realized hosts report unavailable and requests retain intent without
moving unrelated focus. Successful native focus/capture/Tab, physical pointer/key
interaction and any claim that enabling keyboard access resolves this are
unverified. Conditional tests exercise positive branches only when genuine native
targets exist. A future SwiftUI-native asynchronous FocusState adapter needs an
explicit contract separate from synchronous first-responder acknowledgements.

Validation: native build, 165 unit/compiler cases and Deno/TypeScript pass.
Focused offscreen naming/private owner mapping, action/scalar bridge, current
handlers, atomic names/options, Unicode/keyed identity, opt-in removal/reinsertion,
disabled/sheet/resume gates and 20 pending owner lifetimes pass. Added three
cross-kind duplicate startup cases with zero-resource teardown. Native Button/
Toggle descriptors now validate titles/options; the existing missing-binding
fixture supplies a valid title so it tests that failure independently. All 96
offscreen native scenarios, 165 unit/compiler cases, both type checkers and API
classification pass after that correction. The recorded AppKit sheet-close crash
did not recur; no fix is claimed. Keep the broad focus
item unchecked. Custom-drawn positive targeting is blocked as above; next
independent work is explicit physical-window ownership/context policy. General
keyboard/IME/AX/nested-sheet and the recorded AppKit sheet-close gaps remain open.

Physical-window focus constraints implemented (2026-11-07):
`Focus.captureWindow()` captures the current main/deepest-sheet physical window
as a frozen opaque weak identity. All three focus constructors accept a last
`{ window }` options argument, copied before allocating state. A pinned owner
activates/resumes only on that physical window; otherwise it stays retired with
retained desired data, canceling pending requests/retries/session subscriptions.
Returning to its window permits passive explicit resume and new intent. Existing
unrestricted/global behavior remains active-context based. Retired availability
snapshots still describe current active targets without enabling requests.

Native observations/acknowledgements include a physical identity independently of
watch sessions. Request stamps check that weak window reference immediately before
moving focus, covering a transition after the JS activation barrier. Wrong or
destroyed/unknown owners reject with an actual observation and consume a generation;
malformed counters do not. Internal metadata uses window changes; public listeners
remain name-only. Identity lookup deduplicates/prunes weak entries, and shutdown
clears the registry; no extra observer/timer/native cell/effect or retained window
is added. Identity is physical, not presentation-based: a SwiftUI-cached sheet may
reuse it, with explicit resume still required. No window opening/activation,
independent roots, name domains, event/close ownership or full SwiftUI scenes are
claimed. The new focus-window example captures from an action before mounting
the guarded component, and documents immutable construction-time ownership.

Validation: native build, 169 runtime/compiler cases and both type checkers pass.
Focused offscreen native main/sheet guards, named/boolean/typed requests, immutable
options, invalid-owner resume/retry/subscription suppression, native stamp checks,
canceled captures, passive return, stable identity across watch sessions and 20
pending owner lifetimes pass without activation. Four new unit cases cover foreign
brands, allocation/purity guards and availability-before-focus/queued-request races.
All 97 offscreen native scenarios and API classification pass. The recorded
AppKit sheet-close crash did not recur; no framework fix is claimed.
Keep focus and multi-window items unchecked;
next independent increment is explicit ownership of independent native roots,
including root/session name scoping, event routing and close/cancellation policy.
Custom-drawn positive control focus, hardware keyboard/IME/AX/nested-sheet and the
recorded AppKit sheet-close gaps remain open.

## 3. Application and operating-system integration

Button Command shortcuts completed (2026-11-07), continuing keyboard navigation:
`Button(...).keyboardShortcut(key)` accepts one lowercase ASCII letter/digit and
uses SwiftUI's native Command key equivalent. It works through single-child
modifiers and named bounded hosts. A copied/frozen key descriptor crosses the
bridge; functions stay in the existing current-action table. Native validation
rejects malformed descriptors before graph mutation. No production key interceptor,
event monitor, callback token or state cell is added. Changing/removing the key,
disabled ancestors, logical owner disposal and window/sheet scoping use existing
native/lifecycle paths. Root-scoped focus requests can run from the callback.

The initial API deliberately rejects options and explicit modifiers. Concrete
validation blocker: offscreen SwiftUI matching did not consistently distinguish
shifted/unshifted same-letter chords, including queued current-event flags and
physical key-code probes. No modifier-selection API is shipped or claimed verified.
Default Command letters/digits are independently implemented and verified; special/
unmodified keys, layout/localization, hardware IME, menu conflicts/scopes and repeat
policy remain future work. Do not change keyboard preferences or fake eligibility
to claim those paths pass.

Validation: native build, 177 unit/compiler cases and Deno/TypeScript pass. Focused
native actual key-equivalent handling verifies callbacks and native handled status,
text focus preservation, current handlers/keyed reorder, property changes, named
hosts, disabled ancestors, unhandled removed/unmatched chords, sheet isolation,
same-chord independent roots and 20 owner lifetimes at baseline resources. A real
shortcut callback failure stops/disposes once. Test events traverse AppKit's event
loop with matching current flags; test-only pending/results retire on consumption/
shutdown. The demo adds Command-1/2 focus and Command-S Save.
The initial full native run passed 54 scenarios before focus-sheets crashed with
SIGSEGV. The 2026-11-07 05:37:55 -0600 report matches the previously recorded
UC::DriverCore::continueProcessing → NSMoveHelper._doAnimation →
NSSheetMoveHelper.closeSheet → SwiftUI SheetBridge/NSHostingView teardown stack.
This is a recurrence of the recorded platform failure, not a claimed fix. Focused
focus-sheets recheck passes all 20 owner cycles. The full recheck passed 71
scenarios before focus-mixed-sheet crashed with the same recorded sheet teardown
signature. The focused mixed-sheet recheck also SIGSEGVs with the same recorded stack
(2026-11-07 05:44:17 -0600 report). It is now a concrete full-suite blocker. Gates
after that scenario pass all 32 checks independently, including native shortcuts
and callback failure. Together with the second run's 71 passes, 103 of 104
scenarios pass across partitioned runs; mixed-sheet is the blocker. Native build,
177 unit/compiler cases, both type checkers and API classification pass. No clean
uninterrupted full-suite pass or framework fix is claimed. Keep broad focus and
richer menus/commands items unchecked.
Next independent priority: native tap gesture callbacks; explicit modifier support
needs a reliable platform/layout validation contract first. See docs/shortcuts.md.

- [x] Support multiple windows with independent roots and explicit window ownership.
- [ ] Add richer menus, commands, and keyboard shortcuts.
- [ ] Add native open/save dialogs and document lifecycle support.
- [ ] Add drag-and-drop and clipboard APIs.
- [ ] Define activation, reopen, and last-window-close policies and test their teardown paths.

Owned independent windows completed (2026-11-07) for the binding-driven v0 API:
`view.window({ isPresented, title, width, height, content })` owns one native root
per modifier. Child scopes mount only while presented and dispose on false/native
close/removal; reopening creates fresh locals. Title updates preserve root identity
and dimensions apply only at creation. Shared app State remains explicit. Native
close publishes false without stopping the app, retires adapters/documents before
Node cleanup, and closes nested owned roots. Siblings survive; main close/Quit
ends all roots with one onStop. Independent hosting does not inherit the original
view's surrounding SwiftUI environment; apply environment modifiers in content.

Focus names validate per logical root, including sheets in that root. Transactions
reject shared native handles across roots, and projected bindings cannot cross
their controller's root. Controllers automatically capture logical ownership;
activation/subscription delivery/native root stamps reject sibling/main contexts,
in addition to optional physical guards. Owned availability snapshots inspect their
own namespace; global queries/subscriptions follow the active owned root. Key-window
delegates and existing sheet notifications drive focus context changes. Offscreen
tests select a root without keying/activating windows, including transparent sheets
through auxiliary delegates. Captures/traversal remain context-scoped; explicit
resume is required after switching roots.

Validation: native build, 175 runtime/compiler cases and Deno/TypeScript pass.
Focused native independent state/name domains, native edits, application-dispatched
Tab, title/initial dimensions, atomic/shared-root rejection, auxiliary sheets,
nested close, pending task/WebView RPC cancellation, fresh reopen state, 20 owner
lifetimes and shutdown with an open root pass. Four native startup/projection/
duplicate/cleanup failure cases pass; synchronous failures assert zero resources,
asynchronous cleanup uses synchronous stop/disposal markers. The new window counter
exposed a Swift diagnostics-expression type-checking limit; snapshot construction
now uses explicit typed intermediates. A focused check also caught/fixed auxiliary
sheet offscreen delegate handling before proceeding. Final review added a native
close event barrier: content unmounts before presentation subscribers can reopen,
and retired-node guards block cached adapters/callbacks until graph retirement.
The new unit/native immediate-reopen regression passes with fresh local state;
content IDs guard delayed closes across presentation binding replacement and
prevent a stale event from disposing a newer opening. Replacing the window
modifier with another modifier is a structural boundary, covered by unit/native
regressions so root ownership cannot silently carry into a different domain.
Native build, all 102 offscreen scenarios on the frozen final source, 175 unit/
compiler cases, both type checkers and API classification pass. The recorded
AppKit sheet-close crash did not recur; no framework fix is claimed.
Native scene IDs/WindowGroup, restoration, activation/order APIs, richer
last-window/reopen policy and persistent per-root focus history remain open. See
docs/windows.md and examples/windows/app.ts. Do not claim full SwiftUI scene parity.

## 4. Developer workflow

- [x] Require a reviewed widget/state ledger in normal commit, amend, merge, cherry-pick, patch-import and rebase workflows.
- [ ] Add full module reload with explicit state-preservation and effect-cleanup rules.
- [ ] Add typed TSX authoring with compiler-assisted tracked state reads/writes and automatic native binding props; see SWIFTUI_TODO.md for design and validation milestones.
- [ ] Add live TypeScript type diagnostics in the playground; it currently strips types without checking edited code.
- [ ] Save and reopen playground source edits, which are currently session-only.
- [ ] Add a component/state inspector and useful source locations for runtime errors.
- [ ] Add browser inspection and stronger diagnostics for native and WebKit failures.

Coverage commit workflow completed (2026-11-07), continuing the user's standing
request that the widget/state ledger be updated in every commit. The original
pre-commit-only guard missed other commit paths. Versioned prepare-commit-msg,
pre-merge-commit and pre-applypatch hooks now require reviewed/classified ledger
changes and a current source stamp. They verify without modifying Git's already-
cached tree; only the early pre-commit hook or explicit stamp command mutates the
index. An initial real-Git test exposed that late index writes were omitted from
the resulting commit, so the final design rejects a stale stamp with recovery
instructions instead. Review metadata names checkout HEAD as a baseline, avoiding
an incorrect parent claim on amend. Eleven isolated real-Git tests pass, covering
ordinary review/classification, unstaged edits, idempotence, no-verify/amend,
merge/cherry-pick, patch-import recovery, rebase and non-mutating verification.
No widget/state implementation status changed; the coverage ledger and repository
instructions document this review. Native/runtime/type source is unchanged, so
the existing 110 unit/67 offscreen native/type validation remains applicable.
Local hooks remain bypassable by replacing hooks or plumbing/external clients;
no server-side protection or remote settings change is claimed.

## 5. Distribution and performance

- [ ] Package the runtime, TypeScript/JavaScript entry, dependencies, and assets into a relocatable app.
- [ ] Add signing, notarization, and a reproducible release/distribution workflow.
- [ ] Verify the macOS 14 minimum on an actual macOS 14 machine and cover supported Mac architectures.
- [ ] Profile serialization, view commits, and synchronous state-write hops under realistic workloads.
- [ ] Add state-write batching and event coalescing/backpressure; queue overflow currently aborts the app.
- [ ] Add long-running stress and leak coverage for dynamic components and web controls.

## 6. Web control expansion

- [ ] Add bundled asset loading with a documented local URL scheme.
- [ ] Add automatic content sizing and mixed native/web focus and accessibility coverage.
- [x] Add typed request/reply messaging with cancellation and document-lifetime handling.
- [ ] Define separate navigation/origin policies before supporting remote page browsing.

WebView RPC completed 2026-11-06: WebView accepts a copied plain `api` method
table. Browser `window.jonui.remote<API>()` proxies typed asynchronous calls to
Node, with JSON/void results and name/message error rejection. Functions remain
on Node; descriptors contain method names and a source epoch. WebKit's reply-
capable message handler provides Promise transport. Requests carry document
tokens/call IDs, are main-frame/method/JSON validated, and have a 128-pending-call
limit. Node uses request-owned async context with `WebRequest.current` signal,
cleanup, and guarded commit. Reload/unmount/native retirement/shutdown cancel
pending calls, release reply blocks/subscriptions, and suppress late State/focus/
allocation/publication/reply work. Native validity checks protect queued requests
and reused IDs across recreated browser instances. Rapid A → B → A source updates
force the new epoch through coalesced SwiftUI updates. Data/handler/disabled/focus-
name updates preserve document lifetime.
The new [visualization example](examples/web-rpc/app.ts) keeps models and selection
on Node, renders keyed SVG bars from snapshots, and reports click/keyboard
selections via RPC. See [contracts](docs/web-rpc.md). Focused validation passes:
110 unit tests, Deno/TypeScript checks, real WebKit Promise/error/JSON/void replies,
out-of-order work/current handlers, model snapshots, stale-token/epoch rejection,
backpressure, cancellation/late-write guards, 20 pending owner lifetimes, and
actual SVG mouse/keyboard interaction. Teardown error scenarios verify one stop/
owner disposal for reload and unmount; unit tests verify zero remaining resources.
Native build, all 110 unit tests, all 67 offscreen native scenarios (including
existing bridge/lifecycle gates), and Deno/TypeScript checks pass. Automatic browser TS bundling,
Node-to-browser method RPC, and transferable/binary codecs remain future extensions;
the current visualization flow uses Node snapshots plus browser-to-Node methods.

## Working foundation

- [x] Native AppKit/SwiftUI main thread with embedded Node on a background thread.
- [x] TypeScript constructors, tracked view bodies, keyed rows, primitive bindings, and orderly shutdown.
- [x] Landmarks sample and native lifecycle/error integration tests.
- [x] Editable TypeScript playground with recoverable render errors and preserved shared state.
- [x] Persistent HTML WebView with two-way JSON messages, stale-document checks, and unmount cleanup.

## Validation commands

Run these from the repository root. The pinned Node executable is built by
`scripts/build.py`; no global Node installation is required for these commands.

```sh
python3 scripts/build.py
deno task check
DYLD_LIBRARY_PATH=.build/jonui/lib .build/node/node-v24.22.2/out/Release/node node_modules/typescript/bin/tsc --noEmit
DYLD_LIBRARY_PATH=.build/jonui/lib .build/node/node-v24.22.2/out/Release/node --test tests/*.test.mjs
python3 scripts/test-integration.py
```

Use focused checks while iterating and run the relevant native integration gates
for bridge/lifecycle changes. Native automated windows must stay offscreen and
must not repeatedly interrupt the user's desktop. Preserve unrelated work in the
checkout; do not publish, push, or spend money as part of TODO upkeep.
