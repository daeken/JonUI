# SwiftUI widget, state, and API coverage TODO

This is JonUI's broad coverage ledger. [TODO.md](TODO.md) remains the ordered
implementation backlog. **Review and update this file in every commit**, including
commits that leave widget coverage unchanged. See [AGENTS.md](AGENTS.md).

Inventory baseline: public SwiftUI/SwiftUICore declarations in the installed
**macOS 27.0 SDK**, plus related Apple-framework widgets and platform-specific
families. JonUI's deployment target remains **macOS 14+**. SDK presence does not
prove deployment availability; every SDK/platform-gated row needs an explicit
availability audit before implementation. Deprecated APIs stay visible for a
compatibility decision. This inventories widget families, state/ownership, major
modifiers and scenes; it does not claim every overload/style/modifier is listed.
Apple's [SwiftUI documentation](https://developer.apple.com/documentation/swiftui)
is the reference for future SDK audits. Do not copy private underscored SDK types
into the public bridge.

Status meanings:

- **Available**: the specifically described JonUI contract is implemented and
  verified. It is not a claim of exhaustive SwiftUI overload/style parity.
- **Partial**: a useful subset exists; the remaining column is actionable work.
- **Missing**: no public JonUI API yet.
- **Internal only**: used by implementation, without a public extension surface.
- **SDK gate / Platform gate / Legacy**: first decide availability/compatibility;
  these rows are not silently counted as implemented.
- State descriptions distinguish native scalar bindings, immutable Node models,
  request state and logical ownership from native visibility/realization.

## Current review

- Stepper/Picker focus review (2026-11-07): both accept focusName and projected
  `.focused` bindings using a bounded native host for named/unnamed controls.
  Public NSStepper/NSPopUpButton/NSSegmentedControl lookup preserves native
  eligibility, bindings, inherited environment and logical teardown. Two runtime
  cases bring the total to 142; the native build, Deno/TypeScript and focused
  offscreen gate pass real Stepper/segmented actions, same-label ownership, exact
  Unicode rename, atomic names, styles/disabled/sheet gates, passive resume and
  20 pending owner lifetimes. Concrete blocker: full keyboard access is false;
  five new-control checks are ineligible and three menu/automatic checks lack a
  supported public native surface. Successful new-control focus/capture/Tab remains
  unverified; preferences/eligibility are not overridden. All 78 offscreen native
  scenarios pass, including Stepper/Picker duplicate-name startup cleanup; all
  142 unit tests, native build, Deno/TypeScript and API classification pass.
  The recorded AppKit sheet-close crash did not recur; no fix is claimed.
  Button/Toggle/Slider targeting and prior platform gaps remain.
- Typed focus selection review (2026-11-07): setup-only `scope.focusSelection`
  copies a fixed domain of unique string/finite-number IDs. Typed nullable
  desired/actual selection maps to opaque native names through one named
  controller; projection false remains conditional, while null intent clears
  the active context. Independent domains reuse IDs safely. Private guards
  suppress stale/disposed validation/writes and preserve passive resume. Three
  unit cases bring the total to 140; Deno/TypeScript checks and focused offscreen
  native selection pass five control types, typed/independent identity, Return,
  keyed reorder, modal/task leases and 20 pending owner lifetimes. All 75 offscreen
  native scenarios pass, including duplicate-projection startup cleanup with no
  retained resources. All 140 unit tests, Deno/TypeScript and API classification
  pass. Native source/protocol are unchanged; the recorded AppKit sheet-close
  crash did not recur and is not claimed fixed.
  Dynamic domains, object/symbol IDs, general overloads and platform/manual focus
  gaps remain open; no full FocusState parity is claimed.
- Boolean focus review (2026-11-07): `scope.focusBoolean` owns one opaque target,
  writable boolean desired intent, readonly actual/retired values and a stable
  `.focused` binding. Independent controllers use distinct names; changed false
  intent conditionally blurs only its target. Equal desired writes stay inert;
  explicit requests retry. Named lifecycle/task guards and resources are reused.
  Three runtime cases bring the total to 137; Deno/TypeScript checks and a focused
  offscreen native gate pass five control types, Return ordering, keyed identity,
  stale per-controller task leases, modal retirement/resume and 20 pending owner
  lifetimes. All 73 offscreen native integration scenarios, 137 unit tests,
  Deno/TypeScript checks and API classification pass. Native source/protocol are
  unchanged. The recorded AppKit sheet-close crash did not recur; no fix is
  claimed. Typed selections, general overloads and existing platform/manual focus
  gaps remain open.
- Focus projection review (2026-11-07): branded named boolean projections and
  `.focused` wire supported inputs through modifiers/child components. Reads track
  actual focus; writes queue intent. Conditional native blur and pending-caller
  guards preserve newer targets. Scope ancestry/disposal checks prevent orphaned
  registrations; projection objects stay off the native wire. FocusState moves
  to Partial for this named subset, with standalone boolean/typed selection and
  broader-control coverage still open. Five runtime cases bring the total to 134;
  focused native text/date/WebKit, Unicode, sheets and 20 owner lifetimes pass.
  Native build, all 72 offscreen native scenarios, 134 unit tests,
  Deno/TypeScript checks and API classification pass.
- Explicit focus resume review (2026-11-07): controller resume preserves state
  and identity, rebinds after commit and suppresses retained/older intent. Task/RPC
  lifetime leases and pre-effect cancellation checks prevent obsolete callers
  from issuing requests or activating observers. Passive same-window/sheet/parent
  resumption, 20 observer cycles and 20 owner lifetimes pass focused native gates;
  six runtime cases bring the total to 129. All 71 native scenarios pass on full
  rerun; final caller-reference cleanup passes the focused native gate. Unit/type
  checks and API classification pass. The first full run reproduced the recorded UpdateCycle/AppKit
  sheet-close null call despite window animation suppression; focused mixed-sheet
  rerun passes. This platform limitation is not claimed fixed. FocusState
  projections are now covered by the review above.
