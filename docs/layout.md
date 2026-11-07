# Native layout and scrolling

Layout runs in SwiftUI on the main thread. TypeScript builds immutable view
descriptors; native layout never calls a JavaScript measurement function.

## Scroll views

Import `ScrollView` and give it one content view. Use a stack for multiple children:

```ts
import { ForEach, ScrollView, Text, VStack } from "jonui";

const content = ScrollView(VStack([
  ForEach(Array.from({ length: 100 }, (_, id) => id), { id: id => id }, id =>
    Text(`Row ${id}`).padding({ top: 6, bottom: 6 })),
], { alignment: "leading", spacing: 4 }), {
  axes: "vertical",
  showsIndicators: true,
}).frame({ width: 400, height: 300 });
```

Axes are `"vertical"` (default), `"horizontal"`, or `"both"`. Indicators default
to visible. Hiding indicators keeps scrolling enabled. The enclosing layout must
provide a bounded viewport, through a frame or its containing window layout.
Content may exceed the viewport along the scroll axes. VStack/HStack realize
their content eagerly; use LazyVStack/LazyHStack for native lazy realization.

Updates reuse the scroll node at the same structural position. Changing
axes/indicators or reordering keyed rows preserves mounted component
state and bindings. Removing the scroll view unmounts its subtree normally.
Scroll position is native transient state; there is no public offset binding or
programmatic scroll-to API yet, and position preservation across axis/content
changes is left to SwiftUI.

## Lazy stacks

`LazyVStack(children, options)` and `LazyHStack(children, options)` use the same
alignment and spacing options as their eager counterparts. Put them in a bounded
ScrollView with the matching scroll axis:

```ts
import { ForEach, LazyVStack, ScrollView, Text } from "jonui";

const content = ScrollView(LazyVStack([
  ForEach(Array.from({ length: 250 }, (_, id) => id), { id: id => id }, id =>
    Text(`Row ${id}`).padding(8).frame({ height: 50 })),
], { alignment: "leading", spacing: 4 })).frame({ width: 400, height: 300 });
```

Use `LazyHStack` with `axes: "horizontal"` for horizontally scrolling content.
The native container creates row controls as needed for the viewport. SwiftUI
may prefetch/cache rows, so the realized count is not an exact visible-row count.
Rows can have different sizes; the document's extent can be estimated and refined
as more rows are measured.

Direct `ForEach` children expose each keyed row to SwiftUI independently, including
groups returned through unmodified `View`/`Component` boundaries. Apply row sizing
and other modifiers inside the row callback. A modifier or eager stack around an
entire ForEach makes that group one layout item and can realize all of its rows.
Stable ForEach keys preserve logical row handles, component state, and callbacks
through reordering and viewport changes. Native focus/control caching across
offscreen transitions follows SwiftUI.

Laziness applies to native controls/layout. TypeScript still constructs and mounts
all logical descriptors and component scopes. Their State, effects, subscriptions,
and tasks remain alive while offscreen. Removing an item from the keyed group
disposes its scope; scrolling alone does not. This API does not provide Node-side
virtualization, pagination, or pinned headers.

Native view values and ForEach data hold weak references to the host's committed
view boxes. Deleting a row releases those logical boxes, cells, and callback
registrations even when SwiftUI caches its hidden AppKit controls. Cached adapters
cannot publish through retired bindings/actions. Removing the whole container
also removes its cached controls. WebView coordinators explicitly retire on
logical removal and replace their document to stop cached page scripts/timers.

Run the editable keyed-row example with notes, counters, reversal, and removal:

```sh
bin/jonui examples/lazy-list/app.ts
```

## Lazy grids

`LazyVGrid(children, { columns, alignment, spacing })` creates vertically
scrolling rows with horizontal column tracks. `LazyHGrid(children, { rows,
alignment, spacing })` creates horizontally scrolling columns with vertical row
tracks. Each requires a nonempty, readonly-compatible array of `GridItem` tracks:

