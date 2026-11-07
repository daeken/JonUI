import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePreview } from '../examples/playground/compile.ts';

test('editable TypeScript bodies compile with injected constructors and persistent state', () => {
  const count = { value: 3 }, ui = { Text: value => ({ text: value }) };
  let render = compilePreview('const label: string = "Hello 🦊 café"; return Text(`${label}: ${count.value}`);', ui, count);
  assert.deepEqual(render(), { text: 'Hello 🦊 café: 3' });
  count.value = 4;
  render = compilePreview('return Text(`New code, same count: ${count.value}`);', ui, count);
  assert.deepEqual(render(), { text: 'New code, same count: 4' });
  assert.throws(() => compilePreview('return Text(', ui, count), SyntaxError);
  assert.deepEqual(render(), { text: 'New code, same count: 4' });
});