- Owned focus review (2026-11-07): setup-only `scope.focus` separates tracked
  desired intent from read-only actual/retired values and applies after-commit,
  generation/context-bound requests. Context change retires the controller and
  its observer; explicit resume or remount starts a new session. Passive/initial named
  requests, native text/date/WebKit, unavailable/repeated requests, no feedback,
  keyed identity, modal isolation and 20 canceled/pending owner lifetimes pass
  focused native validation. Five new runtime cases bring the total to 123;
  type checks pass. General FocusState parity/automatic resumption remain open.
  Native build, all 71 offscreen native scenarios, 123 unit tests,
  Deno/TypeScript checks and API classification pass.
- Focus acknowledgement review (2026-11-07): observed imperative movements now
  use generation-stamped requests and synchronous actual-focus acknowledgements.
  Sequence/generation floors discard queued older observations; native guards
  reject replay, stale sessions and optional retired-window contexts. Per-listener
  baselines preserve no replay and suppress outdated reentrant deliveries.
  Public signatures/statuses were unchanged in that increment; owned controllers
  and projected bindings followed in the reviews above. Native build, all
  70 offscreen native scenarios, 118 unit tests, Deno/TypeScript and API
  classification pass. Additional focused coverage independently verifies native
  shared-field-editor observation without request acknowledgement or query polling.
- Focus observation review (2026-11-07): `Focus.subscribe` adds asynchronous,
  coalesced actual-name changes with shared native KVO/window notifications,
  session/sequence/context guards, task cancellation and explicit/effect cleanup.
  That increment added observations without writing desired focus; owned
  projections followed in later reviews. Request-generation acknowledgements
  are now covered by the review above.
  Native build, all 70 offscreen native success/failure scenarios, 116 unit tests,
  Deno/TypeScript and API classification pass. RPC cancellation releases task-
  owned focus listeners as well as pending work.
- Focus snapshot review (2026-11-07): `Focus.currentName()` reads the actual
  eligible named responder in the active window/sheet without writing focus or
  creating registrations. Text/date/WebKit/DOM, exact Unicode, unavailable and
  unnamed controls, keyed name changes, caret/session preservation and 20 focused
  owner retirements pass the focused offscreen gate. Two new runtime tests cover
  transport, resources, purity, cancellation and shutdown. This increment added
  only a snapshot; controllers/projections followed above. The snapshot itself
  has no tracked dependency or observation stream.
  Native build, all 68 offscreen native scenarios, 112 unit tests and
  Deno/TypeScript checks pass; retired RPC reads also skip native focus queries.
- Focus review (2026-11-07): opt-in captured Tab/Shift-Tab cycles now work in
  the active single sheet, including mixed text/date/WebKit controls. An owned
  NSApplication dispatcher filters to the active window without replacing
  framework sheet delegates. Focus/sheet rows remain Partial; declarative focus,
  nested sheets, keyboard-access, WebKit IME and assistive focus still need work.
  Focused offscreen sheet tests verify actual application-dispatched cycles,
  wrap/reset, stale-target rejection, native composition/modifier bypass and
  20 focused owner retirements per scenario. Native build, all 67 offscreen native
  scenarios, 110 unit tests, Deno/TypeScript and API classification pass for the
  application-dispatch change.
- Maintenance review (2026-11-07): widget/state status rows are unchanged.
  Commit-review enforcement now covers ordinary/amended commits, merges,
  cherry-picks, patch imports, rebases, and `commit --no-verify`. Eleven real-Git
  tests verify rejection/recovery, cached-tree safety, baseline metadata,
  classification, idempotence and preservation of unstaged edits. That maintenance
  increment left native/runtime/type behavior unchanged.
- Initial comprehensive inventory of the current TypeScript API, native bridge,
  examples and tests, including known limitations. All public exported symbols
  and View/Focus/ComponentScope members have explicit classification markers.
- Current validation: native build; 134 runtime/compiler unit tests; 72 offscreen
  native scenarios; Deno/TypeScript checks. Mixed-sheet automatic window animation
  suppression also passed three additional 20-owner stress runs. The original
  offscreen sheet path has reproduced an AppKit/UpdateCycle crash, including a
  recurrence with NSWindow animation suppression in this review, and
  remains a limitation; ordinary app animations are not claimed fixed.
- Full keyboard access is currently false. Native NSStepper/NSSegmentedControl
  eligible-focus paths remain unverified; do not alter user preferences or force
  native eligibility. WebKit IME/candidate and assistive focus need manual work.
- Priorities remain in TODO.md; this ledger preserves breadth without marking
  partial/blocked work complete. Native ownership, stale updates, cancellation,
  cleanup and actual control behavior must be verified before promoting status.

## Next implementation checks

- [ ] Finish generation-safe declarative focus requests and remaining named controls.
- [ ] Complete nested-sheet and keyboard-access/IME/AX coverage.
- [ ] Add ZStack, Group, Label and common missing containers/indicators.
- [ ] Add general image/resource loading and typed colors/shapes.
- [ ] Add menus/toolbars/commands, tabs/navigation paths and table/outline models.
- [ ] Add gestures, transactions/animation and actual appearance lifecycle APIs.
- [ ] Add a public environment/accessibility layer and native extension surface.
- [ ] Add multi-window/scenes, native document/dialog and persistence APIs.
- [ ] Add TSX authoring and compiler-assisted state/binding lowering (see below).