```ts
import { ForEach, LazyVGrid, ScrollView, Text } from "jonui";
import type { GridItem } from "jonui";

const columns: GridItem[] = [
  { size: "fixed", value: 80, spacing: 8 },
  { size: "flexible", min: 60, max: "infinity", alignment: "leading" },
];
const content = ScrollView(LazyVGrid([
  ForEach(Array.from({ length: 100 }, (_, id) => id), { id: id => id }, id =>
    Text(`Cell ${id}`).frame({ height: 50 })),
], { columns, alignment: "leading", spacing: 12 }));
```

| Track size | Required fields | Defaults and behavior |
| --- | --- | --- |
| `"fixed"` | `value` | Exact nonnegative cross-axis points |
| `"flexible"` | None | `min: 10`, `max: "infinity"`; shares available cross-axis space within bounds |
| `"adaptive"` | Positive `min` | `max: "infinity"`; packs multiple tracks according to the available cross-axis space |

Flexible/adaptive bounds must be finite nonnegative numbers or the literal
`"infinity"` for `max`, with `min <= max`. Fixed tracks use `value` and reject
`min`/`max`; flexible/adaptive tracks reject `value`. Numeric Infinity is not a
JSON-safe option. Adaptive `min` must be greater than zero. Tracks and the input
array are copied/frozen when the descriptor is built; replace the options in a
tracked body to change sizing.

Grid `spacing` controls gaps along the scrolling axis: between rows in LazyVGrid
and between columns in LazyHGrid. Each track's `spacing` controls the cross-axis
gap after that column/row. Both accept finite nonnegative numbers; omit either
to use SwiftUI's platform defaults. Grids require a bounded cross-axis proposal,
usually from a matching-axis ScrollView and its window/frame.

Container alignment uses horizontal alignment for LazyVGrid and vertical alignment
for LazyHGrid, defaulting to center. A track's optional `alignment` accepts the
nine FrameAlignment values and positions smaller content within its native slot.
Cell frame modifiers still determine whether the cell fills its assigned space.
For example, `.frame({ minWidth: 0, maxWidth: "infinity" })` fills a vertical
grid's column width.

For responsive equal-width cards, use a single adaptive definition such as
`{ size: "adaptive", min: 180, max: 280, spacing: 12 }`. SwiftUI repacks it when
the available cross-axis space changes. Model values and keyed component scopes
survive both track replacement and repacking; transient native focus/scroll
behavior remains under SwiftUI's control. The lazy-stack grouping, weak ownership,
offscreen lifetime, and explicit removal rules apply to grids too. No per-track
State cells or callback registrations are allocated. Cell spans and pinned grid
headers are not part of this API.

Run an editable 120-card example with adaptive/mixed sizing, reversal, and removal:

```sh
bin/jonui examples/lazy-grid/app.ts
```

## Fixed and flexible frames

Fixed frames accept `width`, `height`, and `alignment`:

```ts
Text("Fixed").frame({ width: 200, height: 80, alignment: "bottomTrailing" });
```

Flexible frames accept minimum, ideal, and maximum sizes on either axis:

```ts
Text("Flexible").frame({
  minWidth: 100, idealWidth: 240, maxWidth: "infinity",
  minHeight: 20, idealHeight: 40, maxHeight: 100,
  alignment: "topLeading",
});
```

All sizes must be finite nonnegative numbers. Only `maxWidth` and `maxHeight`
accept `"infinity"`; JavaScript numeric Infinity is rejected because it cannot
cross the JSON bridge. Provided bounds must satisfy `min <= ideal <= max`.
Omitted bounds remain SwiftUI defaults. Ideal sizes are preferences within the
parent's proposal, rather than guaranteed dimensions.

Fixed and flexible options cannot be mixed in one call. Chain frame modifiers
to express separate layout stages. Modifier order matters: an outer frame aligns
the result of the inner view/modifier.

