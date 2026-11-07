import AppKit
import SwiftUI
import Observation
import WebKit
import CoreFoundation

private func jsonData(_ value: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
}
private func encode(_ value: Any) throws -> String {
    String(decoding: try jsonData(value), as: UTF8.self)
}
private struct BridgeError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
private func integer(_ value: Any?) throws -> Int {
    guard let value = value as? Int, value > 0 else { throw BridgeError("Expected a positive handle") }
    return value
}

@Observable
private final class Cell {
    private static let liveLock = NSLock()
    private static var liveCount = 0
    static var live: Int { liveLock.lock(); defer { liveLock.unlock() }; return liveCount }
    var value: Any
    var revision = 0
    init(_ value: Any) { self.value = value; Self.liveLock.lock(); Self.liveCount += 1; Self.liveLock.unlock() }
    deinit { Self.liveLock.lock(); Self.liveCount -= 1; Self.liveLock.unlock() }
    func snapshot() -> [String: Any] { ["value": value, "revision": revision] }
}

// Retained Swift boxes, referenced through opaque integer handles in the C ABI.
// Children retain their boxes independently of the host's lookup table.
@Observable
private final class ViewBox: Identifiable {
    static var live = 0
    let id: Int
    let kind: String
    var props: [String: Any] = [:]
    var children: [ViewBox] = []
    init(id: Int, kind: String) { self.id = id; self.kind = kind; Self.live += 1 }
    deinit { Self.live -= 1 }
    func string(_ key: String, _ fallback: String = "") -> String { props[key] as? String ?? fallback }
    func number(_ key: String) -> CGFloat? { (props[key] as? NSNumber).map { CGFloat($0.doubleValue) } }
    func dimension(_ key: String) -> CGFloat? { props[key] as? String == "infinity" ? .infinity : number(key) }
}

private let horizontalAlignments = ["leading", "center", "trailing"]
private let verticalAlignments = ["top", "center", "bottom", "firstTextBaseline", "lastTextBaseline"]
private let frameAlignments: [String: Alignment] = ["center": .center, "leading": .leading, "trailing": .trailing,
    "top": .top, "bottom": .bottom, "topLeading": .topLeading, "topTrailing": .topTrailing,
    "bottomLeading": .bottomLeading, "bottomTrailing": .bottomTrailing]
private func layoutNumber(_ value: Any) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }
    return number.doubleValue
}
private func validateLayout(_ kind: String, _ props: [String: Any]) throws {
    func keys(_ allowed: [String]) throws {
        guard Set(props.keys).isSubset(of: Set(allowed)) else { throw BridgeError("Unknown layout option") }
    }
    func number(_ key: String, nonnegative: Bool = false, infinity: Bool = false) throws {
        guard let value = props[key] else { return }
        if infinity, value as? String == "infinity" { return }
        guard let value = layoutNumber(value), !nonnegative || value >= 0 else { throw BridgeError("Invalid layout number: \(key)") }
    }
    func choice(_ key: String, _ allowed: [String]) throws {
        if let value = props[key] { guard let value = value as? String, allowed.contains(value) else { throw BridgeError("Invalid layout \(key)") } }
    }
    func boolean(_ key: String) throws {
        if let value = props[key] { guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw BridgeError("Invalid layout boolean: \(key)") } }
    }
    switch kind {
    case "scroll":
        try keys(["axes", "showsIndicators"]); try choice("axes", ["vertical", "horizontal", "both"]); try boolean("showsIndicators")
    case "spacer": try keys(["minLength"]); try number("minLength", nonnegative: true)
    case "vstack", "hstack", "lazyvstack", "lazyhstack":
        try keys(["alignment", "spacing"]); try choice("alignment", ["vstack", "lazyvstack"].contains(kind) ? horizontalAlignments : verticalAlignments); try number("spacing")
    case "lazyvgrid", "lazyhgrid":
        try keys(["tracks", "alignment", "spacing"])
        try choice("alignment", kind == "lazyvgrid" ? horizontalAlignments : verticalAlignments); try number("spacing", nonnegative: true)
        guard let tracks = props["tracks"] as? [[String: Any]], !tracks.isEmpty else { throw BridgeError("Grid tracks must be a nonempty array") }
        for track in tracks {
            guard let size = track["size"] as? String, ["fixed", "flexible", "adaptive"].contains(size),
                  Set(track.keys).isSubset(of: Set(["size", "spacing", "alignment"] + (size == "fixed" ? ["value"] : ["min", "max"]))) else { throw BridgeError("Invalid grid item size/options") }
            if let raw = track["spacing"] { guard let value = layoutNumber(raw), value >= 0 else { throw BridgeError("Invalid grid item spacing") } }
            if let raw = track["alignment"] { guard let value = raw as? String, frameAlignments[value] != nil else { throw BridgeError("Invalid grid item alignment") } }
            if size == "fixed" {
                guard let raw = track["value"], let value = layoutNumber(raw), value >= 0 else { throw BridgeError("Invalid fixed grid item value") }
            } else {
                let lower = track["min"] ?? (size == "flexible" ? 10 : -1), upper = track["max"] ?? "infinity"
                guard let min = layoutNumber(lower), min >= 0, size != "adaptive" || min > 0 else { throw BridgeError("Invalid grid item minimum") }
                if upper as? String != "infinity" { guard let max = layoutNumber(upper), max >= min else { throw BridgeError("Invalid grid item maximum/bounds") } }
            }
        }
    case "modifier":
        switch props["name"] as? String {
        case "focusSection": try keys(["name"])
        case "disabled":
            try keys(["name", "value"])
            guard props["value"] != nil else { throw BridgeError("Missing disabled boolean") }
            try boolean("value")
        case "frame":
            let fixed = ["width", "height"], flexible = ["minWidth", "idealWidth", "maxWidth", "minHeight", "idealHeight", "maxHeight"]
            try keys(["name", "alignment"] + fixed + flexible)
            guard !fixed.contains(where: { props[$0] != nil }) || !flexible.contains(where: { props[$0] != nil }) else { throw BridgeError("Cannot mix fixed and flexible frame options") }
            try choice("alignment", Array(frameAlignments.keys))
            for key in fixed + flexible { try number(key, nonnegative: true, infinity: key.hasPrefix("max")) }
            for axis in ["Width", "Height"] {
                let bounds = ["min", "ideal", "max"].compactMap { props[$0 + axis] }.map { $0 as? String == "infinity" ? Double.infinity : layoutNumber($0)! }
                guard zip(bounds, bounds.dropFirst()).allSatisfy({ $0.0 <= $0.1 }) else { throw BridgeError("Frame bounds must be ordered min <= ideal <= max") }
            }
        case "padding":
            let edges = ["top", "leading", "bottom", "trailing"]
            try keys(["name", "points"] + edges)
            guard props["points"] == nil || !edges.contains(where: { props[$0] != nil }) else { throw BridgeError("Cannot mix padding points and edges") }
            for key in ["points"] + edges { try number(key) }
        case "fixedSize": try keys(["name", "horizontal", "vertical"]); try boolean("horizontal"); try boolean("vertical")
        case "layoutPriority":
            try keys(["name", "value"]); guard props["value"] != nil else { throw BridgeError("Missing layout priority") }; try number("value")
        default: break
        }
    default: break
    }
}

private struct LayoutFrames: PreferenceKey {
    static var defaultValue: [Int: CGRect] { [:] }
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) { value.merge(nextValue()) { _, new in new } }
}

private func bindingKind(_ kind: String, _ props: [String: Any]) -> String? {
    if kind == "modifier", props["name"] as? String == "sheet" { return "toggle" }
    return ["toggle", "textfield", "securefield", "texteditor", "list", "slider", "stepper", "picker", "datepicker"].contains(kind) ? kind : nil
}
private let earliestDate: Double = -62135596800000, latestDate: Double = 253402300799999
private func dateTimestamp(_ value: Any) -> Double? {
    guard let value = layoutNumber(value), value >= earliestDate, value <= latestDate else { return nil }
    return value
}
private func validateBindingValue(_ kind: String, _ value: Any) throws {
    let valid: Bool
    switch kind {
    case "toggle": valid = (value as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } ?? false
    case "textfield", "securefield", "texteditor": valid = value is String
    case "slider", "stepper": valid = layoutNumber(value) != nil
    case "datepicker": valid = dateTimestamp(value) != nil
    case "list", "picker": valid = value is NSNull || value is String || layoutNumber(value) != nil
    default: valid = false
    }
    guard valid else { throw BridgeError("Invalid binding value for \(kind)") }
}
private let pickerPlaceholder = "!"
private func pickerKey(_ value: Any) -> String? { (try? jsonData(value))?.base64EncodedString() }
private struct PickerItem: Identifiable {
    let id: String
    let label: String
    let value: Any
}
private func pickerItems(_ props: [String: Any]) -> [PickerItem] {
    (props["options"] as? [[String: Any]] ?? []).compactMap { option in
        guard let value = option["value"], let id = pickerKey(value), let label = option["label"] as? String else { return nil }
        return PickerItem(id: id, label: label, value: value)
    }
}
private func validateInput(_ kind: String, _ props: [String: Any]) throws {
    func keys(_ allowed: [String]) throws {
        guard Set(props.keys).isSubset(of: Set(allowed)) else { throw BridgeError("Unknown input option") }
    }
    switch kind {
    case "datepicker":
        try keys(["title", "state", "min", "max", "components", "style", "timeZone", "focusName"])
        guard props["title"] is String else { throw BridgeError("DatePicker title must be a string") }
        for key in ["min", "max"] where props[key] != nil {
            guard dateTimestamp(props[key]!) != nil else { throw BridgeError("DatePicker bounds must be Unix milliseconds within UTC years 0001...9999") }
        }
        guard (props["min"].flatMap(dateTimestamp) ?? earliestDate) <= (props["max"].flatMap(dateTimestamp) ?? latestDate) else { throw BridgeError("DatePicker bounds must satisfy min <= max") }
        if let components = props["components"] { guard let value = components as? String, ["date", "time", "dateAndTime"].contains(value) else { throw BridgeError("Invalid DatePicker components") } }
        if let style = props["style"] { guard let value = style as? String, ["automatic", "compact", "graphical"].contains(value) else { throw BridgeError("Invalid DatePicker style") } }
        if let zone = props["timeZone"] { guard let value = zone as? String, !value.isEmpty, TimeZone(identifier: value) != nil else { throw BridgeError("Unknown DatePicker time zone") } }
    case "textfield", "securefield":
        try keys(["title", "state", "submit", "editing", "focusName"])
        guard props["title"] is String else { throw BridgeError("Text input title must be a string") }
        for key in ["submit", "editing"] {
            if let raw = props[key] {
                guard let token = layoutNumber(raw), token > 0, token.rounded() == token, token < Double(Int.max) else { throw BridgeError("Invalid text \(key) token") }
            }
        }
    case "texteditor":
        try keys(["state", "monospaced", "editing", "focusName"])
        guard let raw = props["monospaced"], CFGetTypeID(raw as CFTypeRef) == CFBooleanGetTypeID() else { throw BridgeError("TextEditor monospaced must be a boolean") }
        if let raw = props["editing"] {
            guard let token = layoutNumber(raw), token > 0, token.rounded() == token, token < Double(Int.max) else { throw BridgeError("Invalid text editing token") }
        }
    case "form":
        try keys(["style"])
        if let style = props["style"] { guard let style = style as? String, ["automatic", "grouped", "columns"].contains(style) else { throw BridgeError("Invalid form style") } }
    case "section":
        try keys(["title", "footer"])
        guard props["title"] is String, props["footer"] == nil || props["footer"] is String else { throw BridgeError("Section title/footer must be strings") }
    case "picker":
        try keys(["title", "state", "options", "style", "placeholder"])
        guard props["title"] is String, props["placeholder"] == nil || props["placeholder"] is String else { throw BridgeError("Picker title/placeholder must be strings") }
        if let style = props["style"] { guard let style = style as? String, ["automatic", "menu", "segmented"].contains(style) else { throw BridgeError("Invalid picker style") } }
        guard let options = props["options"] as? [[String: Any]] else { throw BridgeError("Picker options must be an array") }
        var seen = Set<String>()
        for option in options {
            guard Set(option.keys) == Set(["value", "label"]), option["label"] is String, let value = option["value"] else { throw BridgeError("Invalid picker option") }
            try validateBindingValue("picker", value)
            guard let key = pickerKey(value), seen.insert(key).inserted else { throw BridgeError("Duplicate picker option") }
        }
    case "slider", "stepper":
        try keys(["title", "state", "min", "max", "step"])
        guard props["title"] is String else { throw BridgeError("Numeric input title must be a string") }
        for key in ["min", "max", "step"] where props[key] != nil {
            guard layoutNumber(props[key]!) != nil else { throw BridgeError("Invalid numeric input \(key)") }
        }
        let lower = props["min"].flatMap(layoutNumber) ?? 0, upper = props["max"].flatMap(layoutNumber) ?? (kind == "slider" ? 1 : 100)
        let span = upper - lower
        guard span > 0, span.isFinite else { throw BridgeError("Numeric input range must have a positive finite span") }
        if let step = props["step"].flatMap(layoutNumber) ?? (kind == "stepper" ? 1 : nil) {
            guard step > 0, step <= span, (span / step).isFinite else { throw BridgeError("Invalid numeric input step") }
        }
    default: break
    }
}