## Text, images, controls, and indicators

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| Text | Partial | Read-only string; tracked body updates. | Plain text verified; attributed/localized/markdown/interpolated text and text selection remain. <!-- api: Text --> |
| Image | Partial | System-symbol name; no image-loading state. | SF Symbols verified; asset/file/data images, rendering modes and resizable images remain. <!-- api: Image --> |
| Label | Missing | Title/icon content; usually stateless. | Add title/icon composition and label styles. |
| AsyncImage | Missing | URL plus loading/success/failure phase. | Cancellation, cache policy, errors, placeholder and owner cleanup. |
| Button | Partial | Node action; current handler keyed by native view ID. | Basic actions/lifecycle verified; roles, styles, keyboard shortcuts and named focus remain. <!-- api: Button --> |
| Toggle | Partial | Scalar boolean Binding. | Native binding verified; styles, labels and named/keyboard-access focus remain. <!-- api: Toggle --> |
| Slider | Partial | Scalar number Binding, bounds, optional step. | Rendered/native binding verified; custom-drawn native action/accessibility and named focus gaps. <!-- api: Slider, NumericInputOptions --> |
| Stepper | Partial | Scalar number Binding, bounds/step; named/projected focus registration. | Real NSStepper actions, name/disabled gates and cleanup verified; successful full-keyboard-access focus, formatter and styles remain. <!-- api: Stepper --> |
| Picker | Partial | String/number/null selection Binding; detached keyed options and named/projected focus registration. | Segmented actions, menu binding/rendering, names/style/disabled gates and cleanup verified; successful eligible focus and menu opening/absent public surfaces remain. <!-- api: Picker, PickerOption --> |
| DatePicker | Partial | Unix-millisecond number Binding, bounds, components and zone. | Native actions/styles/DST/rebinding/named focus and sheet isolation verified; richer formatting/popover interaction remain. <!-- api: DatePicker --> |
| MultiDatePicker | Platform gate | Set of date components; selection/range. | Availability audit and immutable set representation before implementation. |
| ColorPicker | Missing | Color/opacity Binding. | Define JSON color schema; native picker, editing lifecycle and color spaces. |
| TextField | Partial | String Binding; submit/editing callbacks; optional focus name. | Native Unicode/Return/rebinding/lifetimes verified; formatters, prompts/styles and selection remain. <!-- api: TextField, TextInputOptions --> |
| SecureField | Partial | String Binding with masked native rendering. | Native edits/focus verified; formatting/styles and secure-entry policy remain. <!-- api: SecureField --> |
| TextEditor | Partial | String Binding, monospaced flag, editing callback, focus name. | Native multiline/Unicode/newline/lifetime verified; rich text, selection, writing tools and find remain. <!-- api: TextEditor --> |
| TextFieldLink | Platform gate | Entry/presentation state and text result. | Audit supported Apple platforms and define lifecycle. |
| ProgressView | Missing | Indeterminate or completed/total value; optional label. | Styles, accessibility and progress model integration. |
| Gauge | Missing | Value/range and minimum/current/maximum labels. | Define finite numeric contract and native styles. |
| Link | Missing | Destination URL and label; open result. | URL policy, openURL integration and accessibility. |
| ShareLink | Missing | Share item/preview and presentation lifecycle. | Transferable/data schema and platform share service. |
| PasteButton | Missing | Supported payload types and async loaded values. | Clipboard permissions, type validation, cancellation and cleanup. |
| EditButton | Missing | EditMode Binding/environment. | Requires list/table edit modes and deletion/move contracts. |
| RenameButton | Missing | Rename action/environment and editing phase. | Requires rename action dispatch and text focus coordination. |
| HelpLink | SDK gate | Help destination/action. | Availability and help-book/URL integration audit. |
| SettingsLink | Missing | Settings-scene activation. | Requires Settings scene ownership and activation policy. |
| NewDocumentButton | SDK gate | Document creation and progress/error state. | Requires document scenes, document identity and native dialogs. |
| WindowVisibilityToggle | SDK gate | Window visibility by scene/window identity. | Requires multiple-window registry and ownership. |
| ContentUnavailableView | Missing | Empty/error reason plus label/description/actions. | Add composition, standard search-empty form and availability checks. |
| LabeledContent | Missing | Label/value content or formatted value. | Native form alignment, formatting and accessibility. |
| ControlGroup | Missing | Child controls; optional selection/environment. | Styles, toolbar placement and grouped accessibility. |
| GroupBox | Missing | Label and content; no intrinsic selection state. | Styles, layout, nested content and accessibility. |
| DisclosureGroup | Missing | Expanded boolean Binding and label/content. | Preserve child scopes; disclosure state, lazy content and cleanup. |
| Menu | Missing | Dynamic actions, selection/roles and open lifecycle. | Native menu model, callbacks, keyboard shortcuts and dismissal. |
| MenuButton (legacy) | Legacy | Menu presentation/action state. | Prefer Menu; audit deprecated API parity if needed. |
| ContextMenu (legacy type) | Legacy | Dynamic contextual actions and selection. | Prefer contextMenu modifier; native menu cleanup/preview semantics. |
| SubscriptionView | Platform gate | Subscription/presentation phase. | Audit availability and framework requirements before committing to a bridge. |

