import assert from 'node:assert/strict';
import { __testing as test } from 'jonui';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => test.request('debug.snapshot');
const hasText = (state, value) => state.nodes.some(n => n.kind === 'text' && n.props.value === value);
function control(state, identifier, kind) {
  const nodes = new Map(state.nodes.map(n => [n.id, n]));
  let node = state.nodes.find(n => n.kind === 'modifier' && n.props.name === 'accessibilityIdentifier' && n.props.value === identifier);
  while (node && node.kind !== kind) node = nodes.get(node.children[0]);
  assert.ok(node, `${identifier}/${kind}`); return node;
}
async function until(predicate, description) {
  const deadline = Date.now() + 5000;
  do { const state = snapshot(); if (predicate(state)) return state; await pause(10); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
let state = await until(s => s.windowVisible, 'playground window');
const editor = control(state, 'source-editor', 'texteditor');
const click = id => test.request('debug.action', { id });
async function reload(source) {
  test.request('debug.write', { id: editor.props.state, value: source });
  await until(s => s.states.some(c => c.id === editor.props.state && c.value === source), 'native editor value');
  // Wait for the revisioned native edit to reach the Node mirror.
  await pause(20);
  click(control(snapshot(), 'reload-code', 'button').id);
}
click(state.nodes.find(n => n.kind === 'button' && n.props.title === '+').id);
await until(s => hasText(s, 'Count: 1'), 'initial counter callback');
const good = 'const title: string = "Reloaded 🦊 café";\nreturn VStack([Text(title), Text(`Count: ${count.value}`), Button("Add five", () => { count.value += 5; })]);';
// Typing alone must not replace the committed preview.
test.request('debug.write', { id: editor.props.state, value: good });
await pause(40); assert.ok(hasText(snapshot(), 'Hello from editable TypeScript!'));
await reload(good);
state = await until(s => hasText(s, 'Reloaded 🦊 café'), 'typed TypeScript reload');
assert.ok(hasText(state, 'Count: 1'));
click(state.nodes.find(n => n.kind === 'button' && n.props.title === 'Add five').id);
await until(s => hasText(s, 'Count: 6'), 'reloaded callback with persistent state');
await reload('return VStack([');
state = await until(s => s.nodes.some(n => n.kind === 'text' && n.props.value.startsWith('SyntaxError:')), 'syntax error feedback');
assert.ok(hasText(state, 'Count: 6'));
await reload('return VStack([Button("Partial", () => {}), View(() => { throw new Error("nested preview failure"); })]);');
state = await until(s => hasText(s, 'Error: nested preview failure'), 'recoverable descendant render error');
assert.ok(control(state, 'source-editor', 'texteditor'));
await reload(good);
state = await until(s => hasText(s, 'Count: 6'), 'recovery without restarting');
await reload('return Button("Throw action", () => { throw new Error("edited action failure"); });');
state = await until(s => s.nodes.some(n => n.kind === 'button' && n.props.title === 'Throw action'), 'edited action');
click(state.nodes.find(n => n.kind === 'button' && n.props.title === 'Throw action').id);
await until(s => hasText(s, 'Error: edited action failure'), 'edited callback error feedback');
await reload('return Text(`Stable count: ${count.value}`);');
state = await until(s => hasText(s, 'Stable count: 6'), 'stable preview');
const baseline = { nodes: state.nodes.length, ...test.stats() };
for (let i = 0; i < 25; i++) {
  await reload(`return Text(\`Edit ${i}, count: \${count.value}\`);`);
  state = await until(s => hasText(s, `Edit ${i}, count: 6`), `reload ${i}`);
}
assert.equal(state.nodes.length, baseline.nodes);
assert.deepEqual(test.stats(), { actions: baseline.actions, cells: baseline.cells, dependencies: baseline.dependencies });
console.log('PASS playground: native multiline Unicode editing, TypeScript reload, persistent state, syntax/render/action errors, recovery and 25 reloads without registration growth');
test.request('debug.close');
