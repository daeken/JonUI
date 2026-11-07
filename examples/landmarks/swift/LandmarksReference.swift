import SwiftUI
import Observation

// Original, dependency-free reference for the Landmarks interaction pattern.
// Both versions consume the same fictional fixture, not Apple's sample assets.
private struct LandmarkSeed: Decodable {
    let id: String
    let name: String
    let region: String
    let description: String
    let isFavorite: Bool
    let note: String
}

@MainActor @Observable
private final class Landmark: Identifiable {
    let id: String
    let name: String
    let region: String
    let description: String
    var isFavorite: Bool
    var note: String

    init(_ seed: LandmarkSeed) {
        id = seed.id
        name = seed.name
        region = seed.region
        description = seed.description
        isFavorite = seed.isFavorite
        note = seed.note
    }
}

@MainActor @Observable
private final class LandmarkModel {
    let landmarks: [Landmark]
    var favoritesOnly = false
    var selection: String?
    var editingNote = false
    var ticks = 0

    init() {
        guard let url = Bundle.module.url(forResource: "landmarks", withExtension: "json") else {
            fatalError("Missing landmarks.json resource")
        }
        do {
            landmarks = try JSONDecoder().decode([LandmarkSeed].self, from: Data(contentsOf: url))
                .map(Landmark.init)
        } catch {
            fatalError("Cannot load landmark fixture: \(error)")
        }
    }

    var visibleLandmarks: [Landmark] {
        landmarks.filter { !favoritesOnly || $0.isFavorite }
    }

    var selectedLandmark: Landmark? {
        landmarks.first { $0.id == selection }
    }

    func reconcileSelection() {
        if let item = selectedLandmark, favoritesOnly, !item.isFavorite {
            editingNote = false
            selection = nil
        }
    }
}

@MainActor
private struct LandmarkRow: View {
    let item: Landmark

    var body: some View {
        HStack {
            Text(item.name)
            Spacer()
            if item.isFavorite {
                Image(systemName: "star.fill")
                    .foregroundStyle(.yellow)
            }
        }
    }
}

@MainActor
private struct LandmarkSidebar: View {
    @Bindable var model: LandmarkModel

    var body: some View {
        VStack(spacing: 0) {
            Toggle("Favorites only", isOn: $model.favoritesOnly)
                .accessibilityIdentifier("favorites-only")
                .padding()
            List(selection: $model.selection) {
                ForEach(model.visibleLandmarks) { item in
                    LandmarkRow(item: item)
                        .tag(item.id)
                        .accessibilityIdentifier("landmark-\(item.id)")
                }
            }
            .accessibilityIdentifier("landmark-list")
        }
        .navigationTitle("Landmarks")
        .onChange(of: model.favoritesOnly) { _, _ in model.reconcileSelection() }
    }
}

@MainActor
private struct FavoriteButton: View {
    let item: Landmark
    let onChange: () -> Void

    var body: some View {
        Button(item.isFavorite ? "Remove favorite" : "Add favorite") {
            item.isFavorite.toggle()
            onChange()
        }
        .accessibilityIdentifier("favorite-button")
    }
}

@MainActor
private struct NoteEditor: View {
    @Bindable var item: Landmark
    @Binding var isPresented: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Note for \(item.name)").font(.headline)
            TextField("Note", text: $item.note)
                .accessibilityIdentifier("note-field")
            Button("Done") { isPresented = false }
                .accessibilityIdentifier("note-done")
        }
        .padding(24)
        .frame(minWidth: 360, minHeight: 160)
    }
}

@MainActor
private struct LandmarkDetail: View {
    @Bindable var model: LandmarkModel

    var body: some View {
        if let item = model.selectedLandmark {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(item.name).font(.title)
                    Spacer()
                    FavoriteButton(item: item, onChange: model.reconcileSelection)
                }
                Text(item.region).foregroundStyle(.secondary)
                Divider()
                Text(item.description)
                Text(item.note.isEmpty ? "No note yet" : item.note)
                    .accessibilityIdentifier("note-preview")
                Button("Edit note") { model.editingNote = true }
                    .accessibilityIdentifier("edit-note")
                Spacer()
            }
            .padding(24)
            .navigationTitle(item.name)
            .sheet(isPresented: $model.editingNote) {
                NoteEditor(item: item, isPresented: $model.editingNote)
            }
        } else {
            Text("Select a landmark")
                .accessibilityIdentifier("empty-detail")
        }
    }
}

@MainActor
private struct ContentView: View {
    @State private var model = LandmarkModel()

    var body: some View {
        VStack(spacing: 0) {
            NavigationSplitView {
                LandmarkSidebar(model: model)
            } detail: {
                LandmarkDetail(model: model)
            }
            Divider()
            // A Swift task substitutes for the Node timer in this reference only.
            Text("Runtime ticks: \(model.ticks)")
                .font(.caption)
                .accessibilityIdentifier("node-ticks")
        }
        .task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    return
                }
                model.ticks += 1
            }
        }
    }
}

@main
struct LandmarksReferenceApp: App {
    var body: some Scene {
        WindowGroup("JonUI Landmarks") {
            ContentView()
        }
        .defaultSize(width: 900, height: 600)
    }
}