## Containers, collections, layout, and navigation

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| VStack | Available | Tracked child array, alignment and optional spacing. | Native layout/keyed identity verified; baseline documentation in docs/layout.md. <!-- api: VStack --> |
| HStack | Available | Tracked child array, vertical/baseline alignment and spacing. | Native geometry and dynamic alignment verified. <!-- api: HStack --> |
| ZStack | Missing | Child array and two-axis alignment. | Layer order, hit testing, identity and accessibility. |
| LazyVStack | Available | Eager logical keyed scopes; lazy native rows. | Actual partial realization/scrolling/removal and owner cleanup verified. <!-- api: LazyVStack --> |
| LazyHStack | Available | Eager logical keyed scopes; lazy native columns. | Partial realization, horizontal scroll, keyed state and cleanup verified. <!-- api: LazyHStack --> |
| LazyVGrid | Available | Detached fixed/flexible/adaptive tracks; keyed state. | Native geometry/repacking/scrolling and scoped cleanup verified. <!-- api: LazyVGrid, GridItem --> |
| LazyHGrid | Available | Detached row tracks; keyed state. | Native horizontal grid measurement/repacking and cleanup verified. <!-- api: LazyHGrid --> |
| Grid | Missing | Eager rows/columns, alignment, spacing. | Cell spans, unsized axes, anchors and row identity. |
| GridRow | Missing | Child cells and row alignment. | Requires Grid with span/alignment contracts. |
| Spacer | Available | Optional finite nonnegative minimum length. | Native layout verified; no owned mutable state. <!-- api: Spacer --> |
| Divider | Available | Stateless native separator. | Rendered in native hierarchy; style/orientation follow native layout. <!-- api: Divider --> |
| ScrollView | Partial | Axes and indicator visibility; content owns state. | Native scroll/geometry verified; position Binding, reader, bounce and target APIs remain. <!-- api: ScrollView --> |
| ScrollViewReader | Missing | Stable scroll target IDs and scroll actions. | Cancellation, unrealized lazy targets and window ownership. |
| ScrollPosition / ScrollGeometry | Missing | Position/anchor and read-only scroll snapshots. | Define typed coalesced scroll events, Binding and revision rules. |
| List | Partial | String/number/null single-selection Binding; keyed rows. | Basic Landmarks selection/state verified; editing, multi-select, sections/styles and drag/drop remain. <!-- api: List --> |
| ForEach | Available | Stable string/number IDs preserve component/cell identity. | Reordering/filtering/duplicate IDs and lifetime cleanup verified. <!-- api: ForEach, ItemID --> |
| OutlineGroup | Missing | Recursive data/identity and disclosure state. | Expansion bindings, recursion limits, row identity and cleanup. |
| Table | Missing | Keyed rows, selection and sort descriptors. | Native columns, sorting, multi-selection, editing and virtualization. |
| TableColumn | Missing | Column ID, label/value, width and sorting state. | Requires Table and typed row/cell extraction. |
| TableRow / TableHeaderRowContent | Missing | Stable row/header identity and cell content. | Table integration and header/sort accessibility. |
| Section | Partial | String header/footer and child views. | Native form sections verified; richer header/footer content and collection-specific behaviors remain. <!-- api: Section --> |
| Form | Partial | Style: automatic/grouped/columns; child input state. | Native forms/bindings verified; complete form/control-style parity remains. <!-- api: Form --> |
| Group | Missing | Structural children without an imposed layout. | Explicit constructor, transparent identity and environment propagation. |
| Group(subviews:) / Group(sections:) | SDK gate | Dynamic subview/section collections and IDs. | Audit newer variadic/subview APIs; bridge ownership safely. |
| AnyView / TupleView / EmptyView | Internal only | Runtime View values/arrays/empty branches. | No public constructors; document abstraction boundaries and explicit empty/group views. |
| EquatableView | Missing | Explicit comparison/identity boundary. | Reconciliation semantics and state-read invalidation guarantees. |
| ViewThatFits | Missing | Ordered alternatives and measured proposal. | Preserve scopes when native chosen alternative changes. |
| GeometryReader | Missing | Read-only geometry/coordinate-space snapshots. | Event coalescing, layout feedback prevention and native ownership. |
| GeometryProxy / visualEffect | Missing | Local/global/named coordinate values. | JSON geometry contracts and lifecycle-safe observations. |
| HSplitView | Missing | Pane sizes, constraints and divider interaction. | Native split ownership, persistence and drag behavior. |
| VSplitView | Missing | Vertical pane sizes and constraints. | Same ownership/persistence requirements as HSplitView. |
| NavigationSplitView | Partial | Sidebar/detail content; app-owned selection. | Landmarks split verified; three-column form, visibility Binding and styles remain. <!-- api: NavigationSplitView --> |
| NavigationStack | Missing | Typed route/path Binding and destinations. | Serialization, restoration, push/pop identity and teardown. |
| NavigationLink | Missing | Destination or typed route/selection. | Requires navigation ownership and destination registration. |
| NavigationView (legacy) | Legacy | Selection/path and columns. | Prefer modern stack/split APIs; explicit compatibility decision needed. |
| NavigationPath | Missing | Heterogeneous serialized route stack. | Define stable JS route records and restoration/versioning. |
| TabView | Missing | Selection Binding and tab identities. | Native tabs, styles, badges, lifecycle and state preservation. |
| Tab / TabSection | SDK gate | Typed tab values, roles, sections and customization. | Availability, selection and tab customization persistence. |
| Search field / searchable | Missing | Query, tokens, suggestions and focus state. | Search scopes, completions, submit/cancel and native field lifecycle. |

## Shapes, drawing, effects, and animation

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| Color | Missing | Serializable color/color-space value or semantic role. | Current foregroundStyle subset is separate; add view/value API and opacity. |
| Rectangle | Missing | Stateless shape plus dimensions/style. | Shape/path bridge and fill/stroke semantics. |
| RoundedRectangle | Missing | Corner radius/style. | Shapes, native sizing and animation. |
| UnevenRoundedRectangle | SDK gate | Per-corner radii. | Availability, shape schema and interpolation. |
| ConcentricRectangle | SDK gate | Container-relative corner geometry. | Availability and container geometry contracts. |
| Circle | Missing | Shape/style; animatable geometry. | General shape bridge. |
| Ellipse | Missing | Shape/style; dimensions. | General shape bridge. |
| Capsule | Missing | Style and axis-relative geometry. | General shape bridge. |
| ContainerRelativeShape | Missing | Container-dependent shape parameters. | Container-shape propagation and identity. |
| Path | Missing | JSON path commands/fill rule. | Finite geometry validation, hit testing and serialization cost. |
| AnyShape / transformed shapes | Missing | Shape erasure, offset/rotation/scale/transform. | Inset/fill/stroke support and animatable data. |
| LinearGradient | Missing | Stops, start/end points and color spaces. | Gradient schema, validation and interpolation. |
| RadialGradient | Missing | Stops, center and radii. | Gradient schema and finite bounds. |
| AngularGradient | Missing | Stops, center and angular range. | Gradient schema and interpolation. |
| EllipticalGradient | SDK gate | Stops, center and fractional radii. | Availability and shape-style bridge. |
| MeshGradient | SDK gate | Grid points, colors and interpolation. | Availability, matrix validation and update performance. |
| Canvas | Missing | Drawing snapshot, symbols and graphics commands. | Native command schema, image/text resolution and render performance. |
| GraphicsContext / ShapeStyle | Missing | Drawing state, transforms, blending and resolved resources. | Value codec and explicit lifetime/ownership. |
| TimelineView | Missing | Schedule and timeline/date context. | Native tick scheduling, pause policy and owner disposal. |
| PhaseAnimator | SDK gate | Phase sequence and phase-dependent content. | Availability, cancellation and phase ownership. |
| KeyframeAnimator | SDK gate | Trigger, keyframe timeline and animatable values. | Finite values, completion/cancellation and availability. |
| ImageRenderer | SDK gate | Rendered view snapshot, scale and output ownership. | Availability and export/resource cleanup. |
| GlassEffectContainer | SDK gate | Grouped glass effect identity and transitions. | Availability/style audit; native effect integration. |
| Material / glass effects | Missing | Environment/style and optional interaction state. | Background/material schema, platform guards and accessibility. |
| Transitions / matched geometry | Missing | Transition identity, namespace and insertion/removal phase. | Preserve logical scopes through native animation/retirement. |
| Animation / withAnimation | Missing | Transaction, duration/curve and completion policy. | Explicit JS/native transaction semantics; animated-sheet OS limitation remains. |
| Animatable / custom Layout | Missing | Interpolatable values and layout proposal/cache. | Define safe native data/extension contracts; no synchronous JS render callbacks. |

