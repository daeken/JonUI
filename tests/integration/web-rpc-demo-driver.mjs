import assert from 'node:assert/strict';
import { __testing as test } from 'jonui';
const snapshot = () => test.request('debug.snapshot'), browser = () => snapshot().nodes.find(n => n.kind === 'webview');
const web = () => test.request('debug.web', { id: browser().id });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name) {
  const end = Date.now() + 6000;
  do { const s = snapshot(); assert.equal(test.request('debug.focusStatus').key, false); if (predicate(s)) return; await sleep(10); } while (Date.now() < end);
  assert.fail(`Timed out: ${name}`);
}
const text = value => snapshot().nodes.some(n => n.kind === 'text' && n.props.value === value);
const nativeAction = title => test.request('debug.action', { id: snapshot().nodes.find(n => n.kind === 'button' && n.props.title === title).id });
function select(id, keyboard = false) {
  test.request('debug.web.evaluate', { id: browser().id, script: `(() => { const deadline = Date.now() + 3000; function select() { const bar = document.querySelector('rect[data-id="${id}"]'); if (bar) bar.dispatchEvent(${keyboard ? "new KeyboardEvent('keydown', {key:'Enter',bubbles:true})" : "new MouseEvent('click', {bubbles:true})"}); else if (Date.now() < deadline) setTimeout(select, 10); } select(); })()` });
}
await until(() => browser() && snapshot().webViewCount === 1 && web().ready, 'visualization loaded');
select(1); await until(() => text('Node selected Beta: 80') && browser().props.data.selected === 1, 'SVG click calls Node service');
const prior = JSON.stringify(browser().props.data.points); nativeAction('Change data');
await until(() => JSON.stringify(browser().props.data.points) !== prior, 'native chart data update');
const value = browser().props.data.points.find(p => p.id === 1).value;
select(1); await until(() => text(`Node selected Beta: ${value}`), 'updated Node data returned through RPC');
assert.equal(web().loads, 1);
const tabStop = snapshot().nodes.find(n => n.kind === 'toggle' && n.props.title === 'Chart Tab stop').props.state;
test.request('debug.write', { id: tabStop, value: false });
await until(() => !browser().props.tabFocusable && !test.request('debug.webFocus', { id: browser().id }).containerEligible, 'chart removed from native Tab order');
assert.equal(test.request('debug.webFocus', { id: browser().id }).hit, true);
select(2); await until(() => browser().props.data.selected === 2, 'pointer selection/RPC remain available without a Tab stop');
test.request('debug.write', { id: tabStop, value: true });
await until(() => browser().props.tabFocusable && test.request('debug.webFocus', { id: browser().id }).containerEligible, 'chart Tab stop restored');
assert.equal(web().loads, 1);
nativeAction('Clear selection'); await until(() => browser().props.data.selected === null, 'native selection reset');
select(3, true); await until(() => browser().props.data.selected === 3, 'SVG keyboard selection calls Node');
nativeAction('Reload visualization'); await until(() => web().loads === 2 && web().ready && browser().props.data.selected === 3, 'reload reapplies Node selection');
select(0); await until(() => browser().props.data.selected === 0 && web().pending === 0, 'new document RPC works');
console.log('PASS visualization RPC demo: actual SVG mouse/keyboard events, Node-owned selection/data, native updates and Tab eligibility without reload, pointer/RPC availability, source replacement and working new-document calls');
test.request('debug.close');