// Own focus state at a stable input identity; callbacks and bindings only hold
// weak references to the bridge objects so an old SwiftUI view cannot retain them.
private struct NativeTextInput: View {
    let kind: String
    let title: String
    let monospaced: Bool
    let text: Binding<String>
    let submitted: () -> Void
    let editingChanged: (Bool) -> Void
    @FocusState private var focused: Bool
    var body: some View {
        Group {
            if kind == "securefield" { SecureField(title, text: text).onSubmit(submitted) }
            else if kind == "texteditor" {
                TextEditor(text: text)
                    .font(monospaced ? .system(.body, design: .monospaced) : .body)
                    .autocorrectionDisabled(monospaced)
            } else { TextField(title, text: text).onSubmit(submitted) }
        }
        .focused($focused)
        .onChange(of: focused) { _, value in editingChanged(value) }
    }
}

// SwiftUI caches view values and old ForEach collections outside the viewport.
// Only the committed host graph owns boxes; those caches hold weak references.
private struct ViewReference: Identifiable {
    let id: Int
    weak var box: ViewBox?
    init(_ box: ViewBox) { id = box.id; self.box = box }
}

// A bounded hosting surface gives each logical control an owned native
// subtree. Resolve controls by public AppKit types within that subtree, without
// matching labels, geometry, accessibility identifiers, or private SwiftUI views.
private struct HostedNativeControl: NSViewRepresentable {
    let reference: ViewReference
    let content: AnyView
    unowned let host: Host
    func makeCoordinator() -> Coordinator { Coordinator(reference: reference, host: host) }
    func makeNSView(context: Context) -> NSHostingView<AnyView> {
        let view = NSHostingView(rootView: AnyView(content.environment(\.self, context.environment)))
        view.sizingOptions = [.intrinsicContentSize]
        context.coordinator.view = view
        if let box = reference.box, !host.stopping, host.nodes[reference.id] === box {
            host.hostedControls[reference.id]?.invalidate()
            host.hostedControls[reference.id] = context.coordinator
        } else { context.coordinator.invalidate() }
        return view
    }
    func updateNSView(_ view: NSHostingView<AnyView>, context: Context) {
        guard context.coordinator.active, let box = reference.box, !host.stopping, host.nodes[reference.id] === box else {
            context.coordinator.invalidate(); return
        }
        view.rootView = AnyView(content.environment(\.self, context.environment))
    }
    static func dismantleNSView(_ view: NSHostingView<AnyView>, coordinator: Coordinator) {
        coordinator.invalidate()
        if coordinator.host?.hostedControls[coordinator.reference.id] === coordinator {
            coordinator.host?.hostedControls.removeValue(forKey: coordinator.reference.id)
        }
    }
    final class Coordinator {
        let reference: ViewReference
        weak var host: Host?
        weak var view: NSHostingView<AnyView>?
        var active = true
        init(reference: ViewReference, host: Host) { self.reference = reference; self.host = host }
        func invalidate() {
            guard active else { return }
            active = false; view?.rootView = AnyView(EmptyView())
        }
        func target(in window: NSWindow) -> NSView? {
            guard active, let box = reference.box, let host, !host.stopping, host.nodes[reference.id] === box,
                  let view, view.window === window else { return nil }
            view.layoutSubtreeIfNeeded()
            func find(_ node: NSView) -> NSView? {
                if box.kind == "datepicker" {
                    if node is NSDatePicker, host.eligibleFocusView(node, in: window) { return node }
                } else if box.kind == "texteditor" {
                    if let editor = node as? NSTextView, editor.isEditable, !editor.isFieldEditor { return editor }
                } else if let field = node as? NSTextField, field.isEditable { return field }
                for child in node.subviews { if let target = find(child) { return target } }
                return nil
            }
            return find(view)
        }
    }
}

private func gridItems(_ tracks: [[String: Any]]) -> [GridItem] {
    tracks.map { track -> GridItem in
        let size: GridItem.Size
        let minimum = CGFloat(track["min"].flatMap(layoutNumber) ?? 10)
        let maximum = track["max"].flatMap(layoutNumber).map { CGFloat($0) } ?? CGFloat.infinity
        switch track["size"] as? String {
        case "fixed": size = .fixed(CGFloat(layoutNumber(track["value"]!)!))
        case "adaptive": size = .adaptive(minimum: minimum, maximum: maximum)
        default: size = .flexible(minimum: minimum, maximum: maximum)
        }
        let spacing = track["spacing"].flatMap(layoutNumber).map { CGFloat($0) }
        let alignment = (track["alignment"] as? String).flatMap { frameAlignments[$0] }
        return GridItem(size, spacing: spacing, alignment: alignment)
    }
}