## Presentation, menus, toolbars, windows, and scenes

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| sheet | Partial | Boolean presentation Binding and content. | Single-sheet mixed-widget focus/RPC, opt-in Tab routing and owner teardown verified; item-based and nested cases remain. <!-- api: View.sheet --> |
| popover | Missing | Boolean/item Binding, anchor and dismissal. | Native positioning, window ownership, focus and cleanup. |
| fullScreenCover | Platform gate | Boolean/item Binding and presentation content. | Availability/platform semantics; ownership and dismissal. |
| alert | Missing | Boolean/item Binding, message and actions. | Roles, text input, default/cancel and queued presentation policy. |
| confirmationDialog | Missing | Boolean/item Binding and dynamic actions. | Native presentation, role ordering and cancellation. |
| inspector | SDK gate | Presentation Binding and inspector content. | Availability, column size and focus ownership. |
| contextMenu modifier | Missing | Context actions, optional preview and selection. | Mouse/keyboard invocation, cancellation and cleanup. |
| toolbar | Missing | Stable item IDs, placements and visibility. | Window-scoped toolbar ownership, updates and customization. |
| ToolbarItem | Missing | Item ID, placement and content. | Requires toolbar bridge and native action cleanup. |
| ToolbarItemGroup | Missing | Placement and grouped content. | Group identity, overflow and accessibility. |
| ToolbarTitleMenu / ToolbarOverflowMenu | SDK gate | Title/overflow actions and presentation. | Platform/availability audit and toolbar state integration. |
| TouchBar | Legacy | Touch-bar item IDs and customization. | Hardware-specific; keep outside core macOS parity until hardware validation. |
| commands | Missing | Scene-level command groups and enabled state. | Keyboard shortcut/role/validation and window ownership. |
| CommandGroup | Missing | Group placement/replacement and dynamic commands. | Scene command tree and conflict handling. |
| CommandMenu | Missing | Menu title and child commands. | Native menu lifecycle and enablement. |
| Main window / App | Partial | Title, initial size, content and stop callback. | Native launcher verified; scenes, activation/reopen policies and multi-window roots remain. <!-- api: runApp, AppOptions --> |
| WindowGroup | Missing | Scene identity, independent root state and windows. | Multi-window ownership, open/dismiss and state restoration. |
| Window | Missing | Stable unique window ID, content and visibility. | Existing launcher window is not a general scene/window API. |
| UtilityWindow | SDK gate | Utility window ID and visibility. | Availability, focus/activation and window lifecycle. |
| MenuBarExtra | Missing | Status-item insertion Binding, label and content. | Native menu/window styles and background app lifecycle. |
| Settings | Missing | App-owned settings root and persistence. | Scene registration, SettingsLink and reopen/activation. |
| DocumentGroup | Missing | File document Binding, dirty/saving/error state. | Native open/save, file coordination, restoration and undo. |
| DocumentGroupLaunchScene / DocumentLaunchView | SDK gate | Document launch state/actions. | Requires document lifecycle and availability checks. |
| AlertScene | SDK gate | Scene presentation ID and alert actions. | Availability and scene ownership audit. |
| AssistiveAccess | Platform gate | Specialized app scene/navigation state. | Platform and accessibility-mode audit. |
| ImmersiveSpace / RemoteImmersiveSpace | Platform gate | Immersive space ID and open/dismiss phase. | visionOS-specific bridge/hardware is outside current macOS runtime. |
| ImmersiveSpaceViewContent / ExternalNonInteractiveAccessory | Platform gate | Spatial/remote content and attachment state. | SDK/platform-specific; inventory retained for future ports. |
| NSHostingView / NSHostingController / hosting sheets | Internal only | Native host/coordinator lifetime. | Used internally; no arbitrary public hosting API. Cleanup verified for supported controls. |
| NSHostingMenu | SDK gate | Hosted menu content and native menu lifetime. | Availability and general menu bridge. |

