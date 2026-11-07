// Acceptance target: run with `bin/jonui examples/landmarks/app.ts`.
import {
  Button, Divider, ForEach, HStack, Image, List, NavigationSplitView,
  runApp, Spacer, State, Text, TextField, Toggle, View, VStack,
} from "jonui";
import fixtures from "./fixtures/landmarks.json" with { type: "json" };

// Stable model identity and state allocation live outside recomputed view bodies.
const landmarks = fixtures.map(item => ({
  ...item,
  isFavorite: State<boolean>(item.isFavorite),
  note: State<string>(item.note),
}));
type Landmark = (typeof landmarks)[number];

const favoritesOnly = State<boolean>(false);
const selection = State<string | null>(null);
const editingNote = State<boolean>(false);
const ticks = State<number>(0);

// Hidden selection is cleared explicitly rather than relying on List side effects.
function reconcileSelection(): void {
  const selected = landmarks.find(item => item.id === selection.value);
  if (selected && favoritesOnly.value && !selected.isFavorite.value) {
    editingNote.value = false;
    selection.value = null;
  }
}
const subscriptions = [
  favoritesOnly.subscribe(reconcileSelection),
  ...landmarks.map(item => item.isFavorite.subscribe(reconcileSelection)),
];

function LandmarkRow(item: Landmark): View {
  return View(() => HStack([
    Text(item.name),
    Spacer(),
    ...(item.isFavorite.value
      ? [Image({ systemName: "star.fill" }).foregroundStyle("yellow")]
      : []),
  ]));
}

function LandmarkSidebar(): View {
  return View(() => {
    const visible = landmarks.filter(item => !favoritesOnly.value || item.isFavorite.value);
    return VStack([
      Toggle("Favorites only", { isOn: favoritesOnly.binding })
        .accessibilityIdentifier("favorites-only")
        .padding(),
      List<string>({ selection: selection.binding }, ForEach(
        visible,
        { id: item => item.id },
        item => LandmarkRow(item).tag(item.id)
          .accessibilityIdentifier(`landmark-${item.id}`),
      )).accessibilityIdentifier("landmark-list"),
    ], { spacing: 0 }).navigationTitle("Landmarks");
  });
}

function FavoriteButton(item: Landmark): View {
  return View(() => Button(
    item.isFavorite.value ? "Remove favorite" : "Add favorite",
    () => { item.isFavorite.value = !item.isFavorite.value; },
  ).accessibilityIdentifier("favorite-button"));
}

function NoteEditor(item: Landmark): View {
  return VStack([
    Text(`Note for ${item.name}`).font("headline"),
    TextField("Note", { text: item.note.binding })
      .accessibilityIdentifier("note-field"),
    Button("Done", () => { editingNote.value = false; })
      .accessibilityIdentifier("note-done"),
  ], { alignment: "leading", spacing: 12 })
    .padding(24)
    .frame({ minWidth: 360, minHeight: 160 });
}

function LandmarkDetail(): View {
  return View(() => {
    const item = landmarks.find(item => item.id === selection.value);
    if (!item) {
      return Text("Select a landmark").accessibilityIdentifier("empty-detail");
    }
    return VStack([
      HStack([Text(item.name).font("title"), Spacer(), FavoriteButton(item)]),
      Text(item.region).foregroundStyle("secondary"),
      Divider(),
      Text(item.description),
      View(() => Text(item.note.value || "No note yet")
        .accessibilityIdentifier("note-preview")),
      Button("Edit note", () => { editingNote.value = true; })
        .accessibilityIdentifier("edit-note"),
      Spacer(),
    ], { alignment: "leading", spacing: 12 })
      .padding(24)
      .navigationTitle(item.name)
      .sheet({ isPresented: editingNote.binding, content: NoteEditor(item) });
  });
}

const timer = setInterval(() => { ticks.value += 1; }, 1000);
function cleanup(): void {
  clearInterval(timer);
  subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
}
try {
  await runApp({
    title: "JonUI Landmarks",
    width: 900,
    height: 600,
    content: VStack([
      NavigationSplitView({ sidebar: LandmarkSidebar(), detail: LandmarkDetail() }),
      Divider(),
      View(() => Text(`Runtime ticks: ${ticks.value}`)
        .font("caption")
        .accessibilityIdentifier("node-ticks")),
    ], { spacing: 0 }),
    onStop: cleanup,
  });
} finally {
  // Also clean up if startup fails before onStop can be invoked.
  cleanup();
}
