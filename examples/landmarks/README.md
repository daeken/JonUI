# Landmarks acceptance target

A two-column macOS window with a favorites filter, landmark rows, a detail view,
a live note editor sheet, and a runtime heartbeat. The reference and TypeScript
target share `fixtures/landmarks.json`. All places in the fixture are fictional.

The scope comes from Apple's
[Landmarks user input example](https://developer.apple.com/tutorials/swiftui/handling-user-input),
with original source, modern Observation, and deliberately no MapKit, images,
networking, persistence, or SwiftData dependency. Notes reset on each launch.

## Required views

| Application view | SwiftUI/API surface exercised |
| --- | --- |
| Sidebar | `NavigationSplitView`, `List(selection:)`, keyed `ForEach`, `Toggle`, `HStack`, SF Symbol `Image` |
| Detail | Conditional content, shared state, `Button`, text, spacers, modifiers |
| Note editor | `.sheet`, `TextField`, two-way string binding, dismissal |
| Footer | State changed by a Node timer while AppKit owns the main thread |

`View(() => ...)` is the TS equivalent of a recomputed custom view body.
The callback runs on Node. Its committed native result is read by SwiftUI.
It is not a callback Swift invokes synchronously while laying out a view.
`State` cells are created once outside these callbacks. Built-in constructors and
modifiers produce SwiftUI values, and keyed rows preserve their identity.

## Behavior acceptance

Run this sequence from a fresh launch in **both** versions. Initial window size
is 900 × 600; exact font rasterization is not an acceptance criterion.

| Step | Action | Required result |
| --- | --- | --- |
| 1 | Launch | Three rows in fixture order; Cedar Ridge and Redstone Arch have stars; detail says “Select a landmark”. |
| 2 | Select Mirror Lake | Detail shows its title, region, description, “No note yet”, and “Add favorite”. |
| 3 | Click Add favorite | Its row gains a star and the button becomes Remove favorite. |
| 4 | Enable Favorites only | All three rows remain, including the newly favorited Mirror Lake. |
| 5 | Remove Mirror Lake from favorites | Its row disappears and selection clears to the placeholder. |
| 6 | Disable Favorites only | Mirror Lake returns without a star; row order is unchanged. |
| 7 | Select Cedar Ridge and edit its note | Sheet shows “Note for Cedar Ridge” and “Bring a sketchbook.” |
| 8 | Replace the note with `Hello 🦊 café` and click Done | Sheet closes; detail shows the exact Unicode text. |
| 9 | Select another row, then Cedar Ridge | Edited note survives navigation and filtering. |
| 10 | Reopen editor, edit, then dismiss by a platform-supported method | Edits remain because this is a live binding, not a Save/Cancel draft. Native dismissal resets presentation state; Edit note can reopen the sheet. |
| 11 | Resize; type rapidly; open/close the sheet repeatedly | Normal native layout, keyboard focus and caret remain usable; no stale notes, frozen window, or crash. |
| 12 | Watch footer for at least three seconds, including with sheet open | Counter advances. For TS, the source is a real Node `setInterval`, not a Swift timer. |
| 13 | Close the last window | Launcher stops Node and exits normally without a stranded process. |

All relevant controls have shared accessibility identifiers for future native UI
automation. The Swift reference uses a Swift task for the heartbeat and the
standard SwiftUI scene lifecycle; it cannot prove Node threading or launcher exit.

## Native integration gates

These are the acceptance requirements for the implementation. Main-thread checks
are enforced in the host, and test-only diagnostics expose native handles and
state revisions. See the validation record below for the checks exercised.

1. A real Node filesystem operation completes while the window is interactive.
2. All bridge calls that create, update, or release SwiftUI boxes execute on the
   process main thread. JS callbacks run on their owning Node environment thread.
3. Native string/bool bindings update their native cell immediately; ordered
   events update the Node mirror before subscribers or a dependent view body run.
   Rapid typing and alternating native/JS writes converge to the last committed
   native value, including after draining all pending events.
4. Timer updates do not reconstruct the entire window or remount the note field.
   Filtering uses landmark IDs rather than row indexes; unaffected rows keep
   native identity.
5. A queued callback for an unmounted view or a shutting-down environment is
   safely discarded. Exceptions in actions/body callbacks reach stderr and cause
   an orderly nonzero launcher exit instead of unwinding through the C ABI.
6. After initial warmup, repeat sheet presentation/dismissal 100 times. Live view
   boxes, subscriptions, and callback registrations return to their baseline after
   deferred releases drain. Final Node/environment teardown leaves none live.
7. Closing the last window and Quit each invoke `onStop` once, drain/cancel work,
   and exit with zero. A fixture variant that throws in an action or body callback
   must print the error, clean up, and exit nonzero. Test these paths separately.

## Milestone completion

The milestone is complete only when `jonui examples/landmarks/app.ts` executes
the target without application-level API changes and passes the behavior and
integration gates. Passing a mock host or declaration-only typecheck is not
completion. Review the API with the sample before broadening SwiftUI coverage.

## Validation record — 2026-11-06

The native launcher, SwiftUI bridge, and reactive runtime now execute this sample
without changing its application API. The development build used macOS 27 on
Apple Silicon, Swift 6.4, and embedded Node 24.22.2, with a macOS 14 deployment
target. Running on an actual macOS 14 machine remains unverified.

- `deno task check` passes the sample and binding type checks.
- Twenty-seven runtime/compiler unit tests cover dependency isolation, batching, conditional
  dependencies, keyed reordering, stale events/callbacks, and unmount cleanup.
- `python3 scripts/test-integration.py` passes nineteen native scenarios: close, Quit,
  action/body/timer exceptions, queue overflow, a timer-free app, startup failure,
  the complete Landmarks driver, the editable TypeScript playground, WebKit controls, scoped components, component cleanup failures, effects, and effect failure/cycle cases. Native transactions reject cycles, missing
  children, and invalid bindings without changing the committed graph.
- The Landmarks driver checks filtering, favorites, shared selection, keyed row
  identity, Unicode bindings, note retention, real Node filesystem I/O and timer
  progress, and 100 actual sheet presentations/dismissals. Native view counts and
  JavaScript callbacks/dependencies return to their warmup baseline.
- Native accessibility/UI checks also exercised selection, the favorite button,
  Unicode paste, caret editing while the Node timer advances, Escape dismissal,
  reopening the editor, Done, and window zoom/restore.

The integration runner places its test windows offscreen and suppresses app
activation. An ordinary `bin/jonui examples/landmarks/app.ts` launch opens a
normal interactive window. All test processes exit; the normal sample can be
left open independently.