## State, identity, observation, focus, and runtime ownership

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| State / scope.state | Partial | Primitive scalar cells plus immutable JSON records/arrays; scalar native Binding. | Revisions, scoped disposal, stale writes and structured snapshots verified; full SwiftUI property-wrapper parity is not claimed. <!-- api: State, ScalarStateValue, StateValue, StateSnapshot, ComponentScope.state --> |
| Binding | Partial | Branded scalar native-cell reference. | Shared/rebound bindings verified; projections, collection/optional bindings and transactions remain. <!-- api: Binding --> |
| Computed / scope.computed | Available (JonUI) | Cached pure JSON derivation; tracked dependencies. | Owner cleanup and purity verified; this is JonUI's computation API. <!-- api: Computed, ComponentScope.computed --> |
| View body / Component | Available (JonUI) | Tracked body, current shallow props, keyed setup/disposal. | Render recovery and component ownership verified; not arbitrary native View conformance. <!-- api: View, Component, ComponentScope, ComponentScope.props --> |
| Effects / disposal | Available (JonUI) | Tracked synchronous effects; dependency/unmount cleanup. | Explicit stop, errors, 150 effects and teardown verified. <!-- api: ComponentScope.effect, ComponentScope.onDispose --> |
| Tasks | Available (JonUI) | Async task context, AbortSignal, cleanup and guarded commit. | Latest-run semantics, stale writes/publication/focus and cleanup verified. <!-- api: ComponentScope.task, TaskContext --> |
| ObservedObject / StateObject | Missing | JS observable model ownership/reference identity. | Current immutable JSON State is not a Swift ObservableObject bridge. |
| Observable / Bindable | Missing | Observable model properties and projected bindings. | Define JS model/proxy identity, mutation and disposal semantics. |
| Environment / EnvironmentObject | Missing | Inherited typed values, actions and services. | Native host propagates internal SwiftUI environment, but no general public TS API. |
| AppStorage | Missing | Preferences-backed typed state and external changes. | UserDefaults namespace, migrations and subscription teardown. |
| SceneStorage | Missing | Per-scene restorable state. | Requires scene ownership and persistence/version policy. |
| FocusState | Partial (JonUI) | Owned named, standalone boolean and fixed string/number selection controllers, with observed-boolean/request projections. | Text/date/WebKit subset verified; dynamic domains, object/symbol IDs and general SwiftUI overloads remain. Observations do not write desired state. |
| Scoped focus controller | Partial (JonUI) | Tracked desired intent; read-only actual/retired; context-bound requests and passive explicit resume. | Native text/date/WebKit, no feedback/replay, keyed identity, modal/resume/task lifetime and owner cleanup verified; automatic physical-window resumption and realization policies remain. <!-- api: FocusController, ComponentScope.focus --> |
| Boolean focus controller | Partial (JonUI) | Opaque single-target binding; separate boolean intent/observation; passive resume. | Text/secure/editor/date/WebKit, independent targets, conditional clear, task leases, modal retirement and cleanup verified. General SwiftUI overloads/additional controls remain. <!-- api: BooleanFocusController, ComponentScope.focusBoolean --> |
| Typed focus selection controller | Partial (JonUI) | Fixed unique string/number domain; separate nullable intent/observation; opaque target bindings and passive resume. | Literal inference, runtime validation, typed/independent identity, text/date/WebKit, conditional/global clear, task leases and owner cleanup verified; dynamic/object domains and general SwiftUI overloads remain. <!-- api: SelectionFocusController, ComponentScope.focusSelection --> |
| focused projection | Partial (JonUI) | Boolean actual getter and deferred true/conditional-false request, attached to one named input. | Text/secure/editor/date/WebKit focus verified; Stepper/Picker wiring and unavailable gates verified, successful focus still gated. Modifier/owner/Unicode blur/cleanup covered; containers and remaining native controls unsupported. <!-- api: FocusBinding, View.focused --> |
| Native focus observation | Partial (JonUI) | Nullable named responder snapshots and coalesced subscriptions; generation-stamped movement acknowledgements; observations do not write intent. | Text/date/WebKit/single-sheet observation, generation/sequence/context guards and cleanup verified; broader controls/IME/AX remain. <!-- api: Focus.subscribe --> |
| Focus commands | Partial | Native next/previous/clear plus four-axis geometric move. | Real text/date/WebKit/sheet/directional paths verified; full keyboard-access and optional non-editing arrow routing remain. <!-- api: Focus, Focus.next, Focus.previous, Focus.clear, Focus.move --> |
| Captured / named focus | Partial | Weak opaque physical target or exact UTF-8 name; currentName snapshot; optional active-window Tab cycle. | Text/date/WebKit focus/captures/Tab verified; Stepper/Picker names and unavailable gates verified, successful eligibility remains gated. Button/Toggle/Slider registration remains. <!-- api: FocusTarget, Focus.capture, Focus.request, Focus.requestNamed, Focus.currentName, Focus.setTraversal --> |
| focusSection | Partial | Native grouping without a new state cell. | Native grouping/geometry/captures verified; wider control/hardware coverage remains. <!-- api: View.focusSection --> |
| FocusedValue / FocusedBinding / FocusedObject | Missing | Active responder/scene scoped values and actions. | Requires responder-scoped propagation and ownership. |
| GestureState | Missing | Transient gesture phase state with reset on end/cancel. | Gesture recognition, event coalescing and owner cleanup. |
| Namespace | Missing | Stable transition/matched-geometry namespace. | Requires animation and native identity coordination. |
| EditMode | Missing | Inherited active/inactive/transient editing state. | Requires List/Table editing contracts. |
| UndoManager | Missing | Window/document-scoped undo/redo transactions. | State revisions, grouped operations and callback ownership. |
| ScenePhase / lifecycle | Missing | Active/inactive/background and visibility. | Define app/window/scene events and teardown ordering. |
| AccessibilityFocusState | Missing | Assistive focus Binding and technology context. | Native AX contract and hardware/manual validation. |
| WebView | Partial (JonUI) | App-authored HTML; JSON snapshots; native lifetime; named/Tab focus. | Real WebKit input, reload/epoch/disabled/focus and sheet coverage verified; assets/sizing/AX/remote navigation remain. <!-- api: WebView, WebBridge, WebRemote, JSONValue --> |
| WebRequest | Available (JonUI) | Request-owned task context, signal and guarded continuation work. | Typed RPC, cancellation/backpressure and late-write/focus guards verified; no binary codec/automatic browser bundle. <!-- api: WebRequest --> |