Frame alignment defaults to `"center"`. The nine supported positions are:

| Top | Middle | Bottom |
| --- | --- | --- |
| `topLeading` | `leading` | `bottomLeading` |
| `top` | `center` | `bottom` |
| `topTrailing` | `trailing` | `bottomTrailing` |

Leading/trailing follow SwiftUI's layout direction. Frames do not implicitly clip
overflowing content. A scroll view clips content to its viewport. `FrameAlignment`
names the full frame union; the existing `Alignment` type remains an alias for
horizontal stack alignment.

## Stack alignment and sizing

`VStack(children, { alignment, spacing })` accepts horizontal alignment:
`"leading"`, `"center"` (default), or `"trailing"`.

`HStack(children, { alignment, spacing })` accepts vertical alignment:
`"top"`, `"center"` (default), `"bottom"`, `"firstTextBaseline"`, or
`"lastTextBaseline"`. Omitted spacing uses SwiftUI's default; finite negative
spacing is permitted for intentional overlap.

`Spacer({ minLength: 20 })` specifies a nonnegative minimum. Omitting it keeps
SwiftUI's default minimum.

`view.fixedSize()` requests the view's ideal size on both axes.
`view.fixedSize({ vertical: true })` fixes only its vertical size; omitted axes
in an options object default to false. Fixed size can make content exceed its
parent's proposal. `view.layoutPriority(1)` gives that view priority when its
container distributes space. Priorities accept any finite number and default to
SwiftUI's zero when no modifier is applied.

## Padding and validation

`view.padding()` keeps the existing 16-point default, and `view.padding(8)` pads
all edges uniformly. Edge insets use semantic edges; omitted edges are zero:

```ts
Text("Padded").padding({ top: 4, leading: 12, bottom: 8, trailing: 12 });
```

Insets accept finite numbers, including intentional negative padding. Unknown
options, invalid enums/flags, nonfinite metrics, negative dimensions, mixed frame
forms, and inverted bounds fail before serialization. Native transaction
validation also rejects malformed raw descriptors before changing the committed
tree. A dynamic layout error can use the usual `View(body, { fallback })` policy.

## Validation

The layout integration scenario runs in a transparent offscreen window. Opt-in
test geometry preferences measure actual SwiftUI frame alignment, padding,
flexible constraints, fixed sizing, and competing layout priorities. AppKit
scroll view diagnostics verify viewport movement on both axes and indicator
visibility. Native inputs/actions inside keyed scroll rows retain identity and
Unicode state; 20 mount/unmount cycles return native views, cells, and callback
counts to baseline. Geometry and scroll diagnostics require both `JONUI_TEST=1`
and `JONUI_TEST_LAYOUT=1` and are unavailable in normal application launches.

Lazy-stack scenarios in both directions verify a small subset of 80 actual text
controls is created initially, the final row appears after native scrolling,
spacing/alignment changes affect real geometry, and nested component/dynamic/keyed
groups preserve Unicode state and action identity across reorder. They test
offscreen row deletion, empty collections and inert cached adapters, malformed
transaction rejection, and 20 container mount/unmount cycles per axis with
native logical views/cells/callbacks at baseline. A separate WKWebView scenario
checks document timers and scoped state stop publishing after offscreen removal.

Grid scenarios in both directions measure fixed/flexible sizes, adaptive packing
and viewport repacking, grid/track gaps, and per-track alignment. They verify
partial realization of 80 text controls, native Unicode editing/actions, stable
keyed scopes/handles through track changes and reorder, atomic malformed-track
rejection, offscreen deletion/empty groups and inert cached adapters, and 20
mount/unmount cycles per axis with logical views, cells, callbacks, and cached
controls returning to baseline.

Validation on 2026-11-06: the native build, 110 unit tests, 67 offscreen native
scenarios, and Deno/TypeScript checks pass.