private struct NativeView: View {
    let reference: ViewReference
    private var box: ViewBox { reference.box! }
    unowned let host: Host
    init(box: ViewBox, host: Host) { reference = ViewReference(box); self.host = host }
    init(reference: ViewReference, host: Host) { self.reference = reference; self.host = host }
    @ViewBuilder var body: some View {
        if let node = reference.box, !host.stopping, host.nodes[node.id] === node {
            let id = node.id
            if host.layoutTesting {
                content().background(GeometryReader { geometry in
                    Color.clear.preference(key: LayoutFrames.self, value: [id: geometry.frame(in: .global)])
                })
            } else { content() }
        }
    }
    private func child(_ index: Int = 0) -> AnyView {
        guard let box = reference.box, !host.stopping, host.nodes[box.id] === box, box.children.indices.contains(index) else { return AnyView(EmptyView()) }
        return AnyView(NativeView(box: box.children[index], host: host))
    }
    private func boolBinding() -> Binding<Bool> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value // Register this view as an Observation reader of the binding.
        return Binding(get: { [weak cell] in cell?.value as? Bool ?? false }, set: { [weak cell, weak box, weak host] value in
            guard let cell, let box, let host, !host.stopping, host.nodes[box.id] === box,
                  host.cells[box.props["state"] as? Int ?? 0] === cell else { return }
            host.nativeWrite(cell, value: value)
        })
    }
    private func textBinding() -> Binding<String> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value // Register this view as an Observation reader of the binding.
        return Binding(get: { [weak cell] in cell?.value as? String ?? "" }, set: { [weak cell, weak box, weak host] value in
            guard let cell, let box, let host, !host.stopping, host.nodes[box.id] === box,
                  host.cells[box.props["state"] as? Int ?? 0] === cell else { return }
            host.nativeWrite(cell, value: value)
        })
    }
    private func textInputView() -> AnyView {
        let box = self.box, host = self.host, token = box.props["submit"] as? Int, editing = box.props["editing"] as? Int
        let submitted = { [weak box, weak host] in
            guard let box, let host, let token else { return }
            host.textSubmit(box.id, token: token)
        }
        let changed = { [weak box, weak host] (value: Bool) in
            guard let box, let host, let editing else { return }
            host.textEditing(box.id, token: editing, editing: value)
        }
        let input = NativeTextInput(kind: box.kind, title: box.string("title"), monospaced: box.props["monospaced"] as? Bool ?? false,
                                    text: textBinding(), submitted: submitted, editingChanged: changed)
        return AnyView(HostedNativeControl(reference: reference, content: AnyView(input), host: host))
    }
    fileprivate func numberBinding() -> Binding<Double> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value
        return Binding(get: { [weak cell, weak box] in
            guard let box else { return 0 }
            let lower = Double(box.number("min") ?? 0), upper = Double(box.number("max") ?? (box.kind == "slider" ? 1 : 100))
            return min(upper, max(lower, cell.flatMap { layoutNumber($0.value) } ?? lower))
        }, set: { [weak cell, weak box, weak host] next in
            guard let cell, let box, let host, next.isFinite, host.nodes[box.id] === box, !host.stopping else { return }
            let lower = Double(box.number("min") ?? 0), upper = Double(box.number("max") ?? (box.kind == "slider" ? 1 : 100))
            var value = min(upper, max(lower, next))
            if box.kind == "slider", let step = box.number("step") { value = min(upper, max(lower, lower + ((value - lower) / Double(step)).rounded() * Double(step))) }
            host.nativeWrite(cell, value: value)
        })
    }
    fileprivate func dateBinding() -> Binding<Date> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value
        return Binding(get: { [weak cell, weak box] in
            guard let cell, let box else { return Date(timeIntervalSince1970: 0) }
            let lower = box.props["min"].flatMap(dateTimestamp) ?? earliestDate, upper = box.props["max"].flatMap(dateTimestamp) ?? latestDate
            return Date(timeIntervalSince1970: min(upper, max(lower, dateTimestamp(cell.value) ?? lower)) / 1000)
        }, set: { [weak cell, weak box, weak host] date in
            guard let cell, let box, let host, !host.stopping, host.nodes[box.id] === box,
                  host.cells[box.props["state"] as? Int ?? 0] === cell else { return }
            let value = (date.timeIntervalSince1970 * 1000).rounded()
            guard value.isFinite else { return }
            let lower = box.props["min"].flatMap(dateTimestamp) ?? earliestDate, upper = box.props["max"].flatMap(dateTimestamp) ?? latestDate
            host.nativeWrite(cell, value: min(upper, max(lower, value)))
        })
    }
    private func selectionBinding() -> Binding<String?> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value // Register this view as an Observation reader of the binding.
        return Binding(get: { [weak cell] in
            guard let cell else { return nil }
            if cell.value is NSNull { return nil }
            return try? encode(cell.value)
        }, set: { [weak cell, weak box, weak host] selected in
            guard let cell, let box, let host, !host.stopping, host.nodes[box.id] === box,
                  host.cells[box.props["state"] as? Int ?? 0] === cell else { return }
            let value = selected.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8), options: [.fragmentsAllowed]) } ?? NSNull()
            host.nativeWrite(cell, value: value)
        })
    }
    fileprivate func pickerBinding() -> Binding<String> {
        let box = self.box, host = self.host
        let cell = host.cells[box.props["state"] as? Int ?? 0]!
        _ = cell.value
        return Binding(get: { [weak cell, weak box] in
            guard let cell, let box, let key = pickerKey(cell.value), pickerItems(box.props).contains(where: { $0.id == key }) else { return pickerPlaceholder }
            return key
        }, set: { [weak cell, weak box, weak host] key in
            guard let cell, let box, let host, !host.stopping, host.nodes[box.id] === box,
                  let option = pickerItems(box.props).first(where: { $0.id == key }) else { return }
            host.nativeWrite(cell, value: option.value)
        })
    }
    private func tag(_ row: ViewBox) -> String? {
        if row.kind == "modifier", row.string("name") == "tag", let value = row.props["value"] { return try? encode(value) }
        return row.children.first.flatMap(tag)
    }
    private func rows(_ node: ViewBox) -> [ViewBox] {
        if node.kind == "foreach" { return node.children }
        if node.kind == "dynamic", let child = node.children.first { return rows(child) }
        return [node]
    }
    private func lazyItems(_ node: ViewBox) -> [ViewBox] {
        // Expose keyed rows directly to SwiftUI's lazy ForEach. An erased group
        // around an entire ForEach would make all of its rows one eager item.
        if node.kind == "foreach" || node.kind == "dynamic" { return node.children.flatMap(lazyItems) }
        return [node]
    }
    private func content() -> AnyView {
        if host.stopping || reference.box == nil || host.nodes[box.id] !== box { return AnyView(EmptyView()) }
        switch box.kind {
        case "text": return AnyView(Text(box.string("value")))
        case "image": return AnyView(Image(systemName: box.string("systemName")))
        case "spacer": return AnyView(Spacer(minLength: box.number("minLength")))
        case "divider": return AnyView(Divider())
        case "vstack":
            let alignment: HorizontalAlignment = box.string("alignment") == "leading" ? .leading : box.string("alignment") == "trailing" ? .trailing : .center
            return AnyView(VStack(alignment: alignment, spacing: box.number("spacing")) {
                ForEach(box.children.map(ViewReference.init)) { item in NativeView(reference: item, host: host) }
            })
        case "hstack":
            let alignments: [String: VerticalAlignment] = ["top": .top, "center": .center, "bottom": .bottom, "firstTextBaseline": .firstTextBaseline, "lastTextBaseline": .lastTextBaseline]
            return AnyView(HStack(alignment: alignments[box.string("alignment")] ?? .center, spacing: box.number("spacing")) {
                ForEach(box.children.map(ViewReference.init)) { item in NativeView(reference: item, host: host) }
            })
        case "lazyvstack":
            let alignment: HorizontalAlignment = box.string("alignment") == "leading" ? .leading : box.string("alignment") == "trailing" ? .trailing : .center
            let items = box.children.flatMap(lazyItems).map(ViewReference.init)
            return AnyView(LazyVStack(alignment: alignment, spacing: box.number("spacing")) {
                ForEach(items) { item in NativeView(reference: item, host: host) }
            })
        case "lazyhstack":
            let alignments: [String: VerticalAlignment] = ["top": .top, "center": .center, "bottom": .bottom, "firstTextBaseline": .firstTextBaseline, "lastTextBaseline": .lastTextBaseline]
            let items = box.children.flatMap(lazyItems).map(ViewReference.init)
            return AnyView(LazyHStack(alignment: alignments[box.string("alignment")] ?? .center, spacing: box.number("spacing")) {
                ForEach(items) { item in NativeView(reference: item, host: host) }
            })
        case "lazyvgrid":
            let alignment: HorizontalAlignment = box.string("alignment") == "leading" ? .leading : box.string("alignment") == "trailing" ? .trailing : .center
            let tracks = gridItems(box.props["tracks"] as? [[String: Any]] ?? [])
            let items = box.children.flatMap(lazyItems).map(ViewReference.init)
            return AnyView(LazyVGrid(columns: tracks, alignment: alignment, spacing: box.number("spacing")) {
                ForEach(items) { item in NativeView(reference: item, host: host) }
            })
        case "lazyhgrid":
            let alignments: [String: VerticalAlignment] = ["top": .top, "center": .center, "bottom": .bottom, "firstTextBaseline": .firstTextBaseline, "lastTextBaseline": .lastTextBaseline]
            let tracks = gridItems(box.props["tracks"] as? [[String: Any]] ?? [])
            let items = box.children.flatMap(lazyItems).map(ViewReference.init)
            return AnyView(LazyHGrid(rows: tracks, alignment: alignments[box.string("alignment")] ?? .center, spacing: box.number("spacing")) {
                ForEach(items) { item in NativeView(reference: item, host: host) }
            })
        case "scroll":
            let axes: Axis.Set = box.string("axes", "vertical") == "both" ? [.horizontal, .vertical] : box.string("axes", "vertical") == "horizontal" ? .horizontal : .vertical
            return AnyView(ScrollView(axes, showsIndicators: box.props["showsIndicators"] as? Bool ?? true) { child() })
        case "form":
            let form = Form { ForEach(box.children.map(ViewReference.init)) { item in NativeView(reference: item, host: host) } }
            switch box.string("style", "automatic") {
            case "grouped": return AnyView(form.formStyle(.grouped))
            case "columns": return AnyView(form.formStyle(.columns))
            default: return AnyView(form.formStyle(.automatic))
            }
        case "section":
            let title = box.string("title"), footer = box.props["footer"] as? String
            return AnyView(Section {
                ForEach((reference.box?.children ?? []).map(ViewReference.init)) { item in NativeView(reference: item, host: host) }
            } header: { Text(title) } footer: {
                if let footer { Text(footer) }
            })
        case "slider":
            let title = box.string("title")
            return AnyView(Slider(value: numberBinding(), in: Double(box.number("min") ?? 0)...Double(box.number("max") ?? 1)) { Text(title) })
        case "stepper": return AnyView(Stepper(box.string("title"), value: numberBinding(), in: Double(box.number("min") ?? 0)...Double(box.number("max") ?? 100), step: Double(box.number("step") ?? 1)))
        case "datepicker":
            let lower = Date(timeIntervalSince1970: (box.props["min"].flatMap(dateTimestamp) ?? earliestDate) / 1000)
            let upper = Date(timeIntervalSince1970: (box.props["max"].flatMap(dateTimestamp) ?? latestDate) / 1000)
            let components: DatePickerComponents = box.string("components", "dateAndTime") == "date" ? .date : box.string("components", "dateAndTime") == "time" ? .hourAndMinute : [.date, .hourAndMinute]
            let zone = (box.props["timeZone"] as? String).flatMap(TimeZone.init(identifier:)) ?? .autoupdatingCurrent
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
            let picker = DatePicker(box.string("title"), selection: dateBinding(), in: lower...upper, displayedComponents: components)
                .environment(\.calendar, calendar).environment(\.timeZone, zone)
            switch box.string("style", "automatic") {
            case "compact": return AnyView(HostedNativeControl(reference: reference, content: AnyView(picker.datePickerStyle(.compact)), host: host))
            case "graphical": return AnyView(HostedNativeControl(reference: reference, content: AnyView(picker.datePickerStyle(.graphical)), host: host))
            default: return AnyView(HostedNativeControl(reference: reference, content: AnyView(picker.datePickerStyle(.automatic)), host: host))
            }
        case "picker":
            let items = pickerItems(box.props), selection = pickerBinding(), placeholder = box.string("placeholder", "Select…")
            let picker = Picker(box.string("title"), selection: selection) {
                if selection.wrappedValue == pickerPlaceholder { Text(placeholder).tag(pickerPlaceholder).disabled(true) }
                ForEach(items) { item in Text(item.label).tag(item.id) }
            }.disabled(items.isEmpty)
            switch box.string("style", "automatic") {
            case "menu": return AnyView(picker.pickerStyle(.menu))
            case "segmented": return AnyView(picker.pickerStyle(.segmented))
            default: return AnyView(picker.pickerStyle(.automatic))
            }
        case "button":
            let id = box.id, host = self.host
            return AnyView(Button(box.string("title")) { [weak host] in host?.action(id) })
        case "toggle": return AnyView(Toggle(box.string("title"), isOn: boolBinding()))
        case "textfield", "securefield", "texteditor": return textInputView()
        case "webview": return AnyView(EmbeddedWebView(box: box, props: box.props, host: host))
        case "split": return AnyView(NavigationSplitView { child(0) } detail: { child(1) })
        case "list":
            let children = box.children.flatMap(rows).map(ViewReference.init)
            return AnyView(List(selection: selectionBinding()) {
                ForEach(children) { item in
                    NativeView(reference: item, host: host).tag(item.box.flatMap(tag) ?? "null")
                }
            })
        case "foreach":
            return AnyView(ForEach(box.children.map(ViewReference.init)) { item in NativeView(reference: item, host: host) })
        case "dynamic": return child()
        case "modifier":
            switch box.string("name") {
            case "font":
                let fonts: [String: Font] = ["title": .title, "headline": .headline, "body": .body, "caption": .caption]
                return AnyView(child().font(fonts[box.string("value")] ?? .body))
            case "foregroundStyle":
                let style = box.string("value")
                let color: Color = style == "yellow" ? .yellow : style == "secondary" ? .secondary : .primary
                return AnyView(child().foregroundStyle(color))
            case "padding":
                if let points = box.number("points") { return AnyView(child().padding(points)) }
                return AnyView(child().padding(EdgeInsets(top: box.number("top") ?? 0, leading: box.number("leading") ?? 0, bottom: box.number("bottom") ?? 0, trailing: box.number("trailing") ?? 0)))
            case "frame":
                let alignment = frameAlignments[box.string("alignment")] ?? .center
                if box.props["width"] != nil || box.props["height"] != nil { return AnyView(child().frame(width: box.number("width"), height: box.number("height"), alignment: alignment)) }
                return AnyView(child().frame(minWidth: box.number("minWidth"), idealWidth: box.number("idealWidth"), maxWidth: box.dimension("maxWidth"), minHeight: box.number("minHeight"), idealHeight: box.number("idealHeight"), maxHeight: box.dimension("maxHeight"), alignment: alignment))
            case "fixedSize": return AnyView(child().fixedSize(horizontal: box.props["horizontal"] as? Bool ?? false, vertical: box.props["vertical"] as? Bool ?? false))
            case "layoutPriority": return AnyView(child().layoutPriority(Double(box.number("value") ?? 0)))
            case "navigationTitle": return AnyView(child().navigationTitle(box.string("value")))
            case "accessibilityIdentifier": return AnyView(child().accessibilityIdentifier(box.string("value")))
            case "disabled": return AnyView(child().disabled(box.props["value"] as? Bool ?? false))
            case "focusSection": return AnyView(child().focusSection())
            case "sheet": return AnyView(child().sheet(isPresented: boolBinding()) { child(1) })
            case "tag": return child()
            default: return AnyView(EmptyView())
            }
        default: return AnyView(EmptyView())
        }
    }
}

// NSViewRepresentable does not automatically translate SwiftUI isEnabled into
// WebKit interaction state. Keep the gate native so document scripts/data and
// DOM focus state can survive while pointer/key-view entry is unavailable.
private final class ControlWebView: WKWebView {
    private(set) var interactionEnabled = true
    var tabFocusable = true
    func setInteractionEnabled(_ enabled: Bool) {
        guard interactionEnabled != enabled else { return }
        interactionEnabled = enabled
        if !enabled, let window, let responder = window.firstResponder as? NSView,
           responder === self || responder.isDescendant(of: self) { _ = window.makeFirstResponder(nil) }
    }
    override var acceptsFirstResponder: Bool { interactionEnabled && super.acceptsFirstResponder }
    override var canBecomeKeyView: Bool { interactionEnabled && tabFocusable && super.canBecomeKeyView }
    override func becomeFirstResponder() -> Bool { interactionEnabled && super.becomeFirstResponder() }
    override func hitTest(_ point: NSPoint) -> NSView? { interactionEnabled ? super.hitTest(point) : nil }
}