## Modifiers, interaction, accessibility, and platform services

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| font | Partial | Four font presets; no editable state. | Rich fonts, weights, scaling and dynamic type remain. <!-- api: View.font, Font --> |
| foregroundStyle | Partial | Primary/secondary/yellow presets. | General colors, gradients and arbitrary ShapeStyle remain. <!-- api: View.foregroundStyle, ForegroundStyle --> |
| padding / alignment / frame | Partial | Finite layout values, fixed/flexible frames and alignment. | Native measured layout verified; more sizing/alignment guides remain. <!-- api: View.padding, View.frame, EdgeInsets, HorizontalAlignment, Alignment, VerticalAlignment, FrameAlignment, FrameOptions --> |
| fixedSize / layoutPriority | Available | Native axes and finite priority. | Geometry/validation verified. <!-- api: View.fixedSize, View.layoutPriority --> |
| navigationTitle / tag | Partial | String title and scalar keyed tag. | Split/List use verified; large-title/toolbars and general tagged selection remain. <!-- api: View.navigationTitle, View.tag --> |
| accessibilityIdentifier | Partial | Stable identifier string on a view. | Identifier does not guarantee underlying NSView identity; richer AX remains. <!-- api: View.accessibilityIdentifier --> |
| disabled | Available | Boolean input; ancestor disabling wins. | Native controls, browser pointer/key eligibility, data continuity and cleanup verified. <!-- api: View.disabled --> |
| background / overlay / border | Missing | Style or child view, alignment and hit-test policy. | Composition and native ownership. |
| opacity / hidden / visibility | Missing | Visibility/opacity and layout-preservation semantics. | Define focus, accessibility and lifecycle behavior when hidden. |
| clipShape / mask / corner radius | Missing | Shape/path and clipping behavior. | Requires shape schema and hit-testing policy. |
| scale / rotation / offset / transform | Missing | Finite geometry and optional anchors. | Coordinate/focus/AX effects and animation. |
| alignmentGuide / coordinateSpace | Missing | Alignment/coordinate identity and geometry callbacks. | Avoid synchronous Node calls during native layout. |
| onAppear / onDisappear | Missing | Native realization/visibility events. | Component setup/disposal is logical ownership, not native appearance. |
| onChange / onReceive | Partial analog | State.subscribe and component effects on Node. | Native value/event adapters and delivery/cancellation policy remain. |
| task / refreshable | Partial analog | Scoped task cancellation exists. | Native view-appearance task, ID-triggered task and refresh UI integration remain. |
| onSubmit / onEditingChanged | Partial | Native text revision snapshot before Node callback. | Supported text controls verified; richer submit scopes/triggers remain. |
| onTapGesture / double tap | Missing | Tap count, location, handler token. | Native recognition and control/gesture priority. |
| LongPressGesture | Missing | Press phase, duration/distance and cancellation. | Native/Node event phases and transient state. |
| DragGesture | Missing | Translation, location, prediction and coordinate space. | High-rate event coalescing, GestureState and cleanup. |
| MagnifyGesture / RotationGesture | Missing | Scale/angle phase and anchor. | Trackpad/touch availability and cancellation. |
| SpatialTapGesture / SpatialEventGesture | Platform gate | Location/phase, spatial input identity. | Availability and hardware-specific input codecs. |
| Hover / continuous hover | Missing | Hover phase/location. | Native event ownership and pointer tracking cleanup. |
| Key input / keyboardShortcut | Missing | Key/modifier event and handling result. | Native shortcut/command scopes and text/IME safety; Tab cycle opt-in already supported. |
| Focus arrow-key routing | Missing | Optional non-editing event routing. | Explicit Focus.move exists; do not steal native caret/IME/browser keys. |
| Drag/drop / draggable / dropDestination | Missing | Typed transferable payload, hover and async load state. | Platform data policy, validation and cancellation. |
| Swipe actions / context actions | Missing | Row identity, action role and completion. | Native List/Table integration. |
| search scopes / suggestions / tokens | Missing | Query/token/selection Binding and submit. | Native searchable API, focus and completion ownership. |
| fileImporter / fileExporter | Missing | Presentation Binding, allowed types, selection/result. | Security-scoped file URLs, errors and owner lifetime. |
| fileMover / fileDialog customization | Missing | Source/destination and operation phase. | Native dialogs, file access and cancellation. |
| openURL / openWindow / dismiss | Missing | Environment actions and scene/window identity. | Define scoped action handles and result/error policy. |
| accessibilityLabel / Value / Hint | Missing | Read-only semantic descriptions. | Native labels/values/hints and announcements. |
| accessibilityAction / AdjustableAction | Missing | Handler tokens, value changes and native AX actions. | Real AX invocation and lifecycle-safe updates. |
| accessibilityElement / grouping / representation | Missing | Grouping, children and sort priority. | AX tree identity, focus and hidden/disabled semantics. |
| accessibilityRotor / live regions | Missing | Entry identity, announcements and navigation. | Platform support and assistive-technology validation. |
| safeAreaInset / safeAreaPadding | Missing | Insets, edge content and region policy. | Native window/scene geometry and scroll interactions. |
| preferredColorScheme / tint / controlSize | Missing | Environment presentation values. | Public environment/style APIs and dynamic changes. |
| Layout direction / locale / dynamic type | Missing | Inherited environment and formatting values. | Localization, RTL geometry and accessibility text scaling. |
| Presentation detents / interactiveDismissDisabled | Missing | Detent selection and dismissal permission. | Platform-specific sheet contracts and cleanup. |
| Window sizing / placement / restoration | Missing | Frame constraints, persisted IDs and placement. | Current AppOptions only sets initial dimensions. |

## Related Apple-framework SwiftUI widgets and future platform ports

