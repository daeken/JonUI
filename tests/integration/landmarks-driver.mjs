import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { __testing as test } from 'jonui';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
const snapshot = () => {
  const state = test.request('debug.snapshot');
  if (started && !state.nodes.length) throw new Error('The app was closed while its integration test was still running');
  if (state.nodes.length) started = true;
  return state;
};
async function until(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  do { const state = snapshot(); if (predicate(state)) return state; await sleep(20); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
function find(state, identifier, kind) {
  const map = new Map(state.nodes.map(n => [n.id, n]));
  let current = state.nodes.find(n => n.kind === 'modifier' && n.props.name === 'accessibilityIdentifier' && n.props.value === identifier);
  while (current && current.kind !== kind) current = map.get(current.children[0]);
  assert.ok(current, `Missing ${identifier}/${kind}`); return current;
}
const write = (id, value) => test.request('debug.write', { id, value });
const click = (state, identifier) => test.request('debug.action', { id: find(state, identifier, 'button').id });
const text = (state, identifier) => find(state, identifier, 'text').props.value;
function rows(state) {
  const map = new Map(state.nodes.map(n => [n.id, n]));
  const list = find(state, 'landmark-list', 'list');
  return map.get(list.children[0]).children;
}
let state = await until(s => s.windowVisible, 'initial window');
assert.equal(state.mainThread, true);
assert.equal(rows(state).length, 3);
assert.equal(text(state, 'empty-detail'), 'Select a landmark');
// A real Node asynchronous filesystem operation while the native window is open.
const fixtures = JSON.parse(await readFile(new URL('../../examples/landmarks/fixtures/landmarks.json', import.meta.url), 'utf8'));
const mirror = fixtures.find(x => x.name === 'Mirror Lake');
const cedar = fixtures.find(x => x.name === 'Cedar Ridge');
const selection = find(state, 'landmark-list', 'list').props.state;
const favoriteFilter = find(state, 'favorites-only', 'toggle').props.state;
write(selection, mirror.id);
state = await until(s => s.nodes.some(n => n.kind === 'button' && n.props.title === 'Add favorite'), 'Mirror Lake detail');
click(state, 'favorite-button');
state = await until(s => s.nodes.some(n => n.kind === 'button' && n.props.title === 'Remove favorite'), 'favorite round trip');
write(favoriteFilter, true);
await sleep(50); state = snapshot(); assert.equal(rows(state).length, 3);
click(state, 'favorite-button');
state = await until(s => s.nodes.some(n => n.props.value === 'Select a landmark'), 'filtered selection reconciliation');
assert.equal(rows(state).length, 2);
const remainingRows = rows(state);
write(favoriteFilter, false);
state = await until(s => rows(s).length === 3, 'unfiltered rows');
assert.equal(rows(state)[0], remainingRows[0]);
assert.equal(rows(state)[2], remainingRows[1]);
write(selection, cedar.id);
state = await until(s => s.nodes.some(n => n.props.value === cedar.note), 'Cedar Ridge detail');
click(state, 'edit-note');
state = await until(s => s.sheetPresented, 'native note sheet');
const noteState = find(state, 'note-field', 'textfield').props.state;
write(noteState, 'Hello 🦊 café');
state = await until(s => text(s, 'note-preview') === 'Hello 🦊 café', 'Unicode native binding round trip');
click(state, 'note-done');
state = await until(s => !s.sheetPresented, 'Done dismisses native sheet');
await sleep(500); state = snapshot();
const baseline = { live: state.liveViews, nodes: state.nodes.length, ...test.stats() };
for (let i = 0; i < 100; i++) {
  click(state, 'edit-note');
  state = await until(s => s.sheetPresented, `sheet presentation ${i}`);
  click(state, 'note-done');
  state = await until(s => !s.sheetPresented, `sheet dismissal ${i}`);
}
await sleep(500);
state = snapshot();
assert.equal(state.nodes.length, baseline.nodes);
assert.equal(state.liveViews, baseline.live);
assert.deepEqual(test.stats(), { actions: baseline.actions, cells: baseline.cells, dependencies: baseline.dependencies });
write(selection, mirror.id);
await until(s => s.nodes.some(n => n.kind === 'text' && n.props.value === mirror.description), 'navigation away');
write(selection, cedar.id);
state = await until(s => s.nodes.some(n => n.props.value === 'Hello 🦊 café'), 'note survives navigation');
await until(s => Number(text(s, 'node-ticks').split(': ')[1]) >= 3, 'real Node timer advances', 6000);
console.log('PASS Landmarks: filtering, favorites, keyed identity, Unicode, navigation, 100 native sheets, stable live handles, Node timer and filesystem');
test.request('debug.close');