// NSViewRepresentable keeps WKWebView identity independent of SwiftUI body updates.
private struct EmbeddedWebView: NSViewRepresentable {
    let reference: ViewReference
    let props: [String: Any]
    unowned let host: Host
    init(box: ViewBox, props: [String: Any], host: Host) { reference = ViewReference(box); self.props = props; self.host = host }
    func makeCoordinator() -> Coordinator { Coordinator(reference: reference, host: host) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "jonui")
        configuration.userContentController.addScriptMessageHandler(context.coordinator as WKScriptMessageHandlerWithReply, contentWorld: .page, name: "jonuiRPC")
        let view = ControlWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.setAccessibilityIdentifier("webview-\(reference.id)")
        if let box = reference.box, host.nodes[reference.id] === box { host.webViews[reference.id] = context.coordinator }
        context.coordinator.update(view, props: props, enabled: context.environment.isEnabled)
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.update(view, props: props, enabled: context.environment.isEnabled)
    }
    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.invalidate()
        if coordinator.host.webViews[coordinator.reference.id] === coordinator { coordinator.host.webViews.removeValue(forKey: coordinator.reference.id) }
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
        let reference: ViewReference
        unowned let host: Host
        weak var view: WKWebView?
        var active = true, ready = false
        var token = ""
        var source: Data?
        var sentData: Data?
        var navigation: WKNavigation?
        var loads = 0
        var rpcEpoch = 0, nextRPC = 1
        var pendingRPC: [Int: (Any?, String?) -> Void] = [:]
        init(reference: ViewReference, host: Host) { self.reference = reference; self.host = host }
        func invalidate() {
            guard active else { return }
            active = false; cancelRequests("WebView unmounted"); ready = false; source = nil; sentData = nil; navigation = nil; token = ""
            if let view {
                (view as? ControlWebView)?.setInteractionEnabled(false)
                view.stopLoading(); view.navigationDelegate = nil
                let controller = view.configuration.userContentController
                controller.removeScriptMessageHandler(forName: "jonui"); controller.removeScriptMessageHandler(forName: "jonuiRPC"); controller.removeAllUserScripts()
                // A lazy container can cache the platform view after logical
                // removal. Replace the document so its timers/scripts stop too.
                view.loadHTMLString("", baseURL: nil)
            }
        }
        func update(_ view: WKWebView, props: [String: Any], enabled: Bool) {
            self.view = view
            guard active, let box = reference.box, !host.stopping, host.nodes[reference.id] === box else {
                (view as? ControlWebView)?.setInteractionEnabled(false)
                invalidate(); return
            }
            (view as? ControlWebView)?.setInteractionEnabled(enabled)
            (view as? ControlWebView)?.tabFocusable = props["tabFocusable"] as? Bool ?? true
            let html = props["html"] as? String ?? "", bytes = Data(html.utf8)
            if source != bytes || rpcEpoch != props["rpcEpoch"] as? Int {
                cancelRequests("WebView document replaced")
                rpcEpoch = props["rpcEpoch"] as? Int ?? 0
                source = bytes; ready = false; sentData = nil; token = UUID().uuidString; loads += 1
                let literal = (try? encode(token)) ?? "\"\""
                let script = """
                (() => {
                  const token = \(literal), listeners = new Set();
                  let hasData = false, current;
                  const send = value => window.webkit.messageHandlers.jonui.postMessage({ token, value });
                  Object.defineProperty(window, 'jonui', { value: Object.freeze({
                    postMessage: send,
                    remote() {
                      function snapshot(value, seen = new Set()) {
                        if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
                        if (!value || typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('RPC arguments must be finite acyclic JSON');
                        seen.add(value);
                        try { return Array.isArray(value) ? Array.from(value, item => snapshot(item, seen)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, seen)])); }
                        finally { seen.delete(value); }
                      }
                      const invoke = async (method, args) => {
                        const result = await window.webkit.messageHandlers.jonuiRPC.postMessage({ token, method, args: snapshot(args) });
                        if (!result.ok) { const error = new Error(result.error.message); error.name = result.error.name; throw error; }
                        return result.value;
                      };
                      return new Proxy(Object.create(null), { get: (_, method) => typeof method === 'string' && !['then', '__proto__', 'prototype', 'constructor', 'toJSON'].includes(method) ? (...args) => invoke(method, args) : undefined });
                    },
                    onMessage(listener) {
                      if (typeof listener !== 'function') throw new TypeError('Expected a message listener');
                      listeners.add(listener); if (hasData) listener(current);
                      return () => listeners.delete(listener);
                    }
                  }) });
                  Object.defineProperty(window, '__jonuiReceive', { value: (documentToken, value) => {
                    if (documentToken !== token) return;
                    hasData = true; current = value;
                    for (const listener of [...listeners]) listener(value);
                  } });
                  const report = message => window.webkit.messageHandlers.jonui.postMessage({ token, error: String(message) });
                  window.addEventListener('error', event => report(event.error?.stack || event.message || 'Web resource failed to load'));
                  window.addEventListener('unhandledrejection', event => report(event.reason));
                })();
                """
                let controller = view.configuration.userContentController
                controller.removeAllUserScripts()
                controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
                navigation = view.loadHTMLString(html, baseURL: nil)
            } else { deliverData() }
        }
        func deliverData() {
            guard active, ready, let box = reference.box, !host.stopping, host.nodes[reference.id] === box,
                  let view, let value = box.props["data"], let bytes = try? jsonData(value), bytes != sentData else { return }
            sentData = bytes
            let currentToken = token
            let script = "window.__jonuiReceive(\((try? encode(token)) ?? "null"), \(String(decoding: bytes, as: UTF8.self))); null;"
            view.evaluateJavaScript(script) { [weak self] _, error in
                guard let self, self.active, self.token == currentToken else { return }
                if let error { self.report(self.describe(error)) }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard active, navigation === self.navigation else { return }
            ready = true; deliverData()
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(navigation, error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(navigation, error) }
        func navigationFailed(_ navigation: WKNavigation?, _ error: Error) {
            guard navigation === self.navigation, (error as NSError).code != NSURLErrorCancelled else { return }
            cancelRequests("WebView navigation failed"); report(error.localizedDescription)
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { cancelRequests("Web content process terminated"); ready = false; report("Web content process terminated") }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // An embedded HTML control keeps its document. It is not a browser
            // whose next destination inherits the application's callback bridge.
            decisionHandler(action.targetFrame?.isMainFrame == true && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard active, let box = reference.box, !host.stopping, host.nodes[reference.id] === box, message.frameInfo.isMainFrame,
                  let envelope = message.body as? [String: Any], envelope["token"] as? String == token else { return }
            if let error = envelope["error"] as? String { report(error); return }
            guard let value = envelope["value"], (try? jsonData(value)) != nil else { report("WebView message must contain JSON"); return }
            host.emit(["type": "webMessage", "id": reference.id, "value": value])
        }
        private func rpcError(_ name: String, _ message: String) -> [String: Any] {
            ["ok": false, "error": ["name": name, "message": message]]
        }
        func cancelRequests(_ reason: String) {
            let calls = Array(pendingRPC.keys), replies = Array(pendingRPC.values)
            pendingRPC.removeAll()
            if !calls.isEmpty, !host.stopping { host.emit(["type": "webCancel", "id": reference.id, "epoch": rpcEpoch, "document": token, "calls": calls]) }
            for reply in replies { reply(rpcError("AbortError", reason), nil) }
        }
        func reply(_ call: Int, epoch: Int, document: String, result: [String: Any]) -> Bool {
            guard active, epoch == rpcEpoch, document == token, host.nodes[reference.id]?.props["rpcEpoch"] as? Int == epoch,
                  let reply = pendingRPC.removeValue(forKey: call) else { return false }
            reply(result, nil); return true
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            guard active, let box = reference.box, !host.stopping, host.nodes[reference.id] === box, message.frameInfo.isMainFrame,
                  let envelope = message.body as? [String: Any], envelope["token"] as? String == token,
                  box.props["rpcEpoch"] as? Int == rpcEpoch else { replyHandler(rpcError("AbortError", "WebView document is unavailable"), nil); return }
            guard let method = envelope["method"] as? String, let methods = box.props["methods"] as? [String], methods.contains(where: { Data($0.utf8) == Data(method.utf8) }),
                  let args = envelope["args"] as? [Any], (try? jsonData(args)) != nil else { replyHandler(rpcError("TypeError", "Unknown method or invalid JSON arguments"), nil); return }
            guard pendingRPC.count < 128 else { replyHandler(rpcError("RangeError", "Too many pending WebView requests"), nil); return }
            let call = nextRPC; nextRPC += 1; pendingRPC[call] = replyHandler
            host.emit(["type": "webRequest", "id": reference.id, "epoch": rpcEpoch, "document": token, "call": call, "method": method, "args": args])
        }
        func describe(_ error: Error) -> String {
            (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
        }
        func report(_ message: String) {
            guard active, let box = reference.box, !host.stopping, host.nodes[reference.id] === box else { return }
            host.emit(["type": "webError", "id": reference.id, "message": message])
        }
    }
}

private final class LauncherWindow: NSWindow {
    var offscreen = false
    // AppKit may try to promote a sheet's parent when dismissing it. Keep
    // automated windows keyboard-capable for responder tests without stealing
    // key/main status from the user's application.
    override func makeKey() { if !offscreen { super.makeKey() } }
    override func makeMain() { if !offscreen { super.makeMain() } }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        offscreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }
}

// The application owns dispatch before both launcher and SwiftUI-owned sheet
// windows. Keep opt-in routing here instead of replacing framework delegates.
@objc(JonUIApplication)
private final class JonUIApplication: NSApplication {
    func routeTraversalEvent(_ event: NSEvent) -> Bool {
        guard let window = event.window, let host = delegate as? Host else { return false }
        return host.handleTraversalKey(event, in: window)
    }
    override func sendEvent(_ event: NSEvent) {
        if routeTraversalEvent(event) { return }
        super.sendEvent(event)
    }
}

private final class Host: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private struct FocusReference { weak var view: NSView? }
    private var focusTargets: [Int: FocusReference] = [:]
    private var focusTraversal: [Int] = []
    private var focusTabNavigation = false
    private var interceptedTabs = 0
    private var nextFocusTarget = 1
    private var namedFocusNodes: [Data: Int] = [:]
    private weak var focusContextWindow: NSWindow?
    var cells: [Int: Cell] = [:]
    var nodes: [Int: ViewBox] = [:]
    var webViews: [Int: EmbeddedWebView.Coordinator] = [:]
    var hostedControls: [Int: HostedNativeControl.Coordinator] = [:]
    var root: ViewBox?
    var window: NSWindow?
    var stopping = false
    var disposed = false
    var exitStatus: Int32 = 0
    let testing = ProcessInfo.processInfo.environment["JONUI_TEST"] == "1"
    var layoutTesting: Bool { testing && ProcessInfo.processInfo.environment["JONUI_TEST_LAYOUT"] == "1" }
    var layoutFrames: [Int: CGRect] = [:]
    var offscreen: Bool { testing && ProcessInfo.processInfo.environment["JONUI_TEST_OFFSCREEN"] == "1" }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        requestStop(); return .terminateCancel
    }
    func windowWillClose(_ notification: Notification) { requestStop() }
    func window(_ window: NSWindow, willPositionSheet sheet: NSWindow, using rect: NSRect) -> NSRect {
        if offscreen { sheet.alphaValue = 0; sheet.animationBehavior = .none }
        return rect
    }
    @objc func quit() { requestStop() }
    func requestStop() {
        precondition(Thread.isMainThread)
        guard !stopping else { return }
        stopping = true
        emit(["type": "stop"])
    }
    func emit(_ event: [String: Any]) {
        precondition(Thread.isMainThread)
        do { _ = ju_runtime_emit(try encode(event)) }
        catch { ju_runtime_abort("Cannot encode native event: \(error)") }
    }
    func action(_ id: Int) {
        guard !stopping, nodes[id]?.kind == "button" else { return }
        emit(["type": "action", "id": id])
    }
    func textSubmit(_ id: Int, token: Int) {
        guard !stopping, let box = nodes[id], ["textfield", "securefield"].contains(box.kind),
              box.props["submit"] as? Int == token, let state = box.props["state"] as? Int, let cell = cells[state] else { return }
        emit(["type": "textSubmit", "id": id, "token": token, "state": cell.snapshot().merging(["id": state]) { _, new in new }])
    }
    func textEditing(_ id: Int, token: Int, editing: Bool) {
        guard !stopping, let box = nodes[id], ["textfield", "securefield", "texteditor"].contains(box.kind),
              box.props["editing"] as? Int == token, let state = box.props["state"] as? Int, let cell = cells[state] else { return }
        emit(["type": "textEditing", "id": id, "token": token, "editing": editing,
              "state": cell.snapshot().merging(["id": state]) { _, new in new }])
    }
    @discardableResult
    func write(_ cell: Cell, value: Any) -> [String: Any] {
        precondition(Thread.isMainThread)
        if (try? jsonData(cell.value)) != (try? jsonData(value)) {
            cell.value = value; cell.revision += 1
        }
        return cell.snapshot()
    }
    func nativeWrite(_ cell: Cell, value: Any) {
        guard !stopping, let id = cells.first(where: { $0.value === cell })?.key else { return }
        do { try validateWrite(id, value: value) }
        catch { ju_runtime_abort("Invalid native binding write: \(error)"); return }
        let snapshot = write(cell, value: value)
        emit(snapshot.merging(["type": "state", "id": id]) { _, new in new })
    }
    private func validateWrite(_ id: Int, value: Any) throws {
        for node in nodes.values where node.props["state"] as? Int == id {
            if let kind = bindingKind(node.kind, node.props) { try validateBindingValue(kind, value) }
        }
    }
    func dispose() {
        disposed = true
        retireFocusTargets(); focusContextWindow = nil; namedFocusNodes.removeAll()
        for coordinator in webViews.values { coordinator.invalidate() }
        for coordinator in hostedControls.values { coordinator.invalidate() }
        window?.contentView = nil
        root = nil; nodes.removeAll(); cells.removeAll(); webViews.removeAll(); hostedControls.removeAll(); layoutFrames.removeAll()
    }
    func stopped(_ status: Int32) {
        exitStatus = status; stopping = true; dispose()
        window?.delegate = nil; window?.close(); window = nil
        NSApp.stop(nil)
        // Wake AppKit if runtime completion arrived while it was waiting for events.
        if let event = NSEvent.otherEvent(with: .applicationDefined, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, subtype: 0, data1: 0, data2: 0) { NSApp.postEvent(event, atStart: true) }
    }
    func open(_ options: [String: Any]) {
        guard window == nil, let root else { return }
        let size = NSSize(width: options["width"] as? Double ?? 900, height: options["height"] as? Double ?? 600)
        let window = LauncherWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.offscreen = offscreen
        if offscreen {
            window.alphaValue = 0
            window.animationBehavior = .none
            window.setFrameOrigin(NSPoint(x: -10000, y: -10000))
        }
        window.title = options["title"] as? String ?? "JonUI"
        window.isReleasedWhenClosed = false; window.delegate = self
        let content = NSHostingView(rootView: NativeView(box: root, host: self).onPreferenceChange(LayoutFrames.self) { [weak self] frames in self?.layoutFrames = frames })
        // AppOptions owns the initial window size. A transient intrinsic root
        // (such as a hidden-state label) must not impose a new window maximum.
        content.sizingOptions = []
        content.autoresizingMask = [.width, .height]
        window.contentView = content
        if offscreen {
            window.orderFront(nil)
        } else { window.center(); window.makeKeyAndOrderFront(nil) }
        self.window = window
        if !offscreen { NSApp.activate(ignoringOtherApps: true) }
    }
    private func scrollViews() -> [NSScrollView] {
        var result: [NSScrollView] = []
        func visit(_ view: NSView) {
            if let scroll = view as? NSScrollView { result.append(scroll) }
            for child in view.subviews { visit(child) }
        }
        if let content = window?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func rectangle(_ value: CGRect) -> [String: CGFloat] {
        ["x": value.origin.x, "y": value.origin.y, "width": value.width, "height": value.height]
    }
    private func numericControls() -> [NSControl] {
        var result: [NSControl] = []
        func visit(_ view: NSView) {
            if let control = view as? NSControl, control is NSSlider || control is NSStepper { result.append(control) }
            for child in view.subviews { visit(child) }
        }
        if let content = window?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func textControls(in selectedWindow: NSWindow? = nil) -> [NSTextField] {
        var result: [NSTextField] = []
        func visit(_ view: NSView) {
            if let field = view as? NSTextField, field.isEditable { result.append(field) }
            for child in view.subviews { visit(child) }
        }
        if let content = (selectedWindow ?? currentFocusWindow())?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func textEditors() -> [NSTextView] {
        var result: [NSTextView] = []
        func visit(_ view: NSView) {
            if let editor = view as? NSTextView, editor.isEditable, !editor.isFieldEditor { result.append(editor) }
            for child in view.subviews { visit(child) }
        }
        if let content = currentFocusWindow()?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func dateControls() -> [NSDatePicker] {
        var result: [NSDatePicker] = []
        func visit(_ view: NSView) {
            if let picker = view as? NSDatePicker { result.append(picker) }
            for child in view.subviews { visit(child) }
        }
        if let content = currentFocusWindow()?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func pickerControls() -> [NSControl] {
        var result: [NSControl] = []
        func visit(_ view: NSView) {
            if let control = view as? NSControl, control is NSPopUpButton || control is NSSegmentedControl { result.append(control) }
            for child in view.subviews { visit(child) }
        }
        if let content = window?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func focusControls() -> [NSControl] {
        var result: [NSControl] = []
        func visit(_ view: NSView) {
            if let control = view as? NSControl, !(control is NSTextField) { result.append(control) }
            for child in view.subviews { visit(child) }
        }
        if let content = currentFocusWindow()?.contentView { content.layoutSubtreeIfNeeded(); visit(content) }
        return result
    }
    private func currentFocusWindow() -> NSWindow? {
        guard var current = window else { return nil }
        while let sheet = current.attachedSheet { current = sheet }
        return current
    }
    private func prepareFocusWindow() throws -> NSWindow {
        guard let window = currentFocusWindow(), !stopping else { throw BridgeError("Focus requires a mounted window") }
        if focusContextWindow !== window {
            retireFocusTargets(); focusContextWindow = window
        }
        window.contentView?.layoutSubtreeIfNeeded(); window.recalculateKeyViewLoop()
        return window
    }
    private func focusView(_ responder: NSResponder?) -> NSView? {
        if let editor = responder as? NSTextView, editor.isFieldEditor { return editor.delegate as? NSView }
        return responder as? NSView
    }
    fileprivate func eligibleFocusView(_ view: NSView, in window: NSWindow) -> Bool {
        guard let content = window.contentView else { return false }
        // A captured WebKit responder can be an internal descendant rather than
        // WKWebView itself. Its own key-view flags do not inherit our gate.
        var ancestor: NSView? = view
        while let current = ancestor {
            if let web = current as? ControlWebView, !web.interactionEnabled || !web.tabFocusable { return false }
            ancestor = current.superview
        }
        return view !== content && view.window === window && view.isDescendant(of: content) &&
            !view.isHiddenOrHasHiddenAncestor && view.canBecomeKeyView && view.acceptsFirstResponder
    }
    private func pruneFocusTargets() {
        focusTargets = focusTargets.filter { $0.value.view != nil }
        if focusTraversal.contains(where: { focusTargets[$0] == nil }) { clearFocusTraversal() }
    }
    private func clearFocusTraversal() {
        focusTraversal.removeAll(); focusTabNavigation = false
    }
    private func retireFocusTargets() {
        focusTargets.removeAll(); clearFocusTraversal()
    }
    private func traversalViews(in window: NSWindow) -> [NSView]? {
        pruneFocusTargets()
        guard !focusTraversal.isEmpty else { return nil }
        let views = focusTraversal.compactMap { focusTargets[$0]?.view }
        guard views.count == focusTraversal.count && views.allSatisfy({ eligibleFocusView($0, in: window) }) else {
            clearFocusTraversal(); return nil
        }
        return views
    }
    private func traversalTarget(_ views: [NSView], current: NSView?, backwards: Bool) -> NSView {
        let index = views.firstIndex(where: { $0 === current })
        let next = backwards ? index.map { ($0 + views.count - 1) % views.count } ?? (views.count - 1)
            : index.map { ($0 + 1) % views.count } ?? 0
        return views[next]
    }
    private func directionalView(_ view: NSView) -> NSView {
        // A DOM responder's rectangle belongs to the browser document, while
        // directional native navigation treats the browser as one control.
        var ancestor: NSView? = view
        while let current = ancestor {
            if current is ControlWebView { return current }
            ancestor = current.superview
        }
        return view
    }
    private func moveDirectional(_ direction: String, in window: NSWindow) -> Bool {
        guard let content = window.contentView, let focused = focusView(window.firstResponder) else { return false }
        let source = directionalView(focused)
        func rect(_ view: NSView) -> CGRect? {
            guard eligibleFocusView(view, in: window) else { return nil }
            // Non-clipping AppKit views can report a visibleRect larger than
            // their own bounds. Rank the visible part of this control only.
            let rect = view.convert(view.bounds.intersection(view.visibleRect), to: content)
            guard !rect.isEmpty, [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy({ $0.isFinite }) else { return nil }
            return rect
        }
        guard let origin = rect(source) else { return false }
        let candidates: [NSView]
        if let configured = traversalViews(in: window) { candidates = configured }
        else {
            var views: [NSView] = [], visited: Set<ObjectIdentifier> = [ObjectIdentifier(source)]
            var current = source.nextValidKeyView
            while let view = current, visited.insert(ObjectIdentifier(view)).inserted {
                views.append(view); current = view.nextValidKeyView
            }
            candidates = views
        }
        var seen = Set<ObjectIdentifier>()
        let views = candidates.map(directionalView).filter { seen.insert(ObjectIdentifier($0)).inserted && rect($0) != nil }
        let horizontal = direction == "left" || direction == "right"
        let forward: CGFloat = horizontal ? (direction == "right" ? 1 : -1)
            : ((direction == "down") == content.isFlipped ? 1 : -1)
        var best: NSView?, bestScore: [CGFloat]?
        for (index, view) in views.enumerated() {
            guard view !== source, !source.isDescendant(of: view), let target = rect(view) else { continue }
            // Prefer a leaf key view when both it and its platform container
            // participate in the native loop.
            if views.contains(where: { $0 !== view && $0.isDescendant(of: view) }) { continue }
            let delta = horizontal ? target.midX - origin.midX : target.midY - origin.midY
            guard delta * forward > 0 else { continue }
            let overlap = horizontal ? min(target.maxY, origin.maxY) - max(target.minY, origin.minY)
                : min(target.maxX, origin.maxX) - max(target.minX, origin.minX)
            let aligned = overlap > 0
            let perpendicular = horizontal ? target.midY - origin.midY : target.midX - origin.midX
            if !aligned && abs(delta) < abs(perpendicular) { continue }
            let gap = horizontal ? (forward > 0 ? target.minX - origin.maxX : origin.minX - target.maxX)
                : (forward > 0 ? target.minY - origin.maxY : origin.minY - target.maxY)
            let dx = target.midX - origin.midX, dy = target.midY - origin.midY, distance = dx * dx + dy * dy
            let score: [CGFloat] = [aligned ? 0 : 1, aligned ? max(0, gap) : distance, distance, CGFloat(index)]
            if bestScore == nil || score.lexicographicallyPrecedes(bestScore!) { best = view; bestScore = score }
        }
        guard let best, window.makeFirstResponder(best), let current = focusView(window.firstResponder) else { return false }
        return current === best || current.isDescendant(of: best)
    }
    func handleTraversalKey(_ event: NSEvent, in window: NSWindow) -> Bool {
        guard !stopping, window === currentFocusWindow(), focusTabNavigation,
              event.type == .keyDown, event.keyCode == 48,
              event.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return false }
        // Let the input method handle completion/candidate selection while a
        // responder owns marked text, rather than stealing its Tab keystroke.
        if let input = window.firstResponder as? NSTextInputClient, input.hasMarkedText() { return false }
        guard (try? prepareFocusWindow()) != nil, let views = traversalViews(in: window) else { return false }
        let current = focusView(window.firstResponder) ?? window.firstResponder as? NSView
        let target = traversalTarget(views, current: current, backwards: event.modifierFlags.contains(.shift))
        if current !== target { _ = window.makeFirstResponder(target) }
        // A responder refusing to resign keeps focus, like native validation;
        // do not retry the same key through another traversal path.
        if testing { interceptedTabs += 1 }
        return true
    }
    func handle(_ message: [String: Any]) throws -> Any {
        precondition(Thread.isMainThread)
        guard let op = message["op"] as? String else { throw BridgeError("Missing operation") }
        if (disposed || stopping) && ["web.reply", "web.claim"].contains(op) { return ["accepted": false] }
        if disposed && !["dispose", "debug.snapshot"].contains(op) { throw BridgeError("Native host is stopping") }
        switch op {
        case "focus.direction":
            guard let direction = message["direction"] as? String, ["left", "right", "up", "down"].contains(direction) else { throw BridgeError("Invalid focus direction") }
            let window = try prepareFocusWindow()
            return ["moved": moveDirectional(direction, in: window)]
        case "focus.traversal":
            let window = try prepareFocusWindow(); pruneFocusTargets()
            if let raw = message["tabNavigation"] {
                guard CFGetTypeID(raw as CFTypeRef) == CFBooleanGetTypeID() else { throw BridgeError("Invalid focus tabNavigation flag") }
            }
            guard let values = message["targets"] as? [Any] else { throw BridgeError("Invalid focus traversal targets") }
            var ids: [Int] = [], seen = Set<Int>()
            for raw in values {
                guard let number = layoutNumber(raw), number > 0, number.rounded() == number, number < Double(Int.max) else { throw BridgeError("Invalid focus traversal target handle") }
                let id = Int(number)
                guard seen.insert(id).inserted else { throw BridgeError("Focus traversal targets must be distinct") }
                ids.append(id)
            }
            guard ids.allSatisfy({ id in focusTargets[id]?.view.map { eligibleFocusView($0, in: window) } ?? false }) else { return ["configured": false] }
            focusTraversal = ids; focusTabNavigation = !ids.isEmpty && (message["tabNavigation"] as? Bool ?? false)
            return ["configured": true]
        case "focus.capture":
            let window = try prepareFocusWindow(); pruneFocusTargets()
            guard let view = focusView(window.firstResponder), eligibleFocusView(view, in: window) else { return ["target": NSNull()] }
            if let old = focusTargets.first(where: { $0.value.view === view }) { return ["target": old.key] }
            let id = nextFocusTarget; nextFocusTarget += 1
            focusTargets[id] = FocusReference(view: view); return ["target": id]
        case "focus.target":
            let window = try prepareFocusWindow(); pruneFocusTargets()
            guard let raw = message["target"], let number = layoutNumber(raw), number > 0, number.rounded() == number, number < Double(Int.max) else { throw BridgeError("Invalid focus target handle") }
            guard let view = focusTargets[Int(number)]?.view, eligibleFocusView(view, in: window) else { return ["focused": false] }
            if focusView(window.firstResponder) === view { return ["focused": true] }
            return ["focused": window.makeFirstResponder(view)]
        case "focus.named":
            let window = try prepareFocusWindow()
            guard let name = message["name"] as? String, !name.isEmpty else { throw BridgeError("Focus name must be a nonempty string") }
            guard let id = namedFocusNodes[Data(name.utf8)] else { return ["focused": false] }
            let target: NSView?
            if nodes[id]?.kind == "webview", let coordinator = webViews[id], coordinator.active { target = coordinator.view }
            else { target = hostedControls[id]?.target(in: window) }
            guard let view = target, eligibleFocusView(view, in: window) else { return ["focused": false] }
            func focused() -> Bool {
                guard let current = focusView(window.firstResponder) ?? window.firstResponder as? NSView else { return false }
                return current === view || current.isDescendant(of: view)
            }
            if focused() { return ["focused": true] }
            let accepted = window.makeFirstResponder(view)
            return ["focused": accepted && focused()]
        case "focus.move":
            guard let direction = message["direction"] as? String, ["next", "previous", "clear"].contains(direction) else { throw BridgeError("Invalid focus direction") }
            let window = try prepareFocusWindow()
            let current = focusView(window.firstResponder) ?? window.firstResponder as? NSView
            if direction != "clear", let views = traversalViews(in: window) {
                let target = traversalTarget(views, current: current, backwards: direction == "previous")
                if target !== current, !window.makeFirstResponder(target) { throw BridgeError("Native responder refused focus traversal") }
                return [:]
            }
            switch direction {
            case "next":
                if let current { window.selectKeyView(following: current) } else { window.selectNextKeyView(nil) }
            case "previous":
                if let current { window.selectKeyView(preceding: current) } else { window.selectPreviousKeyView(nil) }
            default:
                guard window.makeFirstResponder(nil) else { throw BridgeError("Native responder refused to clear focus") }
            }
            return [:]
        case "state.create":
            let id = try integer(message["id"])
            guard cells[id] == nil, let value = message["value"] else { throw BridgeError("Invalid state creation") }
            let cell = Cell(value); cells[id] = cell; return cell.snapshot()
        case "state.write":
            let id = try integer(message["id"])
            guard let cell = cells[id], let value = message["value"] else { throw BridgeError("Unknown state handle") }
            try validateWrite(id, value: value)
            return write(cell, value: value)
        case "state.release":
            guard let ids = message["ids"] as? [Int], ids.allSatisfy({ $0 > 0 && cells[$0] != nil }) else { throw BridgeError("Invalid state release") }
            let released = Set(ids)
            guard !nodes.values.contains(where: { node in (node.props["state"] as? Int).map(released.contains) ?? false }) else {
                throw BridgeError("Cannot release state while a native binding is mounted")
            }
            for id in released { cells.removeValue(forKey: id) }
            return [:]
        case "commit":
            guard let values = message["nodes"] as? [[String: Any]] else { throw BridgeError("Missing view transaction") }
            let kinds: Set<String> = ["text", "image", "spacer", "divider", "vstack", "hstack", "lazyvstack", "lazyhstack", "lazyvgrid", "lazyhgrid", "scroll", "form", "section", "slider", "stepper", "picker", "datepicker", "button", "toggle", "textfield", "securefield", "texteditor", "webview", "split", "list", "foreach", "dynamic", "modifier"]
            // Validate the complete transaction before changing the committed tree.
            var descriptions: [Int: [String: Any]] = [:]
            for value in values {
                let id = try integer(value["id"])
                guard let kind = value["kind"] as? String, kinds.contains(kind), value["props"] is [String: Any], value["children"] is [Int], descriptions[id] == nil else { throw BridgeError("Invalid view descriptor") }
                if let existing = nodes[id], existing.kind != kind { throw BridgeError("Cannot change a native handle's kind") }
                descriptions[id] = value
            }
            let rootID = try message["root"].map(integer) ?? root?.id
            guard let rootID else { throw BridgeError("No root view") }
            var reachable = Set<Int>(), visiting = Set<Int>()
            var boundTypes: [Int: Set<String>] = [:], pickerValues: [(Int, Any)] = []
            var numericRanges: [(Int, Double, Double)] = []
            var focusNames: [Data: Int] = [:]
            func visit(_ id: Int) throws {
                if visiting.contains(id) { throw BridgeError("Cyclic view graph") }
                if reachable.contains(id) { return }
                visiting.insert(id)
                guard descriptions[id] != nil || nodes[id] != nil else { throw BridgeError("Unknown child view handle") }
                let value = descriptions[id]
                let props = value?["props"] as? [String: Any] ?? nodes[id]!.props
                let kind = value?["kind"] as? String ?? nodes[id]!.kind
                let children = value?["children"] as? [Int] ?? nodes[id]!.children.map(\.id)
                let modifier = props["name"] as? String ?? ""
                let modifiers: Set<String> = ["font", "foregroundStyle", "padding", "frame", "fixedSize", "layoutPriority", "navigationTitle", "accessibilityIdentifier", "disabled", "focusSection", "tag", "sheet"]
                if kind == "modifier" && !modifiers.contains(modifier) { throw BridgeError("Unknown view modifier") }
                try validateLayout(kind, props)
                try validateInput(kind, props)
                if ["textfield", "securefield", "texteditor", "datepicker", "webview"].contains(kind), let raw = props["focusName"] {
                    guard let name = raw as? String, !name.isEmpty else { throw BridgeError("Focus name must be a nonempty string") }
                    guard focusNames.updateValue(id, forKey: Data(name.utf8)) == nil else { throw BridgeError("Duplicate focus name") }
                }
                if kind == "webview" {
                    guard props["html"] is String, let data = props["data"], (try? jsonData(data)) != nil else { throw BridgeError("Invalid WebView content or data") }
                    guard let flag = props["tabFocusable"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { throw BridgeError("Invalid WebView tabFocusable flag") }
                    guard let epoch = props["rpcEpoch"].flatMap(layoutNumber), epoch > 0, epoch < Double(Int.max), epoch.rounded() == epoch,
                          let methods = props["methods"] as? [String], Set(methods.map { Data($0.utf8) }).count == methods.count,
                          methods.allSatisfy({ !$0.isEmpty && !["then", "__proto__", "prototype", "constructor", "toJSON"].contains($0) }) else { throw BridgeError("Invalid WebView API descriptor") }
                }
                let count: Int? = kind == "split" || (kind == "modifier" && modifier == "sheet") ? 2
                    : ["list", "dynamic", "modifier", "scroll"].contains(kind) ? 1
                    : ["vstack", "hstack", "lazyvstack", "lazyhstack", "lazyvgrid", "lazyhgrid", "foreach", "form", "section"].contains(kind) ? nil : 0
                if let count, children.count != count { throw BridgeError("Invalid child count for \(kind)") }
                if let expected = bindingKind(kind, props) {
                    guard let state = props["state"] as? Int, let cell = cells[state] else { throw BridgeError("Unknown binding handle") }
                    try validateBindingValue(expected, cell.value)
                    boundTypes[state, default: []].insert(expected)
                    if kind == "picker" { pickerValues.append(contentsOf: pickerItems(props).map { (state, $0.value) }) }
                    if kind == "slider" || kind == "stepper" { numericRanges.append((state, props["min"].flatMap(layoutNumber) ?? 0, props["max"].flatMap(layoutNumber) ?? (kind == "slider" ? 1 : 100))) }
                }
                for child in children { try visit(child) }
                visiting.remove(id); reachable.insert(id)
            }
            try visit(rootID)
            // A choice must also be valid for other controls sharing its cell;
            // otherwise a valid-looking menu could fail only after selection.
            for (state, value) in pickerValues {
                for kind in boundTypes[state] ?? [] { try validateBindingValue(kind, value) }
            }
            for (state, lower, upper) in numericRanges where boundTypes[state]?.contains("datepicker") == true {
                guard dateTimestamp(lower) != nil, dateTimestamp(upper) != nil else { throw BridgeError("Shared numeric range exceeds supported date timestamps") }
            }
            // A physical responder cannot yet be mapped back to one logical
            // box. Retire all captures on structural edits to reject adapters
            // that SwiftUI may keep cached after their logical owner is gone.
            if Set(nodes.keys) != reachable { retireFocusTargets() }
            pruneFocusTargets()
            for (id, value) in descriptions where reachable.contains(id) {
                if nodes[id] == nil { nodes[id] = ViewBox(id: id, kind: value["kind"] as! String) }
            }
            for (id, value) in descriptions where reachable.contains(id) {
                let box = nodes[id]!, props = value["props"] as! [String: Any], children = value["children"] as! [Int]
                if (try? jsonData(box.props)) != (try? jsonData(props)) { box.props = props }
                if box.children.map(\.id) != children { box.children = children.map { nodes[$0]! } }
            }
            root = nodes[rootID]
            for (id, coordinator) in webViews where !reachable.contains(id) {
                coordinator.invalidate(); webViews.removeValue(forKey: id)
            }
            for (id, coordinator) in hostedControls where !reachable.contains(id) {
                coordinator.invalidate(); hostedControls.removeValue(forKey: id)
            }
            nodes = nodes.filter { reachable.contains($0.key) }
            namedFocusNodes = focusNames
            if let options = message["window"] as? [String: Any] { open(options) }
            return [:]
        case "dispose": stopping = true; dispose(); return [:]
        case "debug.snapshot" where testing:
            return ["nodes": nodes.values.sorted { $0.id < $1.id }.map { ["id": $0.id, "kind": $0.kind, "props": $0.props, "children": $0.children.map(\.id)] as [String: Any] },
                    "states": cells.map { ["id": $0.key].merging($0.value.snapshot()) { _, new in new } }, "liveViews": ViewBox.live, "liveCells": Cell.live, "webViewCount": webViews.count, "textInputCount": hostedControls.filter { ["textfield", "securefield", "texteditor"].contains(nodes[$0.key]?.kind ?? "") }.count, "hostedControlCount": hostedControls.count, "applicationEventRouting": NSApp is JonUIApplication, "mainThread": Thread.isMainThread, "windowVisible": window?.isVisible ?? false, "sheetPresented": window?.attachedSheet != nil]
        case "debug.controls" where testing:
            return ["controls": numericControls().enumerated().map { index, control in
                ["index": index, "kind": control is NSSlider ? "slider" : "stepper", "value": control.doubleValue] as [String: Any]
            }]
        case "debug.dates" where testing:
            return ["dates": dateControls().enumerated().map { index, picker in
                var calendar = picker.calendar ?? Calendar(identifier: .gregorian)
                calendar.timeZone = picker.timeZone ?? calendar.timeZone
                let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: picker.dateValue)
                return ["index": index, "value": (picker.dateValue.timeIntervalSince1970 * 1000).rounded(), "timeZone": calendar.timeZone.identifier,
                    "year": parts.year ?? 0, "month": parts.month ?? 0, "day": parts.day ?? 0, "hour": parts.hour ?? 0, "minute": parts.minute ?? 0,
                    "elements": picker.datePickerElements.rawValue, "style": picker.datePickerStyle.rawValue] as [String: Any]
            }]
        case "debug.date" where testing:
            let controls = dateControls()
            guard let index = message["index"] as? Int, controls.indices.contains(index), let value = message["value"].flatMap(dateTimestamp) else { throw BridgeError("Invalid test date control") }
            let picker = controls[index]
            picker.dateValue = Date(timeIntervalSince1970: value / 1000)
            guard picker.sendAction(picker.action, to: picker.target) else { throw BridgeError("Native date control has no action") }
            return [:]
        case "debug.dateBinding" where testing:
            let id = try integer(message["id"])
            guard let box = nodes[id], box.kind == "datepicker" else { throw BridgeError("Unknown date input") }
            let binding = NativeView(box: box, host: self).dateBinding()
            if let raw = message["value"] {
                guard let value = dateTimestamp(raw) else { throw BridgeError("Invalid test date value") }
                binding.wrappedValue = Date(timeIntervalSince1970: value / 1000)
            }
            return ["value": (binding.wrappedValue.timeIntervalSince1970 * 1000).rounded()]
        case "debug.fields" where testing:
            return ["fields": textControls().enumerated().map { index, field in
                ["index": index, "secure": field is NSSecureTextField, "enabled": field.isEnabled, "hasAction": field.action != nil] as [String: Any]
            }]
        case "debug.editors" where testing:
            return ["count": textEditors().count]
        case "debug.editor" where testing:
            let editors = textEditors()
            guard let index = message["index"] as? Int, editors.indices.contains(index) else { throw BridgeError("Invalid test text editor") }
            let editor = editors[index]
            if let value = message["value"] as? String { editor.string = value; editor.didChangeText() }
            if message["newline"] as? Bool == true {
                editor.setSelectedRange(NSRange(location: (editor.string as NSString).length, length: 0))
                editor.insertNewline(nil)
            }
            return [:]
        case "debug.focus" where testing:
            var target: NSResponder?
            if let index = message["field"] as? Int {
                let fields = textControls()
                guard fields.indices.contains(index) else { throw BridgeError("Invalid test text field") }
                target = fields[index]
            } else if let index = message["editor"] as? Int {
                let editors = textEditors()
                guard editors.indices.contains(index) else { throw BridgeError("Invalid test text editor") }
                target = editors[index]
            } else if let index = message["control"] as? Int {
                let controls = focusControls()
                guard controls.indices.contains(index) else { throw BridgeError("Invalid test focus control") }
                target = controls[index]
            } else if let id = message["web"] as? Int {
                guard let coordinator = webViews[id], coordinator.active, let view = coordinator.view else { throw BridgeError("Unknown test WebView") }
                target = view
            }
            return ["accepted": currentFocusWindow()?.makeFirstResponder(target) ?? false]
        case "debug.focusControls" where testing:
            guard let window = currentFocusWindow() else { throw BridgeError("No test window") }
            return ["fullKeyboardAccess": NSApp.isFullKeyboardAccessEnabled, "controls": focusControls().enumerated().map { index, control in
                let kind = control is NSDatePicker ? "date" : control is NSSegmentedControl ? "segmented" : control is NSPopUpButton ? "menu"
                    : control is NSStepper ? "stepper" : control is NSSlider ? "slider" : control is NSButton ? "button" : "other"
                return ["index": index, "kind": kind, "title": (control as? NSButton)?.title ?? "", "enabled": control.isEnabled,
                    "hidden": control.isHidden, "eligible": eligibleFocusView(control, in: window), "focused": focusView(window.firstResponder) === control] as [String: Any]
            }]
        case "debug.focusControlAvailability" where testing:
            let controls = focusControls()
            guard let index = message["index"] as? Int, controls.indices.contains(index) else { throw BridgeError("Invalid test focus control") }
            if let enabled = message["enabled"] as? Bool { controls[index].isEnabled = enabled }
            if let hidden = message["hidden"] as? Bool { controls[index].isHidden = hidden }
            return [:]
        case "debug.focusStatus" where testing:
            let window = currentFocusWindow()
            let fields = textControls().enumerated().compactMap { index, field -> Int? in
                guard let editor = field.currentEditor(), window?.firstResponder === editor else { return nil }
                return index
            }
            let editors = textEditors().enumerated().compactMap { index, editor -> Int? in window?.firstResponder === editor ? index : nil }
            return ["fields": fields, "editors": editors, "key": window?.isKeyWindow ?? false]
        case "debug.focusContext" where testing:
            let current = currentFocusWindow()
            let mainFields = textControls(in: window).enumerated().compactMap { index, field -> Int? in
                guard let editor = field.currentEditor(), window?.firstResponder === editor else { return nil }; return index
            }
            return ["sheet": current != nil && current !== window, "mainKey": window?.isKeyWindow ?? false,
                "activeKey": current?.isKeyWindow ?? false, "mainFields": mainFields, "active": NSApp.isActive,
                "animationsSuppressed": current?.animationBehavior == NSWindow.AnimationBehavior.none,
                "alpha": current?.alphaValue ?? 0]
        case "debug.focusHandles" where testing:
            return ["targets": focusTargets.count, "live": focusTargets.values.filter { $0.view != nil }.count]
        case "debug.focusNames" where testing:
            return ["count": namedFocusNodes.count]
        case "debug.focusTraversal" where testing:
            return ["count": focusTraversal.count, "tabNavigation": focusTabNavigation]
        case "debug.tab" where testing:
            guard let window = currentFocusWindow() else { throw BridgeError("No test window") }
            var flags: NSEvent.ModifierFlags = []
            let options: [String: NSEvent.ModifierFlags] = ["shift": .shift, "command": .command, "control": .control, "option": .option]
            for name in message["modifiers"] as? [String] ?? [] {
                guard let flag = options[name] else { throw BridgeError("Invalid test key modifier") }; flags.insert(flag)
            }
            let type: NSEvent.EventType = message["keyUp"] as? Bool == true ? .keyUp : .keyDown
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: flags.contains(.shift) ? "\u{19}" : "\t", charactersIgnoringModifiers: flags.contains(.shift) ? "\u{19}" : "\t", isARepeat: false, keyCode: 48) else { throw BridgeError("Cannot construct test Tab") }
            guard let app = NSApp as? JonUIApplication else { throw BridgeError("No application event router") }
            let before = interceptedTabs
            if message["applicationDispatch"] as? Bool == true { app.sendEvent(event) }
            else if !app.routeTraversalEvent(event) {
                // A non-key offscreen window cannot rely on NSApplication's
                // ordinary key-window dispatch. Keep native fallback local.
                window.sendEvent(event)
            }
            return ["intercepted": interceptedTabs != before]
        case "debug.markedText" where testing:
            guard let editor = currentFocusWindow()?.firstResponder as? NSTextView else { throw BridgeError("No focused text editor") }
            if let value = message["value"] as? String {
                editor.setMarkedText(value, selectedRange: NSRange(location: (value as NSString).length, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
            } else { editor.unmarkText() }
            return ["marked": editor.hasMarkedText()]
        case "debug.editing" where testing:
            let id = try integer(message["id"])
            guard let box = nodes[id], ["textfield", "securefield", "texteditor"].contains(box.kind), let editing = message["editing"] as? Bool else { throw BridgeError("Unknown text editing input") }
            if let token = message["token"] as? Int ?? box.props["editing"] as? Int { textEditing(id, token: token, editing: editing) }
            return [:]
        case "debug.field" where testing:
            let fields = textControls()
            guard let index = message["index"] as? Int, fields.indices.contains(index) else { throw BridgeError("Invalid test text field") }
            let field = fields[index]
            if let enabled = message["enabled"] as? Bool { field.isEnabled = enabled }
            if let value = message["value"] as? String {
                field.stringValue = value
                field.delegate?.controlTextDidChange?(Notification(name: NSControl.textDidChangeNotification, object: field))
            }
            if message["submit"] as? Bool == true {
                guard field.sendAction(field.action, to: field.target) else { throw BridgeError("Native text field has no action") }
            }
            return [:]
        case "debug.submit" where testing:
            let id = try integer(message["id"])
            guard let box = nodes[id], ["textfield", "securefield"].contains(box.kind) else { throw BridgeError("Unknown text input") }
            if let token = message["token"] as? Int ?? box.props["submit"] as? Int { textSubmit(id, token: token) }
            return [:]
        case "debug.pickers" where testing:
            return ["pickers": pickerControls().enumerated().map { index, control in
                if let menu = control as? NSPopUpButton {
                    return ["index": index, "style": "menu", "items": menu.itemTitles, "selected": menu.indexOfSelectedItem, "enabled": menu.isEnabled] as [String: Any]
                }
                let segments = control as! NSSegmentedControl
                return ["index": index, "style": "segmented", "items": (0..<segments.segmentCount).map { segments.label(forSegment: $0) ?? "" }, "selected": segments.selectedSegment, "enabled": segments.isEnabled] as [String: Any]
            }]
        case "debug.picker" where testing:
            let controls = pickerControls()
            guard let index = message["index"] as? Int, controls.indices.contains(index), let item = message["item"] as? Int else { throw BridgeError("Invalid test picker") }
            let control = controls[index]
            if let menu = control as? NSPopUpButton {
                guard menu.itemArray.indices.contains(item) else { throw BridgeError("Invalid picker item") }
                guard control.isEnabled, menu.item(at: item)?.isEnabled == true else { return ["handled": false] }
                menu.selectItem(at: item)
            } else if let segments = control as? NSSegmentedControl {
                guard item >= 0, item < segments.segmentCount else { throw BridgeError("Invalid picker item") }
                guard control.isEnabled, segments.isEnabled(forSegment: item) else { return ["handled": false] }
                segments.selectedSegment = item
            }
            return ["handled": control.sendAction(control.action, to: control.target)]
        case "debug.pickerBinding" where testing:
            let id = try integer(message["id"])
            guard let box = nodes[id], box.kind == "picker" else { throw BridgeError("Unknown picker") }
            let binding = NativeView(box: box, host: self).pickerBinding()
            if let value = message["value"] { try validateBindingValue("picker", value); if let key = pickerKey(value) { binding.wrappedValue = key } }
            return ["matched": binding.wrappedValue != pickerPlaceholder]
        case "debug.control" where testing:
            let controls = numericControls()
            guard let index = message["index"] as? Int, controls.indices.contains(index), let value = message["value"].flatMap(layoutNumber) else { throw BridgeError("Invalid test control") }
            let control = controls[index]
            control.doubleValue = value
            guard control.sendAction(control.action, to: control.target) else { throw BridgeError("Native control has no action") }
            return [:]
        case "debug.input" where testing:
            let id = try integer(message["id"])
            guard let box = nodes[id], ["slider", "stepper"].contains(box.kind) else { throw BridgeError("Unknown numeric input") }
            let binding = NativeView(box: box, host: self).numberBinding()
            if let raw = message["value"] {
                guard let value = layoutNumber(raw) else { throw BridgeError("Invalid test input value") }
                binding.wrappedValue = value
            }
            return ["value": binding.wrappedValue]
        case "debug.layout" where layoutTesting:
            let scrolls = scrollViews().enumerated().map { index, scroll in
                ["index": index, "viewport": rectangle(scroll.contentView.bounds), "document": rectangle(scroll.documentView?.bounds ?? .zero), "horizontal": scroll.hasHorizontalScroller, "vertical": scroll.hasVerticalScroller] as [String: Any]
            }
            return ["frames": layoutFrames.filter { nodes[$0.key] != nil }.map { ["id": $0.key, "rect": rectangle($0.value)] as [String: Any] }, "scrolls": scrolls, "content": rectangle(window?.contentView?.bounds ?? .zero)]
        case "debug.scroll" where layoutTesting:
            let scrolls = scrollViews()
            guard let index = message["index"] as? Int, scrolls.indices.contains(index),
                  let x = message["x"].flatMap(layoutNumber), let y = message["y"].flatMap(layoutNumber) else { throw BridgeError("Invalid test scroll") }
            let scroll = scrolls[index], clip = scroll.contentView
            let document = scroll.documentView?.bounds ?? .zero
            clip.scroll(to: NSPoint(x: max(0, min(x, document.width - clip.bounds.width)), y: max(0, min(y, document.height - clip.bounds.height))))
            scroll.reflectScrolledClipView(clip)
            // A programmatic clip mutation in a transparent, inactive window
            // need not schedule a display pass. Drive the enclosing SwiftUI
            // layout just as a delivered scroll event would before inspecting
            // which lazy descendants have actually been realized.
            window?.contentView?.needsLayout = true
            window?.contentView?.layoutSubtreeIfNeeded()
            return [:]
        case "web.claim":
            let id = try integer(message["id"]), call = try integer(message["call"]), epoch = try integer(message["epoch"])
            guard let document = message["document"] as? String else { throw BridgeError("Missing RPC document") }
            guard let coordinator = webViews[id], coordinator.active, coordinator.rpcEpoch == epoch, coordinator.token == document,
                  coordinator.pendingRPC[call] != nil, nodes[id]?.props["rpcEpoch"] as? Int == epoch else { return ["accepted": false] }
            return ["accepted": true]
        case "web.reply":
            let id = try integer(message["id"]), call = try integer(message["call"]), epoch = try integer(message["epoch"])
            guard let document = message["document"] as? String else { throw BridgeError("Missing RPC document") }
            guard let result = message["result"] as? [String: Any], let ok = result["ok"] as? NSNumber,
                  CFGetTypeID(ok) == CFBooleanGetTypeID(), (try? jsonData(result)) != nil else { throw BridgeError("Invalid WebView RPC reply") }
            if !ok.boolValue { guard let error = result["error"] as? [String: Any], error["name"] is String, error["message"] is String else { throw BridgeError("Invalid WebView RPC error") } }
            return ["accepted": webViews[id]?.reply(call, epoch: epoch, document: document, result: result) ?? false]
        case "debug.web" where testing:
            let id = try integer(message["id"])
            guard let coordinator = webViews[id] else { throw BridgeError("Unknown WebView") }
            return ["ready": coordinator.ready, "loads": coordinator.loads, "token": coordinator.token, "pending": coordinator.pendingRPC.count, "epoch": coordinator.rpcEpoch]
        case "debug.webFocus" where testing:
            let id = try integer(message["id"])
            guard let coordinator = webViews[id], coordinator.active, let view = coordinator.view, let window = currentFocusWindow() else { throw BridgeError("Unknown test WebView") }
            let responder = focusView(window.firstResponder) ?? window.firstResponder as? NSView
            let inside = responder.map { $0 === view || $0.isDescendant(of: view) } ?? false
            return ["focused": inside, "eligible": responder.map { eligibleFocusView($0, in: window) } ?? false,
                "containerEligible": eligibleFocusView(view, in: window), "interactionEnabled": (view as? ControlWebView)?.interactionEnabled ?? true,
                "hit": view.hitTest(NSPoint(x: view.frame.midX, y: view.frame.midY)) != nil]
        case "debug.web.evaluate" where testing:
            let id = try integer(message["id"])
            guard let coordinator = webViews[id], let script = message["script"] as? String else { throw BridgeError("Unknown WebView or script") }
            coordinator.view?.evaluateJavaScript(script + "\n;null;") { [weak coordinator] _, error in
                if let error { coordinator?.report(coordinator?.describe(error) ?? error.localizedDescription) }
            }
            return [:]
        case "debug.write" where testing:
            let id = try integer(message["id"])
            guard let cell = cells[id], let value = message["value"] else { throw BridgeError("Unknown test state") }
            try validateWrite(id, value: value)
            nativeWrite(cell, value: value); return cell.snapshot()
        case "debug.action" where testing: action(try integer(message["id"])); return [:]
        case "debug.close" where testing: window?.performClose(nil); return [:]
        case "debug.quit" where testing: NSApp.terminate(nil); return [:]
        case "debug.closeAfter" where testing:
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.window?.performClose(nil) }; return [:]
        default: throw BridgeError("Unknown or unavailable operation: \(op)")
        }
    }
}

@_cdecl("ju_host_request")
func hostRequest(_ pointer: UnsafeMutableRawPointer?, _ json: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let pointer, let json else { return strdup("{\"error\":\"Missing host or request\"}") }
    let host = Unmanaged<Host>.fromOpaque(pointer).takeUnretainedValue()
    let input = String(cString: json)
    // Node can wait for main; main never waits for Node until Node has stopped.
    let response: String = DispatchQueue.main.sync {
        do {
            guard let message = try JSONSerialization.jsonObject(with: Data(input.utf8)) as? [String: Any] else { throw BridgeError("Invalid JSON request") }
            return try encode(host.handle(message))
        } catch { return (try? encode(["error": String(describing: error)])) ?? "{\"error\":\"Bridge failure\"}" }
    }
    return strdup(response)
}

@_cdecl("ju_host_runtime_stopped")
func hostRuntimeStopped(_ pointer: UnsafeMutableRawPointer?, _ status: Int32) {
    guard let pointer else { return }
    DispatchQueue.main.async { Unmanaged<Host>.fromOpaque(pointer).takeUnretainedValue().stopped(status) }
}

@main
struct JonUI {
    static func main() {
        guard CommandLine.arguments.count == 2 else { fputs("Usage: jonui entry.ts\n", stderr); exit(2) }
        let entry = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL.path
        guard FileManager.default.fileExists(atPath: entry) else { fputs("jonui: entry file does not exist: \(entry)\n", stderr); exit(2) }
        let root = ProcessInfo.processInfo.environment["JONUI_ROOT"] ?? URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().path
        let bootstrap = root + "/runtime/bootstrap.mjs"
        guard FileManager.default.fileExists(atPath: bootstrap) else { fputs("jonui: cannot find runtime; set JONUI_ROOT\n", stderr); exit(2) }
        guard let app = JonUIApplication.shared as? JonUIApplication else {
            fputs("jonui: application event router was not initialized\n", stderr); exit(2)
        }
        app.setActivationPolicy(.regular)
        let host = Host(); app.delegate = host
        let menu = NSMenu(), application = NSMenuItem(); menu.addItem(application)
        let submenu = NSMenu(); application.submenu = submenu
        let quit = NSMenuItem(title: "Quit JonUI", action: #selector(Host.quit), keyEquivalent: "q"); quit.target = host; submenu.addItem(quit)
        // Supply the standard text editing responder actions for native text fields.
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: ""); menu.addItem(edit)
        let editMenu = NSMenu(title: "Edit"); edit.submenu = editMenu
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        app.mainMenu = menu
        let retained = Unmanaged.passRetained(host)
        ju_runtime_start(retained.toOpaque(), CommandLine.arguments[0], bootstrap, entry)
        app.run()
        ju_runtime_join()
        retained.release()
        exit(host.exitStatus)
    }
}