| Widget / capability | Status | State / binding contract | Remaining work / evidence |
| --- | --- | --- | --- |
| Swift Charts: Chart / marks / axes / legends | Missing | Data identities, domains, selection and scroll position. | Chart/BarMark/LineMark/AreaMark/PointMark/RuleMark/RectangleMark/SectorMark and selection/AX APIs; WebView visualization is the current alternative. |
| MapKit: Map / MapReader / Map controls | Missing | Camera, selection, annotations, routes and location authorization. | Native map ownership; compass/scale/pitch/location controls and privacy/cancellation. |
| WebKit SwiftUI WebView / WebPage | SDK gate | WebPage navigation, loading and history state. | Audit newer WebKit SwiftUI API; JonUI currently owns a WKWebView directly. |
| AVKit: VideoPlayer | Missing | Player model, playback/time/loading/error state. | Native media lifecycle, audio-session policy and controls. |
| PhotosUI: PhotosPicker | Platform gate | Selected transferable items and async loading. | Availability, library authorization and cancellation. |
| QuickLook: preview / PreviewApplication | Platform gate | URL/item selection and preview lifecycle. | Availability, file access and native controller ownership. |
| SceneKit: SceneView | Platform gate | Scene resources, point of view and interaction. | Deprecation/availability audit and native resource cleanup. |
| RealityKit: RealityView / Model3D | Platform gate | Scene/entity/model loading and update phase. | Platform availability, assets and renderer ownership. |
| SpriteKit: SpriteView | Missing | Scene ownership, pause and rendering options. | Resource lifetime, input and frame scheduling. |
| PDFKit: native PDF view adapter | Missing | Document/page/selection/zoom and loading errors. | General NSViewRepresentable extension path needed. |
| StoreKit: StoreView / ProductView / SubscriptionStoreView | Platform gate | Product loading, purchase/restore and entitlement state. | Availability plus explicit purchase authorization; no provisioning/spending by automation. |
| AuthenticationServices: SignInWithAppleButton | Platform gate | Authentication request/result/cancellation. | Entitlements, native dialogs and credential handling. |
| GameKit: AccessPoint / game widgets | Platform gate | Authentication, leaderboards/achievements and presentation. | Framework/entitlement and hardware availability audit. |
| WidgetKit: Widget / WidgetBundle / accessory views | Platform gate | Timeline entries, configuration and app-group state. | Separate extension/process architecture; not ordinary app widgets. |
| ActivityKit: ActivityConfiguration / Dynamic Island | Platform gate | Activity content, stale/end state and updates. | iOS-specific extension/runtime and lifecycle design. |
| WatchKit: platform controls / complications | Platform gate | Watch scene/navigation and device-specific inputs. | Current native launcher is macOS only. |
| UIKit / AppKit representables | Internal only | Native view/controller/coordinator and delegate ownership. | NSViewRepresentable used internally; public user-defined adapter registry is missing. |
| Style configuration helper views | SDK audit | Label/title/icon/value payloads for style protocols. | Generic Content/Body/default-label/subview/section proxy types are implementation/style payloads; audit alongside each owning widget rather than treating them as standalone controls. |

## TSX and automatic state/binding authoring

- [ ] Add a `jonui/jsx-runtime` with typed intrinsic elements and children rules.
- [ ] Define mappings for constructors, modifiers, keyed children and callbacks.
- [ ] Preserve tracked body evaluation: a standard JSX transform alone evaluates
  expressions too early for this runtime's fine-grained reactive boundaries.
- [ ] Prototype a compiler-only `let name = $state("JonUI")` syntax. Lower reads to
  tracked cell reads, assignments/updates to guarded writes, and a recognized
  `<TextField text={name} />` binding prop to the cell's native binding.
- [ ] Preserve TypeScript diagnostics, lexical scope/shadowing, compound updates,
  destructuring, closures, immutable structured state and source maps.
- [ ] Make component/key identity and request/task cancellation guards identical
  to the existing explicit State API. No synchronous JS getters on the SwiftUI thread.
- [ ] Integrate TSX transpilation into launcher/playground reload with recoverable
  diagnostics and existing state-preservation/cleanup rules.
- [ ] Test direct props, expressions, event writes, keyed rows, source errors and
  owner teardown. Keep explicit State/Binding as a supported low-level API.

TSX syntax is feasible with a small JSX runtime; `.value` elision throughout
ordinary expressions/assignments needs compiler lowering and type-checking work.
Direct binding props alone can be a smaller first milestone. This is planned,
not implemented by merely stripping TypeScript types.

## Maintaining this ledger

Run `python3 scripts/setup-hooks.py` once per clone. Before each commit, review
changed widget/state contracts, update the relevant rows and Current review, and
stage this file. Pre-commit rejects omitted reviews/unclassified public API and
stamps the staged source-tree fingerprint plus the checkout HEAD used as a review
baseline. A baseline is not necessarily the new commit's parent (for example,
when amending). Stamping preserves unstaged edits and never stages arbitrary
worktree hunks. A commit with no coverage change still needs a reviewed note.

Git may cache its tree before later hooks run. The prepare-commit-msg,
pre-merge-commit and pre-applypatch hooks therefore **only verify**, never mutate
the index. They catch flows that bypass pre-commit, including `commit --no-verify`.
Older-history replay/import may pause for review or a stale stamp. Review/stage
the ledger, run the stamp command below, then retry/continue the operation. This
keeps the recorded fingerprint in the actual commit, rather than merely in an
index Git has already copied.

```sh
python3 scripts/swiftui_coverage.py
python3 scripts/swiftui_coverage.py --staged --stamp
python3 -m unittest discover -s tests -p 'test_swiftui_coverage.py'
```

The local hooks are versioned and installed in this checkout; new clones must run
the setup command. Replacing/disabling hooks, Git plumbing, or external clients
can still bypass local enforcement; this is not server-side branch protection.
Repository instructions require the same review for contributors and automation.

<!-- coverage-review:generated -->
Review baseline (checkout HEAD before commit): `e02fe94effb5c7ee6bd4945465efa4487a7c8a9d`.

Staged source-tree SHA-256 (excluding this catalog): `d30f86fb8bb1419d0e94414ae52fc43d816c02e5a9bb7a516bb72f338dc9d60f`.
<!-- /coverage-review:generated -->
