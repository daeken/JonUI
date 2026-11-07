import test from 'node:test';
import assert from 'node:assert/strict';
let sequence = 0;
async function setup() {
  let listener;
  const states = new Map(), nodes = new Map(), calls = [];
  const focus = { target: null, focused: false, configured: true, name: null, sequence: 0 };
  let status;
  const bridge = {
    listen(callback) { listener = callback; },
    finish(code) { status = code; },
    request(json) {
      const message = JSON.parse(json); calls.push(message);
      let result = {};
      if (message.op === 'focus.capture') result = { target: focus.target };
      if (message.op === 'focus.target') result = { focused: focus.focused };
      if (message.op === 'web.claim') result = { accepted: focus.rpcActive !== false };
      if (message.op === 'focus.named') result = { focused: focus.focused };
      if (message.op === 'focus.currentName') result = { name: focus.name };
      if (message.op === 'focus.availability') result = focus.availabilityError ? { error: focus.availabilityError } : { availability: focus.availability ?? 'ready' };
      if (message.op === 'focus.watch') result = focus.watchError ? { error: focus.watchError } : { name: focus.name, sequence: 0, context: focus.context ?? 1, generation: 0 };
      if (message.op === 'focus.snapshot') result = focus.snapshotError ? { error: focus.snapshotError } : { accepted: true, observation: { token: message.token, sequence: ++focus.sequence, context: focus.context ?? 1, generation: focus.generation ?? 0, name: focus.name } };
      if (message.op === 'focus.direction') result = { moved: focus.focused };
      if (message.op === 'focus.traversal') result = { configured: focus.configured };
      if (message.focusRequest) {
        const accepted = message.focusRequest.context === undefined || message.focusRequest.context === (focus.context ?? 1);
        if (accepted && message.op === 'focus.named' && focus.focused) focus.name = message.name;
        if (accepted && message.op === 'focus.move' && message.direction === 'clear') focus.name = null;
        if (message.op === 'focus.blurNamed') { result.cleared = accepted && focus.name === message.name; if (result.cleared) focus.name = null; }
        result.focusAccepted = accepted;
        focus.generation = message.focusRequest.generation;
        if (!accepted) result.focused = result.moved = false;
        result.observation = { token: message.focusRequest.token, generation: message.focusRequest.generation, sequence: ++focus.sequence, context: focus.context ?? 1, name: focus.name };
      }
      if (message.op === 'state.create') {
        result = { value: message.value, revision: 0 }; states.set(message.id, result);
      } else if (message.op === 'state.write') {
        const old = states.get(message.id);
        result = { value: message.value, revision: old.revision + 1 }; states.set(message.id, result);
      } else if (message.op === 'state.release') {
        for (const id of message.ids) states.delete(id);
      } else if (message.op === 'dispose') {
        states.clear(); nodes.clear();
      } else if (message.op === 'commit') {
        for (const node of message.nodes) nodes.set(node.id, node);
      }
      return JSON.stringify(result);
    },
  };
  globalThis.__jonuiNative = bridge;
  process.env.JONUI_TEST = '1';
  const ui = await import(`../runtime/index.mjs?test=${sequence++}`);
  return { ui, states, nodes, calls, focus, emit: event => listener(JSON.stringify(event)), status: () => status };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const launch = (ui, content, onStop) => ui.runApp({ title: 'Test', width: 400, height: 300, content, onStop });

test('WebView Tab eligibility validates flags and changes without replacing native identity or handlers', async () => {
  const h = await setup(), { ui } = h;
  assert.equal(ui.WebView({ html: '' }).props.tabFocusable, true);
  for (const tabFocusable of [null, 0, 1, 'false', {}, []]) assert.throws(() => ui.WebView({ html: '', tabFocusable }), /tabFocusable/);
  const flag = ui.State(true), done = launch(ui, ui.View(() => ui.WebView({ html: '<svg></svg>', tabFocusable: flag.value, api: { select: id => id } })));
  const node = [...h.nodes.values()].find(n => n.kind === 'webview'), epoch = node.props.rpcEpoch;
  flag.value = false; await tick(); const changed = h.nodes.get(node.id);
  assert.equal(changed.props.tabFocusable, false); assert.equal(changed.props.rpcEpoch, epoch); assert.deepEqual(changed.props.methods, ['select']); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('WebView API tables copy own methods, reject invalid exports, and keep functions off the native wire', async () => {
  const h = await setup(), { ui } = h;
  for (const api of [null, [], 1, () => {}, new Map(), { value: 1 }, { then() {} }, { toJSON() {} }, { constructor() {} }, { [Symbol.iterator]() {} }, { ['\ud800']() {} }, { get method() { throw new Error('must not invoke'); } }]) {
    assert.throws(() => ui.WebView({ html: '', api }), /WebView api/);
  }
  const api = { get: () => 'original' }, view = ui.WebView({ html: '', api }); api.get = () => 'mutated';
  assert.equal(view.props.api.get(), 'original'); assert.ok(Object.isFrozen(view.props.api));
  const done = launch(ui, view); const node = [...h.nodes.values()].find(n => n.kind === 'webview');
  assert.equal(node.props.api, undefined); assert.deepEqual(node.props.methods, ['get']); assert.ok(node.props.rpcEpoch > 0);
  assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: 1, method: 'get', args: [] }); await tick();
  assert.deepEqual(h.calls.find(c => c.op === 'web.reply').result, { ok: true, value: 'original' });
  assert.throws(() => ui.WebRequest.current, /only available/);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.webRequestStats(), { apis: 0, pending: 0 });
});

test('RPC handles concurrent JSON/void results, isolated errors, current handlers, and request-scoped cleanup', async () => {
  const h = await setup(), { ui } = h; const version = ui.State(1); let context, cleanups = 0;
  const done = launch(ui, ui.View(() => {
    const current = version.value;
    return ui.WebView({ html: '', api: {
      echo(value) { context = ui.WebRequest.current; context.onCancel(() => { cleanups++; }); return { value, current }; },
      async empty() {}, nullValue: () => null,
      fail() { throw new RangeError('bad point'); }, async reject() { throw 'rejected'; }, invalid: () => NaN,
      cleanup() { ui.WebRequest.current.onCancel(() => { throw new Error('cleanup failed'); }); },
    } });
  }));
  const node = [...h.nodes.values()].find(n => n.kind === 'webview');
  const call = (method, id, args = []) => h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: id, method, args });
  call('echo', 1, [{ label: '🦊 café' }]); call('empty', 2); call('nullValue', 3); call('fail', 4); call('reject', 5); call('invalid', 6); call('cleanup', 7); call('missing', 8);
  await tick(); const replies = new Map(h.calls.filter(c => c.op === 'web.reply').map(c => [c.call, c.result]));
  assert.deepEqual(replies.get(1), { ok: true, value: { value: { label: '🦊 café' }, current: 1 } });
  assert.deepEqual(replies.get(2), { ok: true }); assert.deepEqual(replies.get(3), { ok: true, value: null });
  assert.deepEqual(replies.get(4).error, { name: 'RangeError', message: 'bad point' }); assert.equal(replies.get(5).error.message, 'rejected');
  assert.equal(replies.get(6).error.name, 'TypeError'); assert.equal(replies.get(7).error.message, 'cleanup failed'); assert.equal(replies.get(8).error.name, 'TypeError');
  assert.equal(cleanups, 1); assert.equal(context.signal.aborted, true); assert.equal(context.isCurrent, false); assert.equal(context.commit(() => assert.fail()), false);
  version.value = 2; await tick(); call('echo', 9, ['updated']); await tick(); assert.equal(h.calls.filter(c => c.op === 'web.reply').at(-1).result.value.current, 2);
  assert.equal(h.status(), undefined); assert.equal(ui.__testing.webRequestStats().pending, 0);
  h.emit({ type: 'stop' }); await done;
});

test('document replacement/unmount cancel RPC continuations, subscriptions, late writes and replies', async () => {
  const h = await setup(), { ui } = h; const html = ui.State('first'), shown = ui.State(true), shared = ui.State('safe');
  h.focus.name = 'current';
  const gates = [], signals = [], lateNames = []; let cleanups = 0, lateAllocations = 0, commits = 0;
  const done = launch(ui, ui.View(() => shown.value ? ui.WebView({ html: html.value, api: { async slow() {
    const context = ui.WebRequest.current; signals.push(context.signal); context.onCancel(() => { cleanups++; shared.value = 'cleanup'; });
    ui.Focus.subscribe(() => assert.fail('retired RPC focus listener must be released'));
    shared.subscribe(() => assert.fail('cancelled subscription must be released'));
    await new Promise(resolve => gates.push(resolve));
    lateNames.push(ui.Focus.currentName());
    shared.value = 'late'; if (context.commit(() => { commits++; })) assert.fail();
    try { ui.State('late'); } catch { lateAllocations++; }
    return 'obsolete';
  } } }) : ui.Text('hidden')));
  let node = [...h.nodes.values()].find(n => n.kind === 'webview');
  h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: 1, method: 'slow', args: [] });
  const oldEpoch = node.props.rpcEpoch; html.value = 'second'; await tick();
  assert.equal(signals[0].aborted, true); assert.equal(cleanups, 1); assert.equal(shared.value, 'safe');
  node = h.nodes.get(node.id); assert.notEqual(node.props.rpcEpoch, oldEpoch);
  h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: oldEpoch, call: 99, method: 'slow', args: [] }); assert.equal(gates.length, 1);
  h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: 2, method: 'slow', args: [] });
  shown.value = false; await tick(); assert.equal(signals[1].aborted, true); assert.equal(cleanups, 2);
  shared.value = 'current'; gates.forEach(resolve => resolve()); await tick();
  assert.equal(shared.value, 'current'); assert.equal(lateAllocations, 2); assert.equal(commits, 0); assert.ok(!h.calls.some(c => c.op === 'web.reply'));
  assert.deepEqual(lateNames, [null, null]); assert.ok(!h.calls.some(c => c.op === 'focus.currentName'));
  assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  assert.equal(h.calls.filter(c => c.op === 'focus.watch').length, 2);
  assert.equal(h.calls.filter(c => c.op === 'focus.unwatch').length, 2);
  assert.deepEqual(ui.__testing.webRequestStats(), { apis: 0, pending: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('native document cancellation releases only the affected RPC calls and ignores obsolete epochs', async () => {
  const h = await setup(), { ui } = h; const gates = []; let cancelled = 0;
  const done = launch(ui, ui.WebView({ html: '', api: { async wait() { ui.WebRequest.current.onCancel(() => { cancelled++; }); return await new Promise(resolve => gates.push(resolve)); } } }));
  const node = [...h.nodes.values()].find(n => n.kind === 'webview'), epoch = node.props.rpcEpoch;
  for (const call of [1, 2]) h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch, call, method: 'wait', args: [] });
  h.emit({ type: 'webCancel', document: 'doc', id: node.id, epoch: epoch + 1, calls: [2] }); assert.equal(cancelled, 0);
  h.emit({ type: 'webCancel', document: 'doc', id: node.id, epoch, calls: [1] }); assert.equal(cancelled, 1);
  gates[0]('ignored'); gates[1]('delivered'); await tick();
  assert.equal(cancelled, 2); assert.deepEqual(h.calls.filter(c => c.op === 'web.reply').map(c => c.call), [2]);
  h.emit({ type: 'stop' }); await done;
});

test('RPC teardown cleanup failures still dispose every owner, callback, pending request and cell', async () => {
  const h = await setup(), { ui } = h; const shown = ui.State(true); let disposed = 0, stopped = 0;
  const Owner = ui.Component(scope => {
    scope.state('owned'); scope.onDispose(() => { disposed++; });
    return () => ui.WebView({ html: '', api: { async hold() {
      ui.WebRequest.current.onCancel(() => { throw new Error('RPC cancellation cleanup failed'); }); await new Promise(() => {});
    } } });
  });
  const app = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('hidden')), () => { stopped++; });
  const rejected = assert.rejects(app, /RPC cancellation cleanup failed/);
  const node = [...h.nodes.values()].find(n => n.kind === 'webview'); h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: 1, method: 'hold', args: [] });
  shown.value = false; await tick(); await rejected;
  assert.equal(disposed, 1); assert.equal(stopped, 1); assert.equal(h.status(), 1);
  assert.deepEqual(ui.__testing.webRequestStats(), { apis: 0, pending: 0 }); assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.equal(h.states.size, 0);
});

test('RPC document identities disambiguate reused call IDs and native invalidation guards late state writes', async () => {
  const h = await setup(), { ui } = h; const shared = ui.State('safe'); const gates = []; let calls = 0;
  const done = launch(ui, ui.WebView({ html: '', api: { async hold() { calls++; const signal = ui.WebRequest.current.signal; await new Promise(resolve => gates.push({ resolve, signal })); shared.value = 'delivered'; return 'value'; } } }));
  const node = [...h.nodes.values()].find(n => n.kind === 'webview'), epoch = node.props.rpcEpoch;
  for (const document of ['old', 'new']) h.emit({ type: 'webRequest', document, id: node.id, epoch, call: 1, method: 'hold', args: [] });
  h.emit({ type: 'webCancel', document: 'old', id: node.id, epoch, calls: [1] }); assert.equal(gates[0].signal.aborted, true); assert.equal(gates[1].signal.aborted, false);
  gates[0].resolve(); gates[1].resolve(); await tick();
  assert.deepEqual(h.calls.filter(c => c.op === 'web.reply').map(c => c.document), ['new']);
  shared.value = 'safe'; h.emit({ type: 'webRequest', document: 'third', id: node.id, epoch, call: 1, method: 'hold', args: [] });
  h.focus.rpcActive = false; gates[2].resolve(); await tick();
  assert.equal(shared.value, 'safe'); assert.equal(gates[2].signal.aborted, true); assert.equal(ui.__testing.webRequestStats().pending, 0);
  h.emit({ type: 'webRequest', document: 'gone', id: node.id, epoch, call: 1, method: 'hold', args: [] }); assert.equal(calls, 3);
  h.emit({ type: 'stop' }); await done;
});

test('named native text inputs validate names and preserve binding, handles and callback ownership on rename', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State('Unicode 🦊'), name = ui.State('café');
  const inputs = [options => ui.TextField('Plain', options), options => ui.SecureField('Secret', options), ui.TextEditor];
  for (const input of inputs) {
    for (const focusName of [null, '', 1, true, {}, [], '\ud800']) assert.throws(() => input({ text: value.binding, focusName }), /Focus names/);
    assert.equal('focusName' in input({ text: value.binding }).props, false);
  }
  const done = launch(ui, ui.View(() => ui.VStack(inputs.map((input, i) => input({ text: value.binding, focusName: `${name.value}/${i}`, onEditingChanged: () => {} })))));
  const before = [...h.nodes.values()].filter(n => ['textfield', 'securefield', 'texteditor'].includes(n.kind));
  assert.equal(before.length, 3); assert.equal(ui.__testing.stats().actions, 3);
  name.value = 'Renamed'; await tick();
  for (const [i, input] of before.entries()) {
    const updated = h.nodes.get(input.id);
    assert.equal(updated.props.focusName, `Renamed/${i}`); assert.equal(updated.props.state, input.props.state); assert.equal(updated.props.editing, input.props.editing);
  }
  assert.equal(ui.__testing.stats().actions, 3);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('named WebView focus validates names before transport and retains no extra callbacks or cells', async () => {
  const h = await setup(), { ui } = h;
  const invalid = [null, '', 0, 1, true, {}, [], '\ud800'];
  const before = h.calls.length;
  for (const name of invalid) {
    assert.throws(() => ui.WebView({ html: '', focusName: name }), /Focus names/);
    assert.throws(() => ui.Focus.requestNamed(name), /Focus names/);
  }
  assert.equal(h.calls.length, before);
  const name = ui.State('Browser 🦊'), shown = ui.State(true);
  const done = launch(ui, ui.View(() => shown.value ? ui.WebView({ html: '<input>', focusName: name.value }) : ui.Text('hidden')));
  const browser = [...h.nodes.values()].find(n => n.kind === 'webview'); assert.equal(browser.props.focusName, name.value);
  assert.equal(ui.Focus.requestNamed(name.value), false); assert.deepEqual(h.calls.at(-1), { op: 'focus.named', name: name.value });
  h.focus.focused = true; assert.equal(ui.Focus.requestNamed(name.value), true);
  name.value = 'Renamed'; await tick(); assert.equal(h.nodes.get(browser.id).props.focusName, 'Renamed');
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 2, dependencies: 2 });
  shown.value = false; await tick(); assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 2, dependencies: 1 });
  h.emit({ type: 'stop' }); await done; const stopped = h.calls.length;
  assert.equal(ui.Focus.requestNamed('Renamed'), false); assert.equal(ui.Focus.requestNamed(null), false); assert.equal(h.calls.length, stopped);
});

test('named focus rejects reactive purity violations and ignores canceled task continuations', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true;
  const shown = ui.State(true); let late, lateResult;
  const Owner = ui.Component(scope => {
    scope.effect(() => { assert.equal(ui.Focus.requestNamed('browser'), true); });
    scope.task(async () => { await new Promise(resolve => { late = resolve; }); lateResult = ui.Focus.requestNamed('browser'); });
    return () => ui.WebView({ html: '', focusName: 'browser' });
  });
  const done = launch(ui, ui.View(() => {
    assert.throws(() => ui.Focus.requestNamed('browser'), /outside view bodies/);
    return shown.value ? Owner() : ui.Text('hidden');
  }));
  await tick();
  const computed = ui.Computed(() => ui.Focus.requestNamed('browser'));
  assert.throws(() => computed.value, /Computed callbacks cannot move focus/);
  shown.value = false; await tick(); const before = h.calls.length; late(); await tick();
  assert.equal(lateResult, false); assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('native focus name snapshots preserve null and exact Unicode without allocating state or callbacks', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('focus'));
  assert.ok(Object.isFrozen(ui.Focus));
  for (const name of [null, 'café', 'cafe\u0301', '日本 🦊']) {
    h.focus.name = name; assert.equal(ui.Focus.currentName(), name);
    assert.deepEqual(h.calls.at(-1), { op: 'focus.currentName' });
  }
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done; const count = h.calls.length;
  assert.equal(ui.Focus.currentName(), null); assert.equal(h.calls.length, count);
});

test('focus name reads reject render/computed purity and skip canceled task contexts', async () => {
  const h = await setup(), { ui } = h; h.focus.name = 'editor';
  const shown = ui.State(true); let release, lateResult;
  const Owner = ui.Component(scope => {
    scope.effect(() => { assert.equal(ui.Focus.currentName(), 'editor'); });
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); lateResult = ui.Focus.currentName(); });
    return () => ui.Text('owner');
  });
  const done = launch(ui, ui.View(() => {
    assert.throws(() => ui.Focus.currentName(), /Read native focus outside view bodies/);
    return shown.value ? Owner() : ui.Text('hidden');
  }));
  await tick(); const derived = ui.Computed(() => ui.Focus.currentName());
  assert.throws(() => derived.value, /Computed callbacks cannot read native focus/);
  shown.value = false; await tick(); const before = h.calls.length;
  release(); await tick(); assert.equal(lateResult, null); assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done;
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('focus subscriptions share a session, reject stale events and preserve exact Unicode without replay', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('focus'));
  const first = [], second = [];
  for (const callback of [null, 1, {}, []]) assert.throws(() => ui.Focus.subscribe(callback), /focus listener/);
  const a = ui.Focus.subscribe(name => first.push(name)), b = ui.Focus.subscribe(name => second.push(name));
  assert.deepEqual(first, []); assert.equal(h.calls.filter(c => c.op === 'focus.watch').length, 1);
  const token = h.calls.find(c => c.op === 'focus.watch').token;
  const emit = (sequence, name, context = 1) => h.emit({ type: 'focusChanged', token, sequence, context, name, generation: 0 });
  emit(0, 'old'); emit(1, 'café'); await tick(); emit(2, 'cafe\u0301'); await tick(); emit(3, 'cafe\u0301'); emit(1, 'old');
  emit(4, 1); emit(4, ''); emit(4, '\ud800'); emit(4, 'invalid context', 0); emit(4, 'next', 2); await tick(); emit(5, 'old window', 1); emit(5, null, 2); await tick();
  assert.deepEqual(first, ['café', 'cafe\u0301', 'next', null]); assert.deepEqual(second, first);
  a(); a(); assert.equal(h.calls.filter(c => c.op === 'focus.unwatch').length, 0);
  b(); b(); assert.equal(h.calls.filter(c => c.op === 'focus.unwatch').length, 1);
  assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  const c = ui.Focus.subscribe(name => first.push(name));
  emit(100, 'retired'); const newToken = h.calls.filter(c => c.op === 'focus.watch').at(-1).token; assert.ok(newToken > token);
  h.emit({ type: 'focusChanged', token: newToken, sequence: 1, context: 1, generation: 0, name: 'fresh' }); await tick(); assert.equal(first.at(-1), 'fresh');
  c(); h.emit({ type: 'stop' }); await done;
  const count = h.calls.length; ui.Focus.subscribe(() => assert.fail())(); assert.equal(h.calls.length, count);
});

test('named focus availability validates exact names and reads snapshots without issuing movement or retaining resources', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('availability'));
  const baseline = ui.__testing.stats(), before = h.calls.length;
  for (const name of ['', 1, true, null, {}, '\ud800']) assert.throws(() => ui.Focus.availabilityNamed(name), /Focus names/);
  assert.equal(h.calls.length, before);
  for (const availability of ['missing', 'unrealized', 'inactiveWindow', 'unavailable', 'ready']) {
    h.focus.availability = availability;
    for (const name of ['café', 'cafe\u0301']) {
      assert.equal(ui.Focus.availabilityNamed(name), availability);
      assert.deepEqual(h.calls.at(-1), { op: 'focus.availability', name });
    }
  }
  assert.deepEqual(ui.__testing.stats(), baseline); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  assert.equal(h.calls.some(c => c.focusRequest), false);
  h.focus.availabilityError = 'mounted window required'; assert.throws(() => ui.Focus.availabilityNamed('target'), /mounted window/);
  h.emit({ type: 'stop' }); await done; const count = h.calls.length;
  assert.equal(ui.Focus.availabilityNamed({}), null); assert.equal(h.calls.length, count);
});

test('availability snapshots enforce render/computed purity and suppress canceled task queries before validation', async () => {
  const h = await setup(), { ui } = h, shown = ui.State(true); let release, result = 'pending';
  const Owner = ui.Component(scope => {
    scope.effect(() => { assert.equal(ui.Focus.availabilityNamed('target'), 'ready'); });
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); result = ui.Focus.availabilityNamed({}); });
    return () => { assert.throws(() => ui.Focus.availabilityNamed('target'), /Read native focus availability outside view bodies/); return ui.Text('owner'); };
  });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('removed'))); await tick();
  const derived = ui.Computed(() => ui.Focus.availabilityNamed('target')); assert.throws(() => derived.value, /Computed callbacks cannot read native focus availability/);
  shown.value = false; await tick(); const count = h.calls.length; release(); await tick();
  assert.equal(result, null); assert.equal(h.calls.length, count);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('owned availability maps named, boolean and typed targets without exposing or mutating intent', async () => {
  const h = await setup(), { ui } = h; let named, boolean, selection;
  const Owner = ui.Component(scope => {
    named = scope.focus('named'); boolean = scope.focusBoolean(true); selection = scope.focusSelection([1, '1'], 1); const text = scope.state('');
    return () => ui.VStack([
      ui.TextField('Named', { text: text.binding }).focused(named.binding('named')),
      ui.TextField('Boolean', { text: text.binding }).focused(boolean.binding),
      ui.TextField('Number', { text: text.binding }).focused(selection.binding(1)),
      ui.TextField('String', { text: text.binding }).focused(selection.binding('1')),
    ]);
  });
  const done = launch(ui, Owner()); await tick(); const nodes = [...h.nodes.values()].filter(n => n.kind === 'textfield'), baseline = ui.__testing.stats();
  const names = Object.fromEntries(nodes.map(n => [n.props.title, n.props.focusName])); assert.notEqual(names.Number, names.String);
  const query = (callback, name, availability) => { assert.equal(callback(), availability); assert.deepEqual(h.calls.at(-1), { op: 'focus.availability', name }); };
  for (const availability of ['missing', 'unrealized', 'inactiveWindow', 'unavailable', 'ready']) {
    h.focus.availability = availability;
    query(() => named.availability('named'), names.Named, availability); query(() => boolean.availability(), names.Boolean, availability);
    query(() => selection.availability(1), names.Number, availability); query(() => selection.availability('1'), names.String, availability);
  }
  assert.deepEqual([named.desired.value, boolean.desired.value, selection.desired.value], ['named', true, 1]);
  assert.deepEqual(ui.__testing.stats(), baseline); assert.deepEqual(ui.__testing.focusStats(), { listeners: 3, watching: true });
  h.emit({ type: 'stop' }); await done;
});

test('owned availability enforces target validation and purity, permits retired snapshots and ignores disposed queries', async () => {
  const h = await setup(), { ui } = h, shown = ui.State(true); let named, boolean, selection;
  const queries = () => [() => named.availability('named'), () => boolean.availability(), () => selection.availability(1)];
  const Owner = ui.Component(scope => {
    named = scope.focus(); boolean = scope.focusBoolean(); selection = scope.focusSelection([1]);
    return () => { for (const query of queries()) assert.throws(query, /outside view bodies/); return ui.Text('owner'); };
  });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('removed'))); await tick();
  for (const query of queries()) { const derived = ui.Computed(query); assert.throws(() => derived.value, /Computed callbacks cannot read/); }
  const before = h.calls.length;
  for (const value of [null, '', 1, {}, '\ud800']) assert.throws(() => named.availability(value), /Focus names/);
  assert.throws(() => selection.availability(null), /non-null ID/); assert.throws(() => selection.availability('1'), /Unknown focus selection/); assert.equal(h.calls.length, before);
  const token = h.calls.find(c => c.op === 'focus.watch').token;
  h.emit({ type: 'focusChanged', token, sequence: ++h.focus.sequence, context: 2, generation: h.focus.generation ?? 0, name: 'sheet' }); await tick();
  assert.ok([named, boolean, selection].every(c => c.retired.value)); h.focus.availability = 'inactiveWindow';
  for (const query of queries()) assert.equal(query(), 'inactiveWindow');
  assert.ok([named, boolean, selection].every(c => c.retired.value)); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  shown.value = false; await tick(); const count = h.calls.length;
  assert.equal(named.availability({}), null); assert.equal(boolean.availability(), null); assert.equal(selection.availability({}), null); assert.equal(h.calls.length, count);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('owned availability applies per-controller task leases before validation and accepts explicit self-resumption', async () => {
  const h = await setup(), { ui } = h; let named, boolean, selection, release; const results = [];
  const Owner = ui.Component(scope => {
    named = scope.focus(); boolean = scope.focusBoolean(); selection = scope.focusSelection([1]);
    scope.task(async () => {
      await new Promise(resolve => { release = resolve; });
      results.push(named.availability({}), boolean.availability(), selection.availability(1));
      boolean.resume(); results.push(boolean.availability());
    });
    return () => ui.Text('owner');
  });
  const done = launch(ui, Owner()); await tick(); named.resume(); boolean.resume(); await tick();
  const before = h.calls.filter(c => c.op === 'focus.availability').length; release(); await tick();
  assert.deepEqual(results, [null, null, 'ready', 'ready']); assert.equal(h.calls.filter(c => c.op === 'focus.availability').length, before + 2);
  h.emit({ type: 'stop' }); await done;
});

test('focus subscription failure rolls back resources and listeners can remove siblings or add listeners during delivery', async () => {
  const h = await setup(), { ui } = h; h.focus.watchError = 'no mounted window';
  assert.throws(() => ui.Focus.subscribe(() => {}), /no mounted window/);
  assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  h.focus.watchError = null; const done = launch(ui, ui.Text('focus')), received = [];
  let stopSecond, stopThird;
  const stopFirst = ui.Focus.subscribe(name => { received.push(`first:${name}`); stopSecond(); stopThird ??= ui.Focus.subscribe(value => received.push(`third:${value}`)); });
  stopSecond = ui.Focus.subscribe(name => received.push(`second:${name}`));
  const token = h.calls.filter(c => c.op === 'focus.watch').at(-1).token;
  h.emit({ type: 'focusChanged', token, sequence: 1, context: 1, generation: 0, name: 'a' }); await tick(); assert.deepEqual(received, ['first:a']);
  h.emit({ type: 'focusChanged', token, sequence: 2, context: 1, generation: 0, name: 'b' }); await tick(); assert.deepEqual(received, ['first:a', 'first:b', 'third:b']);
  stopFirst(); stopThird(); h.emit({ type: 'stop' }); await done;
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('focus subscriptions respect reactive purity and effect/task cleanup including late subscriptions', async () => {
  const h = await setup(), { ui } = h, shown = ui.State(true); let release; const received = [];
  const Owner = ui.Component(scope => {
    scope.effect(() => ui.Focus.subscribe(name => received.push(name)));
    scope.task(async () => { ui.Focus.subscribe(name => received.push(name)); await new Promise(resolve => { release = resolve; }); ui.Focus.subscribe(() => assert.fail()); });
    return () => ui.Text('owner');
  });
  const done = launch(ui, ui.View(() => { assert.throws(() => ui.Focus.subscribe(() => {}), /outside view bodies/); return shown.value ? Owner() : ui.Text('hidden'); }));
  await tick(); assert.deepEqual(ui.__testing.focusStats(), { listeners: 2, watching: true });
  const derived = ui.Computed(() => ui.Focus.subscribe(() => {})); assert.throws(() => derived.value, /Computed callbacks cannot subscribe/);
  shown.value = false; await tick(); const before = h.calls.length; release(); await tick(); assert.equal(h.calls.length, before);
  assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  assert.equal(h.calls.filter(c => c.op === 'focus.unwatch').length, 1);
  h.emit({ type: 'stop' }); await done;
});

test('focus listener failures stop the app and release every subscription', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('focus'));
  ui.Focus.subscribe(() => { throw new Error('focus listener failed'); }); ui.Focus.subscribe(() => assert.fail('delivery must stop'));
  const token = h.calls.find(c => c.op === 'focus.watch').token;
  const failure = assert.rejects(done, /focus listener failed/);
  h.emit({ type: 'focusChanged', token, sequence: 1, context: 1, generation: 0, name: 'a' }); await failure;
  assert.equal(h.status(), 1); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('focus acknowledgements replace queued gains with newer blur/move results and reject older generations', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('focus')); h.focus.focused = true;
  const values = []; const stop = ui.Focus.subscribe(name => values.push(name));
  const token = h.calls.find(c => c.op === 'focus.watch').token;
  h.focus.sequence = 1;
  h.emit({ type: 'focusChanged', token, sequence: 1, context: 1, generation: 0, name: 'obsolete gain' });
  ui.Focus.clear(); assert.deepEqual(values, []); await tick(); assert.deepEqual(values, [], 'newer blur cancels pending gain before delivery');
  assert.deepEqual(h.calls.find(c => c.op === 'focus.move').focusRequest, { token, generation: 1 });
  ui.Focus.requestNamed('a'); ui.Focus.requestNamed('b'); assert.deepEqual(values, []); await tick(); assert.deepEqual(values, ['b']);
  h.emit({ type: 'focusChanged', token, sequence: 100, context: 1, generation: 1, name: 'older request' }); await tick(); assert.deepEqual(values, ['b']);
  h.focus.sequence = 5; ui.Focus.requestNamed('c');
  h.emit({ type: 'focusChanged', token, sequence: 5, context: 1, generation: 3, name: 'queued before acknowledgement' });
  await tick(); assert.deepEqual(values, ['b', 'c']);
  stop(); h.emit({ type: 'stop' }); await done;
});

test('focus delivery skips outdated siblings after reentrant requests and does not replay pending changes to new subscribers', async () => {
  const h = await setup(), { ui } = h, done = launch(ui, ui.Text('focus')); h.focus.focused = true;
  const first = [], second = [], joined = [];
  const stop = ui.Focus.subscribe(name => { first.push(name); if (name === 'a') ui.Focus.requestNamed('b'); });
  const stopSecond = ui.Focus.subscribe(name => second.push(name));
  ui.Focus.requestNamed('a'); await tick(); assert.deepEqual(first, ['a', 'b']); assert.deepEqual(second, ['b']);
  ui.Focus.requestNamed('c'); const stopJoined = ui.Focus.subscribe(name => joined.push(name));
  ui.Focus.requestNamed('c'); await tick(); assert.deepEqual(joined, [], 'same-name acknowledgement must not replay a pending change');
  ui.Focus.requestNamed('d'); stopSecond(); await tick(); assert.deepEqual(joined, ['d']); assert.deepEqual(second, ['b', 'c']);
  const roundTrip = []; ui.Focus.requestNamed('e'); const stopRoundTrip = ui.Focus.subscribe(name => roundTrip.push(name));
  ui.Focus.requestNamed('d'); await tick(); assert.deepEqual(roundTrip, ['d'], 'new listener sees a change even when older listeners coalesce a round trip');
  stop(); stopJoined(); stopRoundTrip(); h.emit({ type: 'stop' }); await done;
});

test('scoped focus controllers separate tracked intent from actual focus and apply requests after commit', async () => {
  const h = await setup(), { ui } = h; h.focus.name = 'parent'; h.focus.focused = true; let focus;
  const Owner = ui.Component(scope => { focus = scope.focus(); return () => ui.Text(`${focus.desired.value}:${focus.actual.value}:${focus.retired.value}`); });
  const done = launch(ui, Owner()); await tick();
  assert.equal(focus.actual.value, 'parent'); assert.equal(focus.desired.value, null); assert.equal(focus.retired.value, false);
  assert.ok(Object.isFrozen(focus)); assert.ok(Object.isFrozen(focus.desired)); assert.equal(focus.desired.binding, undefined);
  assert.throws(() => { focus.actual.value = 'bad'; }, TypeError); assert.throws(() => { focus.retired.value = true; }, TypeError);
  assert.ok(!h.calls.some(c => c.op === 'focus.move' || c.op === 'focus.named'), 'initial null is passive');
  focus.request('a'); assert.equal(focus.desired.value, 'a'); assert.equal(focus.actual.value, 'parent'); await tick();
  assert.equal(focus.actual.value, 'a'); assert.equal(h.calls.filter(c => c.op === 'focus.named').at(-1).focusRequest.context, 1);
  focus.request('a'); await tick(); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 2, 'same-name retry is explicit');
  const route = h.calls.filter(c => c.focusRequest).at(-1).focusRequest;
  h.emit({ type: 'focusChanged', token: route.token, sequence: ++h.focus.sequence, context: 1, generation: route.generation, name: 'user-selected' }); await tick();
  assert.equal(focus.actual.value, 'user-selected'); assert.equal(focus.desired.value, 'a'); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 2);
  focus.desired.value = 'b'; await tick(); assert.equal(focus.actual.value, 'b');
  focus.request(null); await tick(); assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, null);
  const before = h.calls.length;
  for (const name of ['', 1, true, {}, '\ud800']) { assert.throws(() => focus.request(name), /Focus names/); assert.throws(() => { focus.desired.value = name; }, /Focus names/); }
  assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('scoped focus controllers retire on context-only changes and cannot revive focus through desired writes', async () => {
  const h = await setup(), { ui } = h; let focus;
  const Owner = ui.Component(scope => { focus = scope.focus(); return () => ui.Text('owner'); });
  const done = launch(ui, Owner()); await tick(); const token = h.calls.find(c => c.op === 'focus.watch').token;
  h.emit({ type: 'focusChanged', token, sequence: ++h.focus.sequence, generation: 0, context: 2, name: null }); await tick();
  assert.equal(focus.retired.value, true); assert.equal(focus.actual.value, null); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  const before = h.calls.filter(c => c.focusRequest).length; focus.request('other-window'); focus.desired.value = 'retained intent'; await tick();
  assert.equal(focus.desired.value, 'retained intent'); assert.equal(h.calls.filter(c => c.focusRequest).length, before);
  h.emit({ type: 'stop' }); await done;
});

test('scoped focus requests reject a changed native context before its observation arrives', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; h.focus.name = 'parent'; let focus;
  const Owner = ui.Component(scope => { focus = scope.focus(); return () => ui.Text('owner'); });
  const done = launch(ui, Owner()); await tick(); h.focus.context = 2;
  focus.request('sheet'); await tick(); assert.equal(h.focus.name, 'parent'); assert.equal(focus.desired.value, 'sheet');
  assert.equal(focus.actual.value, null); assert.equal(focus.retired.value, true); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  h.emit({ type: 'stop' }); await done;
});

test('keyed focus controllers preserve identity, avoid feedback and dispose canceled owner work', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true;
  const shown = ui.State(true), reverse = ui.State(false), models = new Map(), gates = []; let setups = 0, disposed = 0;
  const Owner = ui.Component((scope, id) => {
    setups++; const focus = scope.focus(id); models.set(id, focus); scope.onDispose(() => { disposed++; });
    scope.task(async () => { await new Promise(resolve => gates.push(resolve)); focus.request('late'); focus.desired.value = 'late'; });
    return () => ui.Text(focus.actual.value ?? 'none');
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(reverse.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Owner(id)) : ui.Text('hidden')));
  await tick(); const original = models.get('a'); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 2);
  assert.equal(original.desired.value, 'a'); assert.equal(models.get('b').desired.value, 'b'); assert.equal(original.actual.value, 'b');
  reverse.value = true; await tick(); assert.equal(models.get('a'), original); assert.equal(setups, 2); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 2);
  shown.value = false; await tick(); const before = h.calls.length; gates.forEach(resolve => resolve()); await tick();
  assert.equal(h.calls.length, before); assert.equal(disposed, 2); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false }); assert.equal(h.states.size, 2);
  h.emit({ type: 'stop' }); await done;
});

test('focus controllers enforce setup/render/computed purity and clean up snapshot failures', async () => {
  const h = await setup(), { ui } = h; let focus, escaped;
  const Owner = ui.Component(scope => {
    escaped = scope; const before = h.calls.length; assert.throws(() => scope.focus(1), /Focus names/); assert.equal(h.calls.length, before);
    focus = scope.focus(); return () => {
      assert.throws(() => focus.request('bad'), /outside view bodies/); assert.throws(() => { focus.desired.value = 'bad'; }, /outside view bodies/);
      assert.throws(() => focus.resume(), /outside view bodies/);
      return ui.Text('owner');
    };
  });
  const done = launch(ui, Owner()); await tick(); assert.throws(() => escaped.focus(), /during component setup/);
  const derived = ui.Computed(() => focus.request('bad')); assert.throws(() => derived.value, /Computed callbacks cannot request scoped focus/);
  h.emit({ type: 'stop' }); await done;
  const failed = await setup(); failed.focus.snapshotError = 'snapshot unavailable';
  const Failing = failed.ui.Component(scope => { scope.focus(); return () => failed.ui.Text('owner'); });
  const app = launch(failed.ui, Failing()); await assert.rejects(app, /snapshot unavailable/);
  assert.deepEqual(failed.ui.__testing.focusStats(), { listeners: 0, watching: false }); assert.deepEqual(failed.ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  assert.ok(failed.calls.some(c => c.op === 'focus.unwatch'));
});

test('focus resume preserves identity and intent, is passive, and accepts fresh same-turn requests', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let focus;
  const Owner = ui.Component(scope => { focus = scope.focus('a'); return () => ui.Text(focus.actual.value ?? 'none'); });
  const done = launch(ui, Owner()); await tick(); const original = focus;
  h.focus.name = 'b'; h.focus.context = 2;
  const prior = h.calls.filter(c => c.focusRequest).at(-1).focusRequest;
  h.emit({ type: 'focusChanged', token: prior.token, sequence: ++h.focus.sequence, context: 2, generation: prior.generation, name: 'b' }); await tick();
  assert.equal(focus.retired.value, true); focus.resume(); await tick();
  assert.equal(focus, original); assert.equal(focus.retired.value, false); assert.equal(focus.actual.value, 'b'); assert.equal(focus.desired.value, 'a');
  assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 1, 'retained intent is not replayed');
  focus.request('obsolete'); focus.resume(); await tick(); assert.equal(focus.actual.value, 'b'); assert.equal(focus.desired.value, 'obsolete');
  assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 1, 'resume cancels requests queued before it');
  focus.resume(); focus.request('c'); await tick(); assert.equal(focus.actual.value, 'c');
  focus.resume(); focus.desired.value = 'd'; await tick(); assert.equal(focus.actual.value, 'd');
  focus.resume(); focus.request(null); await tick(); assert.equal(focus.actual.value, null);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('repeated resumes replace pending sessions and disposal prevents queued activation', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const shown = ui.State(true); let focus;
  const Owner = ui.Component(scope => { focus = scope.focus(); return () => ui.Text('owner'); });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('hidden'))); await tick();
  const token = h.calls.find(c => c.op === 'focus.watch').token;
  h.emit({ type: 'focusChanged', token, sequence: ++h.focus.sequence, context: 1, generation: 0, name: 'queued gain' });
  focus.resume(); focus.request('obsolete'); focus.resume(); await tick();
  assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, 'obsolete');
  assert.equal(h.calls.filter(c => c.op === 'focus.watch').length, 2); assert.ok(!h.calls.some(c => c.op === 'focus.named'));
  const starts = h.calls.filter(c => c.op === 'focus.watch').length;
  focus.resume(); shown.value = false; await tick(); focus.resume(); focus.request('late'); await tick();
  assert.equal(h.calls.filter(c => c.op === 'focus.watch').length, starts); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  h.emit({ type: 'stop' }); await done;
});

test('resume blocks earlier task writers while a task explicitly resuming can authorize its own requests', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const trigger = ui.State(0); const gates = []; let focus;
  const Owner = ui.Component(scope => {
    focus = scope.focus();
    scope.task(async () => { const current = trigger.value; await new Promise(resolve => gates.push(resolve)); focus.request(current ? 'fresh' : 'obsolete'); focus.desired.value = current ? 'fresh' : 'obsolete'; });
    scope.task(async () => { await new Promise(resolve => gates.push(resolve)); focus.resume(); focus.request('authorized'); });
    return () => ui.Text('owner');
  });
  const done = launch(ui, Owner()); await tick(); focus.resume(); await tick(); gates[0](); await tick();
  assert.equal(focus.desired.value, null); assert.ok(!h.calls.some(c => c.op === 'focus.named'));
  trigger.value = 1; await tick(); gates[2](); await tick(); assert.equal(focus.actual.value, 'fresh');
  gates[1](); await tick(); assert.equal(focus.actual.value, 'authorized'); assert.equal(focus.desired.value, 'authorized');
  const derived = ui.Computed(() => focus.resume()); assert.throws(() => derived.value, /Computed callbacks cannot resume scoped focus/);
  h.emit({ type: 'stop' }); await done;
});

test('RPC focus writes respect resumption leases and explicit RPC resumption', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const gates = []; let focus;
  const Owner = ui.Component(scope => {
    focus = scope.focus();
    return () => ui.WebView({ html: '', api: { async hold(explicit) {
      await new Promise(resolve => gates.push(resolve)); if (explicit) focus.resume();
      focus.request(explicit ? 'authorized RPC' : 'obsolete RPC'); focus.desired.value = explicit ? 'authorized RPC' : 'obsolete RPC';
    } } });
  });
  const done = launch(ui, Owner()); await tick(); const node = [...h.nodes.values()].find(n => n.kind === 'webview');
  const invoke = (call, explicit) => h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call, method: 'hold', args: [explicit] });
  invoke(1, false); invoke(2, true); focus.resume(); await tick(); gates[0](); await tick();
  assert.equal(focus.desired.value, null); assert.ok(!h.calls.some(c => c.op === 'focus.named'));
  gates[1](); await tick(); assert.equal(focus.actual.value, 'authorized RPC');
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('cancellation before commit suppresses queued focus requests and resumptions', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const resumeNow = ui.State(false); let focus, stopRequest, stopResume;
  const Owner = ui.Component(scope => {
    focus = scope.focus();
    stopRequest = scope.task(() => { focus.request('canceled request'); stopRequest(); });
    stopResume = scope.task(() => { if (!resumeNow.value) return; focus.resume(); focus.request('canceled resume'); stopResume(); });
    return () => ui.Text('owner');
  });
  const done = launch(ui, Owner()); await tick(); assert.ok(!h.calls.some(c => c.op === 'focus.named'));
  assert.equal(focus.retired.value, false); assert.deepEqual(ui.__testing.focusStats(), { listeners: 1, watching: true });
  resumeNow.value = true; await tick(); assert.ok(!h.calls.some(c => c.op === 'focus.named'));
  assert.equal(focus.retired.value, true); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  focus.resume(); focus.request('fresh'); await tick(); assert.equal(focus.actual.value, 'fresh');
  h.emit({ type: 'stop' }); await done;
});

test('document replacement cancels a queued RPC resumption before observer activation', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const html = ui.State('first'); let focus;
  const Owner = ui.Component(scope => {
    focus = scope.focus(); return () => ui.WebView({ html: html.value, api: { replace() { focus.resume(); focus.request('obsolete RPC'); html.value = 'replacement'; } } });
  });
  const done = launch(ui, Owner()); await tick(); const node = [...h.nodes.values()].find(n => n.kind === 'webview');
  h.emit({ type: 'webRequest', document: 'doc', id: node.id, epoch: node.props.rpcEpoch, call: 1, method: 'replace', args: [] }); await tick();
  assert.ok(!h.calls.some(c => c.op === 'focus.named')); assert.equal(focus.retired.value, true); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
  focus.resume(); await tick(); assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, 'obsolete RPC');
  h.emit({ type: 'stop' }); await done;
});

test('focus bindings wire names through modifiers, track actual booleans and keep projection objects off the native wire', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let focus, a, b;
  const Owner = ui.Component(scope => {
    focus = scope.focus(); a = focus.binding('a'); b = focus.binding('b'); const text = scope.state('');
    const before = h.calls.length;
    for (let i = 0; i < 20; i++) focus.binding('ephemeral'); assert.equal(h.calls.length, before, 'projection creation adds no cells or bridge work');
    return () => ui.VStack([
      ui.TextField('Name', { text: text.binding }).padding(4).disabled(false).focused(a),
      ui.TextEditor({ text: text.binding }).focused(b), ui.Text(`${a.value}:${b.value}`),
    ]);
  });
  const done = launch(ui, Owner()); await tick(); assert.ok(Object.isFrozen(a)); assert.equal(a.value, false);
  const fields = [...h.nodes.values()].filter(n => ['textfield', 'texteditor'].includes(n.kind));
  assert.deepEqual(fields.map(n => n.props.focusName), ['a', 'b']); assert.ok(fields.every(n => !('focusBinding' in n.props)));
  a.value = true; assert.equal(a.value, false); await tick(); assert.equal(a.value, true); assert.equal(b.value, false);
  assert.ok([...h.nodes.values()].some(n => n.kind === 'text' && n.props.value === 'true:false'));
  b.value = true; await tick(); assert.equal(a.value, false); assert.equal(b.value, true); assert.equal(focus.desired.value, 'b');
  b.value = false; await tick(); assert.equal(b.value, false); assert.equal(focus.desired.value, null);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('clearing a focus projection preserves newer pending intent and conditionally clears only its native target', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let a, b, focus;
  const Owner = ui.Component(scope => { focus = scope.focus('a'); a = focus.binding('a'); b = focus.binding('b'); return () => ui.Text('owner'); });
  const done = launch(ui, Owner()); await tick(); assert.equal(a.value, true);
  h.focus.name = 'b'; a.value = false; await tick(); assert.equal(h.focus.name, 'b'); assert.equal(b.value, true); assert.equal(focus.desired.value, null);
  assert.equal(h.calls.filter(c => c.op === 'focus.blurNamed').at(-1).name, 'a');
  a.value = true; b.value = true; a.value = false; assert.equal(focus.desired.value, 'b'); await tick(); assert.equal(b.value, true);
  a.value = true; a.value = false; await tick(); assert.equal(h.focus.name, 'b'); assert.equal(focus.desired.value, null, 'cancel queued a without blurring b');
  b.value = false; await tick(); assert.equal(h.focus.name, null);
  const before = h.calls.length; a.value = false; assert.equal(h.calls.length, before, 'already-unfocused false is inert');
  h.focus.focused = false; a.value = true; await tick(); assert.equal(focus.desired.value, 'a'); assert.equal(a.value, false);
  a.value = false; await tick(); assert.equal(focus.desired.value, null); assert.equal(h.focus.name, null, 'false cancels retained unavailable intent');
  h.emit({ type: 'stop' }); await done;
});

test('a canceled pending projection request does not hide a newer clear of the current target', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const trigger = ui.State(false); let a, b, stop;
  const Owner = ui.Component(scope => {
    const focus = scope.focus('a'); a = focus.binding('a'); b = focus.binding('b');
    stop = scope.task(() => { if (!trigger.value) return; b.value = true; stop(); });
    scope.effect(() => { if (trigger.value) a.value = false; });
    return () => ui.Text('owner');
  });
  const done = launch(ui, Owner()); await tick(); assert.equal(a.value, true);
  trigger.value = true; await tick(); assert.equal(a.value, false); assert.equal(b.value, false); assert.equal(h.focus.name, null);
  h.emit({ type: 'stop' }); await done;
});

test('focus projections validate brands, targets and lifetime without accepting native scalar bindings', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; const shown = ui.State(true), text = ui.State(''); let focus, binding;
  const Owner = ui.Component(scope => {
    focus = scope.focus(); binding = focus.binding('a');
    for (const name of ['', 1, true, {}, '\ud800']) assert.throws(() => focus.binding(name), /Focus names/);
    for (const invalid of [null, {}, true, text.binding]) assert.throws(() => ui.TextField('Name', { text: text.binding }).focused(invalid), /FocusBinding/);
    assert.throws(() => ui.VStack([]).focused(binding), /requires one text input/);
    assert.throws(() => ui.TextField('Name', { text: text.binding, focusName: 'other' }).focused(binding), /conflicts/);
    assert.throws(() => ui.TextField('Name', { text: text.binding }).sheet({ isPresented: shown.binding, content: ui.Text('sheet') }).focused(binding), /requires one text input/);
    return () => { assert.throws(() => { binding.value = true; }, /outside view bodies/); return ui.TextField('Name', { text: text.binding }).focused(binding); };
  });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('hidden'))); await tick();
  const before = h.calls.length; for (const value of [null, 1, 'true', {}]) assert.throws(() => { binding.value = value; }, /must be boolean/); assert.equal(h.calls.length, before);
  const derived = ui.Computed(() => { binding.value = true; return true; }); assert.throws(() => derived.value, /Computed callbacks cannot write projected focus/);
  focus.resume(); binding.value = true; await tick(); assert.equal(focus.actual.value, 'a');
  shown.value = false; await tick(); const count = h.calls.length; binding.value = true; assert.equal(h.calls.length, count);
  assert.throws(() => ui.TextField('Late', { text: text.binding }).focused(binding), /disposed FocusBinding/);
  assert.throws(() => focus.binding('late'), /disposed focus controller/);
  h.emit({ type: 'stop' }); await done;
});

test('focused views cannot escape their controller component subtree', async () => {
  const h = await setup(), { ui } = h; let projection;
  const text = ui.State(''), Owner = ui.Component(scope => { projection = scope.focus().binding('owned'); return () => ui.Text('owner'); });
  await assert.rejects(launch(ui, ui.VStack([Owner(), ui.View(() => ui.TextField('Sibling', { text: text.binding }).focused(projection))])), /descendants of their controller/);
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 }); assert.deepEqual(ui.__testing.focusStats(), { listeners: 0, watching: false });
});

test('boolean focus controllers generate distinct targets, keep intent separate and clear only their own target', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let a, b;
  const Owner = ui.Component(scope => {
    a = scope.focusBoolean(); b = scope.focusBoolean(true); const text = scope.state('');
    return () => ui.VStack([ui.TextField('A', { text: text.binding }).focused(a.binding), ui.TextField('B', { text: text.binding }).focused(b.binding), ui.Text(`${a.actual.value}/${b.actual.value}`)]);
  });
  const done = launch(ui, Owner()); await tick(); const names = [...h.nodes.values()].filter(n => n.kind === 'textfield').map(n => n.props.focusName);
  assert.equal(new Set(names).size, 2); assert.ok(names.every(n => typeof n === 'string' && n.length > 0));
  assert.equal(a.desired.value, false); assert.equal(b.desired.value, true); assert.equal(a.actual.value, false); assert.equal(b.actual.value, true);
  assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 1, 'false is passive');
  a.desired.value = true; await tick(); assert.equal(a.actual.value, true); assert.equal(b.actual.value, false); assert.equal(b.desired.value, true);
  const booleans = []; const stop = b.desired.subscribe(value => booleans.push(value)); b.desired.value = false; await tick();
  assert.equal(a.actual.value, true); assert.deepEqual(booleans, [false]); assert.equal(h.focus.name, names[0]);
  a.desired.value = false; await tick(); assert.equal(a.actual.value, false); assert.equal(h.focus.name, null);
  assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.desired)); assert.equal(a.desired.binding, undefined);
  assert.throws(() => { a.actual.value = true; }, TypeError); stop();
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('boolean focus desired writes are state-like while requests retry and resume is passive', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; h.focus.name = 'other'; let focus;
  const Owner = ui.Component(scope => { focus = scope.focusBoolean(); return () => ui.Text(`${focus.desired.value}:${focus.actual.value}`); });
  const done = launch(ui, Owner()); await tick(); focus.desired.value = true; assert.equal(focus.actual.value, false); await tick();
  assert.equal(focus.actual.value, true); const name = h.focus.name, before = h.calls.filter(c => c.op === 'focus.named').length;
  focus.desired.value = true; await tick(); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, before);
  focus.request(true); await tick(); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, before + 1);
  h.focus.name = 'other'; focus.desired.value = false; await tick(); assert.equal(h.focus.name, 'other'); assert.equal(focus.actual.value, false);
  const route = h.calls.filter(c => c.focusRequest).at(-1).focusRequest;
  h.focus.name = name; h.emit({ type: 'focusChanged', token: route.token, sequence: ++h.focus.sequence, context: 1, generation: route.generation, name }); await tick();
  assert.equal(focus.desired.value, false); assert.equal(focus.actual.value, true); focus.request(false); await tick(); assert.equal(h.focus.name, null);
  h.focus.focused = false; focus.desired.value = true; await tick(); assert.equal(focus.actual.value, false); assert.equal(focus.desired.value, true);
  focus.request(false); await tick(); assert.equal(focus.desired.value, false);
  h.focus.focused = true; focus.desired.value = true; await tick(); h.focus.name = 'other';
  focus.resume(); await tick(); assert.equal(focus.desired.value, true); assert.equal(focus.actual.value, false); assert.equal(h.focus.name, 'other');
  focus.resume(); focus.request(true); await tick(); assert.equal(focus.actual.value, true);
  const current = h.calls.filter(c => c.focusRequest).at(-1).focusRequest;
  h.emit({ type: 'focusChanged', token: current.token, sequence: ++h.focus.sequence, context: 2, generation: current.generation, name: 'sheet' }); await tick();
  assert.equal(focus.retired.value, true); assert.equal(focus.actual.value, false);
  const retiredRequests = h.calls.filter(c => c.focusRequest).length;
  focus.desired.value = false; await tick(); focus.desired.value = true; await tick();
  assert.equal(focus.desired.value, true); assert.equal(h.calls.filter(c => c.focusRequest).length, retiredRequests);
  h.focus.name = 'other'; focus.resume(); await tick(); assert.equal(focus.retired.value, false); assert.equal(focus.actual.value, false); assert.equal(h.focus.name, 'other');
  h.emit({ type: 'stop' }); await done;
});

test('boolean focus controllers validate setup/purity, preserve leases and ignore disposed writers', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let focus, escaped, release; const shown = ui.State(true);
  const Owner = ui.Component(scope => {
    escaped = scope; const before = h.calls.length;
    for (const initial of [null, 0, 'false', {}]) assert.throws(() => scope.focusBoolean(initial), /must be boolean/); assert.equal(h.calls.length, before);
    focus = scope.focusBoolean(); scope.task(async () => { await new Promise(resolve => { release = resolve; }); focus.request(true); focus.desired.value = true; });
    return () => { assert.throws(() => focus.request(true), /outside view bodies/); assert.throws(() => { focus.desired.value = true; }, /outside view bodies/); return ui.Text('owner'); };
  });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('hidden'))); await tick();
  assert.throws(() => escaped.focusBoolean(), /during component setup/); assert.throws(() => focus.desired.subscribe(null), /listener/);
  for (const value of [null, 1, 'true', {}]) { assert.throws(() => { focus.desired.value = value; }, /must be boolean/); assert.throws(() => focus.request(value), /must be boolean/); }
  const derived = ui.Computed(() => { focus.desired.value = true; return true; }); assert.throws(() => derived.value, /Computed callbacks cannot write boolean desired focus/);
  focus.resume(); await tick(); const before = h.calls.length; release(); await tick(); assert.equal(h.calls.length, before); assert.equal(focus.desired.value, false);
  shown.value = false; await tick(); const count = h.calls.length; focus.desired.value = true; focus.request(true); focus.resume(); assert.equal(h.calls.length, count);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('selection focus preserves typed IDs, snapshots its domain and separates observed selection from intent', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; h.focus.name = 'unrelated'; let focus;
  const domain = [1, '1', '', 'café', 'cafe\u0301'];
  const Owner = ui.Component(scope => {
    focus = scope.focusSelection(domain); const text = scope.state('');
    return () => ui.VStack(domain.map(id => ui.TextField('Same label', { text: text.binding }).focused(focus.binding(id))));
  });
  const done = launch(ui, Owner()); await tick();
  const names = [...h.nodes.values()].filter(node => node.kind === 'textfield').map(node => node.props.focusName);
  assert.equal(new Set(names).size, 5); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, 0);
  assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, null);
  domain.push('added later'); assert.throws(() => focus.binding('added later'), /Unknown focus selection/); domain.pop();
  const changes = []; const stop = focus.desired.subscribe(value => changes.push(value));
  focus.desired.value = 1; assert.equal(focus.actual.value, null); await tick(); assert.equal(focus.actual.value, 1); assert.equal(h.focus.name, names[0]);
  const before = h.calls.filter(c => c.op === 'focus.named').length; focus.desired.value = 1; await tick(); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, before);
  focus.request(1); await tick(); assert.equal(h.calls.filter(c => c.op === 'focus.named').length, before + 1);
  focus.binding('1').value = true; await tick(); assert.equal(focus.actual.value, '1'); assert.equal(focus.desired.value, '1'); assert.equal(h.focus.name, names[1]);
  focus.binding(1).value = false; await tick(); assert.equal(focus.actual.value, '1'); assert.equal(focus.desired.value, '1');
  focus.binding('1').value = false; await tick(); assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, null);
  for (let index = 2; index < domain.length; index++) { focus.request(domain[index]); await tick(); assert.equal(focus.actual.value, domain[index]); assert.equal(h.focus.name, names[index]); }
  assert.deepEqual(changes, [1, '1', null, '', 'café', 'cafe\u0301']); stop();
  const route = h.calls.filter(c => c.focusRequest).at(-1).focusRequest;
  h.focus.name = 'unrelated'; h.emit({ type: 'focusChanged', token: route.token, sequence: ++h.focus.sequence, context: 1, generation: route.generation, name: 'unrelated' }); await tick();
  assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, 'cafe\u0301');
  focus.request(null); await tick(); assert.equal(h.focus.name, null); assert.equal(focus.desired.value, null);
  assert.ok(Object.isFrozen(focus)); assert.ok(Object.isFrozen(focus.desired)); assert.throws(() => { focus.actual.value = 1; }, TypeError);
  assert.equal(focus.desired.binding, undefined);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('selection focus validates before allocation, handles empty domains and normalizes signed zero', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let empty, focus;
  const Owner = ui.Component(scope => {
    const before = h.calls.length;
    for (const values of [null, {}, 'abc', [null], [true], [{}], [undefined], ['\ud800'], [NaN], [Infinity], [1, 1], [0, -0], ['a', 'a'], Array(1)])
      assert.throws(() => scope.focusSelection(values), /Focus selection|focus selection/);
    assert.throws(() => scope.focusSelection([1], '1'), /Unknown focus selection/); assert.equal(h.calls.length, before);
    empty = scope.focusSelection([]); focus = scope.focusSelection([0], -0);
    return () => ui.Text(`${empty.actual.value}/${focus.actual.value}`);
  });
  const done = launch(ui, Owner()); await tick(); assert.equal(empty.actual.value, null); assert.equal(empty.desired.value, null);
  assert.equal(Object.is(focus.actual.value, 0), true); assert.equal(Object.is(focus.desired.value, 0), true);
  const before = h.calls.length;
  for (const invalid of [undefined, '0', 1, NaN, false, {}]) {
    assert.throws(() => { focus.desired.value = invalid; }, /Unknown focus selection/);
    assert.throws(() => focus.request(invalid), /Unknown focus selection/); assert.throws(() => focus.binding(invalid), /Unknown focus selection/);
  }
  assert.throws(() => focus.binding(null), /non-null/); assert.throws(() => empty.request('anything'), /Unknown focus selection/);
  assert.throws(() => focus.desired.subscribe(null), /listener/); assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done;
});

test('selection focus inherits purity, retirement, passive resume and stale task/disposal guards', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let focus, scopeRef, release; const shown = ui.State(true);
  const Owner = ui.Component(scope => {
    scopeRef = scope; focus = scope.focusSelection([1, 'two'], 1);
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); focus.request('obsolete invalid ID'); focus.desired.value = {}; });
    return () => { assert.throws(() => focus.request(1), /outside view bodies/); assert.throws(() => { focus.desired.value = 1; }, /outside view bodies/); return ui.Text(`${focus.actual.value}`); };
  });
  const done = launch(ui, ui.View(() => shown.value ? Owner() : ui.Text('hidden'))); await tick();
  assert.throws(() => scopeRef.focusSelection([1]), /during component setup/);
  const derived = ui.Computed(() => { focus.desired.value = 1; return 1; }); assert.throws(() => derived.value, /Computed callbacks cannot write desired focus selection/);
  focus.resume(); await tick(); const before = h.calls.length; release(); await tick(); assert.equal(h.calls.length, before); assert.equal(focus.desired.value, 1);
  const route = h.calls.filter(c => c.op === 'focus.snapshot').at(-1);
  h.emit({ type: 'focusChanged', token: route.token, sequence: ++h.focus.sequence, context: 2, generation: h.focus.generation, name: 'sheet' }); await tick();
  assert.equal(focus.retired.value, true); assert.equal(focus.actual.value, null);
  focus.desired.value = 'two'; focus.request('invalid retired ID'); await tick(); assert.equal(focus.desired.value, 'two');
  h.focus.name = 'outside'; focus.resume(); await tick(); assert.equal(focus.retired.value, false); assert.equal(focus.actual.value, null); assert.equal(focus.desired.value, 'two'); assert.equal(h.focus.name, 'outside');
  focus.resume(); focus.request('two'); await tick(); assert.equal(focus.actual.value, 'two');
  shown.value = false; await tick(); const after = h.calls.length;
  focus.request('invalid after disposal'); focus.desired.value = {}; focus.resume(); assert.equal(h.calls.length, after); assert.throws(() => focus.binding(1), /disposed/);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('Stepper and Picker support named and owned projected focus without sending projection objects', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let focus, number;
  const Owner = ui.Component(scope => {
    focus = scope.focus(); number = scope.state(2); const choice = scope.state('a');
    return () => ui.VStack([
      ui.Stepper('Same label', { value: number.binding, focusName: 'café' }),
      ui.Picker('Same label', { selection: choice.binding, options: [{ value: 'a', label: 'Alpha' }], focusName: 'cafe\u0301' }),
      ui.Stepper('Projected', { value: number.binding }).padding(2).focused(focus.binding('count')),
      ui.Picker('Projected', { selection: choice.binding, options: [] }).focused(focus.binding('choice')).disabled(true),
    ]);
  });
  const done = launch(ui, Owner()); await tick(); const nodes = [...h.nodes.values()].filter(n => ['stepper', 'picker'].includes(n.kind));
  assert.deepEqual(nodes.map(n => n.props.focusName), ['café', 'cafe\u0301', 'count', 'choice']);
  assert.ok(nodes.every(n => !('focusBinding' in n.props))); assert.equal(h.states.size, 7);
  focus.binding('choice').value = true; await tick(); assert.equal(focus.actual.value, 'choice');
  assert.throws(() => ui.Stepper('Conflict', { value: number.binding, focusName: 'other' }).focused(focus.binding('count')), /conflicts/);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('choice focus rejects invalid names and keeps unsupported custom native surfaces explicit', async () => {
  const h = await setup(), { ui } = h; const number = ui.State(1), choice = ui.State('a'); const before = h.calls.length;
  for (const name of ['', true, 1, {}, null, '\ud800']) {
    assert.throws(() => ui.Stepper('Count', { value: number.binding, focusName: name }), /Focus names/);
    assert.throws(() => ui.Picker('Choice', { selection: choice.binding, options: [], focusName: name }), /Focus names/);
  }
  assert.throws(() => ui.Slider('Level', { value: number.binding, focusName: 'slider' }), /Unknown slider option/);
  assert.equal(h.calls.length, before);
  let binding;
  const Owner = ui.Component(scope => { binding = scope.focus().binding('unsupported'); return () => ui.Text('owner'); });
  const done = launch(ui, Owner()); await tick();
  for (const view of [ui.Slider('Level', { value: number.binding }), ui.Button('Button', () => {}), ui.Toggle('Toggle', { isOn: ui.State(true).binding })]) assert.throws(() => view.focused(binding), /focused requires/);
  h.emit({ type: 'stop' }); await done;
});

test('disabled validates flags before transport and property changes preserve scoped bindings/actions', async () => {
  const h = await setup(), { ui } = h;
  const child = ui.Text('passive'); assert.deepEqual(child.disabled().props, { name: 'disabled', value: true });
  assert.deepEqual(child.disabled(false).props, { name: 'disabled', value: false }); assert.equal(child.kind, 'text');
  const before = h.calls.length;
  for (const value of [null, 0, 1, 'true', {}, []]) assert.throws(() => child.disabled(value), /boolean/);
  assert.equal(h.calls.length, before);
  const blocked = ui.State(false), shown = ui.State(true); let model, setups = 0, disposals = 0;
  const Panel = ui.Component(scope => {
    setups++; model = scope.state('name'); scope.onDispose(() => { disposals++; });
    return () => ui.VStack([ui.TextField('Name', { text: model.binding }), ui.Button('Action', () => {})]).disabled(blocked.value);
  });
  const done = launch(ui, ui.View(() => shown.value ? Panel() : ui.Text('hidden')));
  const original = model, disabled = [...h.nodes.values()].find(n => n.props.name === 'disabled');
  blocked.value = true; await tick(); assert.equal(h.nodes.get(disabled.id).props.value, true);
  assert.equal(model, original); assert.equal(setups, 1); assert.equal(ui.__testing.stats().actions, 1);
  shown.value = false; await tick(); assert.equal(disposals, 1); assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 2);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('focusSection is an immutable native modifier with no options, cells or callbacks', async () => {
  const h = await setup(), { ui } = h;
  const child = ui.Text('passive'), section = child.focusSection();
  assert.equal(child.kind, 'text'); assert.deepEqual(section.props, { name: 'focusSection' });
  assert.deepEqual(section.children, [child]); assert.ok(Object.isFrozen(section));
  const before = h.calls.length;
  for (const arg of [true, false, undefined, {}, { enabled: true }]) assert.throws(() => child.focusSection(arg), /no arguments/);
  assert.equal(h.calls.length, before);
  const done = launch(ui, section.padding(4));
  assert.ok([...h.nodes.values()].some(n => n.props.name === 'focusSection' && n.children.length === 1));
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('keyed focus sections preserve scoped state and callbacks through reorder and release all owners', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), reversed = ui.State(false), models = new Map(); let setups = 0, disposals = 0;
  const Group = ui.Component((scope, id) => {
    setups++; const value = scope.state(id); models.set(id, value); scope.onDispose(() => { disposals++; });
    return () => ui.VStack([ui.TextField(id, { text: value.binding, onSubmit: () => {} }), ui.Text(value.value)]).focusSection();
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.HStack([ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Group(id))]) : ui.Text('hidden')));
  const sections = [...h.nodes.values()].filter(n => n.props.name === 'focusSection'), first = models.get('a');
  first.value = 'Section 🦊 café'; reversed.value = true; await tick();
  assert.equal(models.get('a'), first); assert.equal(setups, 2); assert.equal(ui.__testing.stats().actions, 2);
  for (const node of sections) assert.equal(h.nodes.get(node.id).props.name, 'focusSection');
  shown.value = false; await tick(); assert.equal(disposals, 2); assert.equal(h.states.size, 2); assert.equal(ui.__testing.stats().actions, 0);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('Tab routing is opt-in, snapshots boolean options, and rejects malformed options before bridge calls', async () => {
  const h = await setup(), { ui } = h; h.focus.target = 1;
  const target = ui.Focus.capture(), options = { tabNavigation: true }, done = launch(ui, ui.Text('Tab cycle'));
  assert.equal(ui.Focus.setTraversal([target], options), true); options.tabNavigation = false;
  assert.deepEqual(h.calls.at(-1), { op: 'focus.traversal', targets: [1], tabNavigation: true });
  assert.equal(ui.Focus.setTraversal([target]), true); assert.deepEqual(h.calls.at(-1), { op: 'focus.traversal', targets: [1] });
  ui.Focus.setTraversal([], { tabNavigation: false }); assert.deepEqual(h.calls.at(-1), { op: 'focus.traversal', targets: [], tabNavigation: false });
  const before = h.calls.length;
  for (const invalid of [null, [], { unknown: true }, { tabNavigation: 1 }, { tabNavigation: 'true' }, { tabNavigation: null }]) assert.throws(() => ui.Focus.setTraversal([target], invalid), TypeError);
  assert.equal(h.calls.length, before); h.emit({ type: 'stop' }); await done;
});

test('explicit Focus traversal serializes captured targets, clears with [] and validates distinct native identities', async () => {
  const h = await setup(), { ui } = h;
  const done = launch(ui, ui.Text('traversal'));
  h.focus.target = 7; const first = ui.Focus.capture(), sameControl = ui.Focus.capture();
  h.focus.target = 8; const second = ui.Focus.capture(), targets = [second, first];
  assert.equal(ui.Focus.setTraversal(targets), true); targets.reverse();
  assert.deepEqual(h.calls.at(-1), { op: 'focus.traversal', targets: [8, 7] });
  const before = h.calls.length;
  for (const invalid of [null, undefined, {}, new Set([first]), [null], [{}], new Array(1), [first, first], [first, sameControl]]) assert.throws(() => ui.Focus.setTraversal(invalid), TypeError);
  assert.equal(h.calls.length, before);
  h.focus.configured = false; assert.equal(ui.Focus.setTraversal([first]), false);
  h.focus.configured = true; assert.equal(ui.Focus.setTraversal(Object.freeze([])), true);
  assert.deepEqual(h.calls.at(-1), { op: 'focus.traversal', targets: [] });
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done; const stoppedAt = h.calls.length;
  assert.equal(ui.Focus.setTraversal([first]), false); assert.equal(h.calls.length, stoppedAt);
});

test('explicit focus traversal rejects foreign handles and render/computed writes before bridge work', async () => {
  const h = await setup(), { ui } = h; h.focus.target = 1;
  const first = ui.Focus.capture(), other = await setup(); other.focus.target = 2;
  const foreign = other.ui.Focus.capture(), before = h.calls.length;
  assert.throws(() => ui.Focus.setTraversal([foreign]), /captured FocusTargets/);
  const computed = ui.Computed(() => ui.Focus.setTraversal([], { tabNavigation: true }));
  assert.throws(() => computed.value, /Computed callbacks cannot move focus/);
  const done = launch(ui, ui.View(() => { ui.Focus.setTraversal([first]); return ui.Text('bad'); }, { fallback: e => ui.Text(e.message) }));
  assert.ok([...h.nodes.values()].some(n => n.props.value === 'Move focus outside view bodies'));
  assert.ok(!h.calls.slice(before).some(c => c.op === 'focus.traversal'));
  h.emit({ type: 'stop' }); await done;
});

test('effects can configure traversal but canceled tasks cannot replace the remaining app cycle', async () => {
  const h = await setup(), { ui } = h; h.focus.target = 1;
  const target = ui.Focus.capture(), shown = ui.State(true); let release, result;
  const Child = ui.Component(scope => {
    scope.effect(() => { ui.Focus.setTraversal([target], { tabNavigation: true }); });
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); result = ui.Focus.setTraversal([], { tabNavigation: true }); });
    return () => ui.Text('mounted');
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden'))); await tick();
  assert.equal(h.calls.filter(c => c.op === 'focus.traversal').length, 1);
  shown.value = false; await tick(); const before = h.calls.length; release(); await tick();
  assert.equal(result, false); assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done;
});

test('opaque Focus targets capture native handles without exposing IDs, accept only this runtime and release after shutdown', async () => {
  const h = await setup(), { ui } = h;
  const done = launch(ui, ui.Text('targets'));
  assert.equal(ui.Focus.capture(), null); h.focus.target = 42;
  const target = ui.Focus.capture(); assert.deepEqual(target, {}); assert.ok(Object.isFrozen(target));
  h.focus.focused = true; assert.equal(ui.Focus.request(target), true);
  assert.deepEqual(h.calls.at(-1), { op: 'focus.target', target: 42 });
  h.focus.focused = false; assert.equal(ui.Focus.request(target), false);
  for (const invalid of [null, 42, true, {}, Object.create(target), JSON.parse(JSON.stringify(target))]) assert.throws(() => ui.Focus.request(invalid), /captured FocusTarget/);
  const other = await setup(); assert.throws(() => other.ui.Focus.request(target), /captured FocusTarget/);
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done; const before = h.calls.length;
  assert.equal(ui.Focus.capture(), null); assert.equal(ui.Focus.request(target), false); assert.equal(h.calls.length, before);
});

test('Focus capture/request respect computed/render purity before sending bridge requests', async () => {
  const h = await setup(), { ui } = h; h.focus.target = 1;
  const target = ui.Focus.capture(), before = h.calls.length;
  const computed = ui.Computed(() => ui.Focus.capture());
  assert.throws(() => computed.value, /Computed callbacks cannot move focus/);
  const done = launch(ui, ui.View(() => { ui.Focus.request(target); return ui.Text('bad'); }, { fallback: e => ui.Text(e.message) }));
  assert.ok([...h.nodes.values()].some(n => n.props.value === 'Move focus outside view bodies'));
  assert.ok(!h.calls.slice(before).some(c => c.op.startsWith('focus.')));
  h.emit({ type: 'stop' }); await done;
});

test('canceled tasks cannot capture or restore an opaque focus target', async () => {
  const h = await setup(), { ui } = h; h.focus.target = 1;
  const target = ui.Focus.capture(), shown = ui.State(true); let release, result;
  const Child = ui.Component(scope => {
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); result = [ui.Focus.capture(), ui.Focus.request(target)]; });
    return () => ui.Text('mounted');
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden'))); await tick();
  shown.value = false; await tick(); const before = h.calls.length; release(); await tick();
  assert.deepEqual(result, [null, false]); assert.equal(h.calls.length, before);
  h.emit({ type: 'stop' }); await done;
});

test('Focus commands use native traversal without cells or callback registrations and stop after shutdown', async () => {
  const h = await setup(), { ui } = h;
  const done = launch(ui, ui.Text('Focus commands'));
  assert.ok(Object.isFrozen(ui.Focus)); ui.Focus.next(); ui.Focus.previous(); ui.Focus.clear();
  assert.deepEqual(h.calls.filter(c => c.op === 'focus.move').map(c => c.direction), ['next', 'previous', 'clear']);
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done; const before = h.calls.length;
  ui.Focus.next(); ui.Focus.clear(); assert.equal(h.calls.length, before);
});

test('Focus commands respect render and computed purity with recoverable diagnostics', async () => {
  const h = await setup(), { ui } = h;
  const computed = ui.Computed(() => { ui.Focus.clear(); return false; });
  assert.throws(() => computed.value, /Computed callbacks cannot move focus/);
  const done = launch(ui, ui.View(() => { ui.Focus.next(); return ui.Text('bad'); }, { fallback: e => ui.Text(e.message) }));
  assert.ok([...h.nodes.values()].some(n => n.props.value === 'Move focus outside view bodies'));
  assert.equal(h.calls.filter(c => c.op === 'focus.move').length, 0);
  h.emit({ type: 'stop' }); await done;
});

test('Focus commands run from effects but canceled tasks cannot move the remaining app focus', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true); let release;
  const Child = ui.Component(scope => {
    scope.effect(() => { ui.Focus.next(); });
    scope.task(async () => { await new Promise(resolve => { release = resolve; }); ui.Focus.previous(); });
    return () => ui.Text('mounted');
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden'))); await tick();
  assert.equal(h.calls.filter(c => c.op === 'focus.move').length, 1);
  shown.value = false; await tick(); release(); await tick();
  assert.equal(h.calls.filter(c => c.op === 'focus.move').length, 1);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('lazy grids snapshot typed tracks, defaults, alignment and children without callbacks or cells', async () => {
  const h = await setup(), { ui } = h;
  const tracks = [{ size: 'fixed', value: 80, spacing: 8, alignment: 'topLeading' }, { size: 'flexible' }, { size: 'adaptive', min: 90, max: 150 }];
  const children = [ui.Text('original')], grid = ui.LazyVGrid(children, { columns: tracks, alignment: 'trailing', spacing: 12 });
  tracks[0].value = 400; tracks.push({ size: 'fixed', value: 20 }); children.length = 0;
  assert.ok(Object.isFrozen(grid.props.tracks) && grid.props.tracks.every(Object.isFrozen));
  const done = launch(ui, ui.VStack([grid, ui.LazyHGrid([], { rows: [{ size: 'flexible', min: 0, max: 0 }], alignment: 'firstTextBaseline' })]));
  const vertical = [...h.nodes.values()].find(n => n.kind === 'lazyvgrid'), horizontal = [...h.nodes.values()].find(n => n.kind === 'lazyhgrid');
  assert.equal(vertical.children.length, 1); assert.equal(vertical.props.alignment, 'trailing'); assert.equal(vertical.props.spacing, 12);
  assert.deepEqual(vertical.props.tracks, [{ size: 'fixed', value: 80, spacing: 8, alignment: 'topLeading' }, { size: 'flexible', min: 10, max: 'infinity' }, { size: 'adaptive', min: 90, max: 150 }]);
  assert.deepEqual(horizontal.props, { tracks: [{ size: 'flexible', min: 0, max: 0 }], alignment: 'firstTextBaseline' });
  assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 0);
  h.emit({ type: 'stop' }); await done;
});

test('grids reject malformed tracks and nonfinite, negative, or inconsistent dimensions before serialization', async () => {
  const h = await setup(), { ui } = h, before = h.calls.length;
  const invalid = [undefined, null, [], {}, new Array(1), [null], [{ size: 'unknown' }], [{ size: 'fixed' }],
    ...[-1, true, null, NaN, Infinity, 'infinity'].map(value => [{ size: 'fixed', value }]),
    [{ size: 'fixed', value: 10, min: 0 }], [{ size: 'flexible', value: 10 }], [{ size: 'adaptive' }],
    ...[0, -1, true, null, NaN, Infinity].map(min => [{ size: 'adaptive', min }]),
    ...[-1, true, null, NaN, Infinity].map(min => [{ size: 'flexible', min }]),
    ...[-1, true, null, NaN, Infinity, 'maximum'].map(max => [{ size: 'flexible', max }]),
    [{ size: 'flexible', min: 11, max: 10 }], [{ size: 'adaptive', min: 20, max: 10 }],
    [{ size: 'fixed', value: 10, spacing: -1 }], [{ size: 'fixed', value: 10, alignment: 'left' }],
    [{ size: 'flexible', unknown: true }],
  ];
  for (const [create, axis, wrongAxis] of [[ui.LazyVGrid, 'columns', 'rows'], [ui.LazyHGrid, 'rows', 'columns']]) {
    for (const tracks of invalid) assert.throws(() => create([], { [axis]: tracks }), TypeError);
    for (const spacing of [-1, true, null, NaN, Infinity]) assert.throws(() => create([], { [axis]: [{ size: 'fixed', value: 10 }], spacing }), TypeError);
    assert.throws(() => create([], { [wrongAxis]: [{ size: 'fixed', value: 10 }] }), /Unknown/);
  }
  assert.throws(() => ui.LazyVGrid([], { columns: [{ size: 'flexible' }], alignment: 'top' }), /alignment/);
  assert.throws(() => ui.LazyHGrid([], { rows: [{ size: 'flexible' }], alignment: 'leading' }), /alignment/);
  assert.equal(h.calls.length, before);
});

test('keyed grid cells retain scopes and actions across track replacement/reordering and dispose on removal', async () => {
  const h = await setup(), { ui } = h;
  const ids = ui.State(['a', 'b']), tracks = ui.State([{ size: 'fixed', value: 80 }]);
  const instances = new Map(); let setups = 0, disposals = 0, submits = 0;
  const Cell = ui.Component((scope, id) => {
    setups++; const value = scope.state(id); instances.set(id, value); scope.onDispose(() => { disposals++; });
    return () => ui.TextField(id, { text: value.binding, onSubmit: () => { submits++; } });
  });
  const done = launch(ui, ui.View(() => ui.LazyVGrid([ui.ForEach(ids.value, { id: id => id }, id => Cell(id))], { columns: tracks.value })));
  const a = instances.get('a'), input = [...h.nodes.values()].find(n => n.props.title === 'a');
  a.value = 'Unicode 🦊'; tracks.value = [{ size: 'adaptive', min: 90 }]; ids.value = ['b', 'a']; await tick();
  assert.equal(setups, 2); assert.equal(instances.get('a'), a); assert.equal(h.nodes.get(input.id).props.submit, input.props.submit);
  const id = a.binding.id; ids.value = ['b']; await tick(); assert.equal(disposals, 1); assert.equal(h.states.size, 3); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'textSubmit', id: input.id, token: input.props.submit, state: { id, value: 'late', revision: 1 } }); assert.equal(submits, 0);
  h.emit({ type: 'stop' }); await done; assert.equal(disposals, 2); assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('invalid dynamic grid tracks recover and release partial sibling mounts without malformed native commits', async () => {
  const h = await setup(), { ui } = h;
  const broken = ui.State(true); let disposals = 0;
  const Child = ui.Component(scope => {
    const text = scope.state('owned'); scope.onDispose(() => { disposals++; });
    return () => ui.TextField('Partial', { text: text.binding, onSubmit: () => {} });
  });
  const done = launch(ui, ui.View(() => ui.VStack([
    Child(), ui.View(() => ui.LazyHGrid([], { rows: [{ size: 'adaptive', min: broken.value ? 0 : 80 }] })),
  ]), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.equal(disposals, 1); assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 1);
  assert.ok(!h.calls.some(c => c.op === 'commit' && c.nodes.some(n => n.kind === 'lazyhgrid')));
  broken.value = false; await tick(); assert.ok([...h.nodes.values()].some(n => n.kind === 'lazyhgrid')); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'stop' }); await done; assert.equal(disposals, 2);
});

test('lazy stacks copy children/options and serialize axis-specific alignment without extra registrations', async () => {
  const h = await setup(), { ui } = h;
  const options = { alignment: 'leading', spacing: 4 }, children = [ui.Text('original')];
  const vertical = ui.LazyVStack(children, options); options.spacing = 99; children.push(ui.Text('outside'));
  const done = launch(ui, ui.VStack([vertical, ui.LazyHStack([ui.Text('horizontal')], { alignment: 'firstTextBaseline', spacing: -2 }), ui.LazyVStack([]), ui.LazyHStack([])]));
  const nodes = [...h.nodes.values()];
  const v = nodes.find(n => n.kind === 'lazyvstack'), horizontal = nodes.find(n => n.kind === 'lazyhstack');
  assert.deepEqual(v.props, { alignment: 'leading', spacing: 4 }); assert.equal(v.children.length, 1);
  assert.deepEqual(horizontal.props, { alignment: 'firstTextBaseline', spacing: -2 });
  assert.deepEqual(nodes.filter(n => n.kind === 'lazyvstack').at(-1).props, {});
  assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 0);
  h.emit({ type: 'stop' }); await done;
});

test('lazy stacks reject unsupported alignment, flags and nonfinite spacing before bridge calls', async () => {
  const h = await setup(), { ui } = h, before = h.calls.length;
  for (const create of [ui.LazyVStack, ui.LazyHStack]) {
    for (const options of [{ spacing: NaN }, { spacing: Infinity }, { spacing: true }, { alignment: 'left' }, { pinnedViews: true }, null, []]) assert.throws(() => create([], options), TypeError);
  }
  assert.throws(() => ui.LazyVStack([], { alignment: 'top' }), /alignment/);
  assert.throws(() => ui.LazyHStack([], { alignment: 'leading' }), /alignment/);
  assert.equal(h.calls.length, before);
});

test('lazy keyed scopes preserve identity across updates and dispose removed rows, failed mounts and shutdown', async () => {
  const h = await setup(), { ui } = h;
  const ids = ui.State(['a', 'b']), spacing = ui.State(4), broken = ui.State(false);
  const instances = new Map(); let setups = 0, disposals = 0, calls = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const text = scope.state(id); instances.set(id, text); scope.onDispose(() => { disposals++; });
    return () => ui.TextField(id, { text: text.binding, onSubmit: () => { calls++; } });
  });
  const done = launch(ui, ui.View(() => ui.LazyVStack([
    ui.ForEach(ids.value, { id: id => id }, id => Row(id)),
    ui.View(() => { if (broken.value) throw new Error('partial lazy mount'); return ui.Text('footer'); }),
  ], { spacing: spacing.value }), { fallback: error => ui.Text(error.message) }));
  const a = instances.get('a'), field = [...h.nodes.values()].find(n => n.props.title === 'a');
  a.value = 'Unicode 🦊'; ids.value = ['b', 'a']; spacing.value = 12; await tick();
  assert.equal(instances.get('a'), a); assert.equal(setups, 2); assert.equal(h.nodes.get(field.id).props.state, a.binding.id);
  const stateID = field.props.state;
  ids.value = ['b']; await tick(); assert.equal(disposals, 1); assert.equal(h.states.size, 4); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'textSubmit', id: field.id, token: field.props.submit, state: { id: stateID, value: 'late', revision: 99 } }); assert.equal(calls, 0);
  broken.value = true; await tick(); assert.equal(disposals, 2); assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 3);
  broken.value = false; await tick(); assert.equal(setups, 3); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'stop' }); await done; assert.equal(disposals, 3); assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('editing callbacks synchronize snapshots on every text input and keep current handlers independent of submit', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('initial'), version = ui.State(0), events = [];
  const done = launch(ui, ui.View(() => {
    const current = version.value;
    const options = { text: text.binding, onEditingChanged: function (editing) { assert.equal(this, undefined); events.push([current, editing, text.value]); } };
    return ui.VStack([ui.TextField('Plain', { ...options, onSubmit: () => events.push('submit') }), ui.SecureField('Secret', options), ui.TextEditor(options)]);
  }));
  const inputs = [...h.nodes.values()].filter(n => ['textfield', 'securefield', 'texteditor'].includes(n.kind));
  assert.equal(inputs.length, 3); assert.equal(ui.__testing.stats().actions, 4);
  for (const node of inputs) {
    assert.equal(typeof node.props.editing, 'number'); assert.ok(!('onEditingChanged' in node.props));
    h.states.set(text.binding.id, { value: `native ${node.kind} 🦊`, revision: h.states.get(text.binding.id).revision + 1 });
    const snapshot = h.states.get(text.binding.id);
    h.emit({ type: 'textEditing', id: node.id, token: node.props.editing, editing: true, state: { id: text.binding.id, ...snapshot } });
    assert.deepEqual(events.at(-1), [0, true, snapshot.value]);
  }
  version.value = 1; await tick();
  for (const node of inputs) assert.equal(h.nodes.get(node.id).props.editing, node.props.editing);
  text.value = 'newer JS acknowledgement';
  const node = inputs[0];
  h.emit({ type: 'textEditing', id: node.id, token: node.props.editing, editing: false, state: { id: text.binding.id, value: 'older', revision: 0 } });
  assert.deepEqual(events.at(-1), [1, false, 'newer JS acknowledgement']);
  h.emit({ type: 'textSubmit', id: node.id, token: node.props.submit, state: { id: text.binding.id, value: 'older', revision: 0 } });
  assert.equal(events.at(-1), 'submit');
  h.emit({ type: 'stop' }); await done; assert.equal(ui.__testing.stats().actions, 0);
});

test('editing registrations reject retired tokens, rebound cells and malformed events before accepting snapshots', async () => {
  const h = await setup(), { ui } = h;
  const enabled = ui.State(true), alternate = ui.State(false), first = ui.State('first'), second = ui.State('second'); let calls = 0;
  const done = launch(ui, ui.View(() => ui.TextEditor({ text: (alternate.value ? second : first).binding, onEditingChanged: enabled.value ? () => { calls++; } : undefined })));
  const input = [...h.nodes.values()].find(n => n.kind === 'texteditor'), original = input.props.editing;
  const emit = (token, state = first, editing = true, id = input.id) => h.emit({ type: 'textEditing', id, token, editing, state: { id: state.binding.id, value: 'event', revision: 99 } });
  emit(original, first, 'true'); emit(original, first, true, input.id + 100); assert.equal(calls, 0); assert.equal(first.value, 'first');
  enabled.value = false; await tick(); assert.equal(ui.__testing.stats().actions, 0); assert.ok(!('editing' in h.nodes.get(input.id).props));
  enabled.value = true; await tick(); const renewed = h.nodes.get(input.id).props.editing;
  assert.notEqual(renewed, original); emit(original); assert.equal(first.value, 'first');
  alternate.value = true; await tick(); const rebound = h.nodes.get(input.id).props.editing;
  assert.notEqual(rebound, renewed); emit(renewed); emit(rebound, first); assert.equal(calls, 0); assert.equal(first.value, 'first');
  emit(rebound, second, false); assert.equal(calls, 1); assert.equal(second.value, 'event');
  h.emit({ type: 'stop' }); await done;
});

test('editing callback options reject invalid inputs before serialization and failed mounts release registrations', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('initial'), broken = ui.State(true), before = h.calls.length;
  for (const create of [options => ui.TextField('Plain', options), options => ui.SecureField('Secret', options), ui.TextEditor]) {
    assert.throws(() => create({ text: text.binding, onEditingChanged: true }), /onEditingChanged/);
  }
  assert.throws(() => ui.TextEditor({ text: text.binding, onSubmit: () => {} }), /Unknown/);
  assert.throws(() => ui.TextEditor({ text: text.binding, monospaced: 1 }), /monospaced/);
  assert.equal(h.calls.length, before);
  const done = launch(ui, ui.View(() => ui.VStack([
    ui.TextEditor({ text: text.binding, monospaced: undefined, onEditingChanged: () => {} }),
    ui.View(() => { if (broken.value) throw new Error('partial mount'); return ui.Text('ok'); }),
  ]), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.equal(ui.__testing.stats().actions, 0);
  broken.value = false; await tick(); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'stop' }); await done; assert.equal(ui.__testing.stats().actions, 0);
});

test('keyed editors preserve scoped registrations during reordering and release late editing events on unmount', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), reversed = ui.State(false); let calls = 0, setups = 0, disposals = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const text = scope.state(id); scope.onDispose(() => { disposals++; });
    return () => ui.TextEditor({ text: text.binding, onEditingChanged: () => { calls++; } });
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)) : ui.Text('hidden')));
  const nodes = [...h.nodes.values()].filter(n => n.kind === 'texteditor');
  reversed.value = true; await tick(); assert.equal(setups, 2);
  for (const node of nodes) assert.equal(h.nodes.get(node.id).props.editing, node.props.editing);
  shown.value = false; await tick(); assert.equal(disposals, 2); assert.equal(h.states.size, 2); assert.equal(ui.__testing.stats().actions, 0);
  for (const node of nodes) h.emit({ type: 'textEditing', id: node.id, token: node.props.editing, editing: false, state: { id: node.props.state, value: 'late', revision: 1 } });
  assert.equal(calls, 0); h.emit({ type: 'stop' }); await done;
});

test('editing callback failure disposes sibling registrations and stops once', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('dummy'); let stops = 0, disposals = 0;
  const Child = ui.Component(scope => {
    scope.state('owned'); scope.onDispose(() => { disposals++; });
    return () => ui.VStack([ui.TextEditor({ text: text.binding, onEditingChanged: () => { throw new Error('intentional editing failure'); } }), ui.SecureField('Sibling', { text: text.binding, onSubmit: () => {}, onEditingChanged: () => {} })]);
  });
  const done = launch(ui, Child(), () => { stops++; });
  const input = [...h.nodes.values()].find(n => n.kind === 'texteditor');
  const rejected = assert.rejects(done, /intentional editing failure/), previous = console.error; console.error = () => {};
  try { h.emit({ type: 'textEditing', id: input.id, token: input.props.editing, editing: true, state: { id: text.binding.id, value: 'dummy', revision: 0 } }); await rejected; }
  finally { console.error = previous; }
  assert.equal(stops, 1); assert.equal(disposals, 1); assert.equal(h.status(), 1);
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('directional focus validates before transport and returns native acceptance without allocating resources', async () => {
  const h = await setup(), { ui } = h;
  for (const direction of [null, '', 'next', 'clear', 1, true, {}, []]) assert.throws(() => ui.Focus.move(direction), /focus direction/);
  assert.equal(h.calls.length, 0);
  const done = launch(ui, ui.Text('body'));
  for (const direction of ['left', 'right', 'up', 'down']) {
    h.focus.focused = false; assert.equal(ui.Focus.move(direction), false);
    h.focus.focused = true; assert.equal(ui.Focus.move(direction), true); assert.deepEqual(h.calls.at(-1), { op: 'focus.direction', direction });
  }
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done; const count = h.calls.length;
  assert.equal(ui.Focus.move('right'), false); assert.equal(ui.Focus.move(null), false); assert.equal(h.calls.length, count);
});

test('directional focus shares render/computed purity, effect and canceled-task guards', async () => {
  const h = await setup(), { ui } = h; h.focus.focused = true; let finish, result;
  const shown = ui.State(true), Owner = ui.Component(scope => {
    scope.effect(() => { assert.equal(ui.Focus.move('right'), true); });
    scope.task(async () => { await new Promise(resolve => { finish = resolve; }); result = ui.Focus.move('down'); });
    return () => ui.Text('owned');
  });
  const done = launch(ui, ui.View(() => { assert.throws(() => ui.Focus.move('right'), /outside view bodies/); return shown.value ? Owner() : ui.Text('gone'); }));
  const derived = ui.Computed(() => ui.Focus.move('up')); assert.throws(() => derived.value, /Computed callbacks cannot move focus/);
  await tick(); shown.value = false; await tick(); const count = h.calls.length; finish(); await tick(); assert.equal(result, false); assert.equal(h.calls.length, count);
  h.emit({ type: 'stop' }); await done;
});

test('DatePicker names validate before transport and rename without rebinding or allocating callbacks', async () => {
  const h = await setup(), { ui } = h; const value = ui.State(0), name = ui.State('date 🦊');
  for (const focusName of [null, '', 1, true, {}, [], '\ud800']) assert.throws(() => ui.DatePicker('Date', { selection: value.binding, focusName }), /Focus names/);
  const done = launch(ui, ui.View(() => ui.DatePicker('Date', { selection: value.binding, focusName: name.value })));
  const original = [...h.nodes.values()].find(n => n.kind === 'datepicker');
  assert.equal(original.props.focusName, 'date 🦊'); name.value = 'Renamed'; await tick();
  assert.equal(h.nodes.get(original.id).props.focusName, 'Renamed'); assert.equal(h.nodes.get(original.id).props.state, original.props.state); assert.equal(ui.__testing.stats().actions, 0);
  h.emit({ type: 'stop' }); await done; assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('DatePicker uses millisecond handles, detached options and canonical named time zones', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(Date.UTC(2026, 10, 7, 18, 30));
  const options = { selection: value.binding, min: 0, max: Date.UTC(2030, 0, 1), timeZone: 'US/Central', components: 'date', style: 'graphical' };
  const custom = ui.DatePicker('Date 🦊', options); options.min = 1000; options.timeZone = 'UTC';
  const done = launch(ui, ui.VStack([custom, ui.DatePicker('Default', { selection: value.binding })]));
  const nodes = [...h.nodes.values()].filter(n => n.kind === 'datepicker');
  assert.equal(nodes[0].props.state, value.binding.id); assert.equal(nodes[0].props.min, 0); assert.equal(nodes[0].props.timeZone, 'America/Chicago');
  assert.equal(nodes[0].props.style, 'graphical'); assert.equal(nodes[0].props.components, 'date');
  assert.deepEqual(nodes[1].props, { title: 'Default', state: value.binding.id, components: 'dateAndTime', style: 'automatic' });
  assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 1);
  h.emit({ type: 'stop' }); await done;
});

test('DatePicker rejects invalid timestamp bounds, styles, components and zones before bridge calls', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0), before = h.calls.length;
  for (const options of [
    { min: NaN }, { max: Infinity }, { min: -62135596800001 }, { max: 253402300800000 },
    { min: 2, max: 1 }, { min: new Date() }, { components: 'seconds' }, { style: 'wheel' },
    { timeZone: '' }, { timeZone: 'Not/AZone' }, { timeZone: 42 }, { timeZone: '+01:00' }, { unknown: true },
  ]) assert.throws(() => ui.DatePicker('Invalid', { selection: value.binding, ...options }), TypeError);
  assert.throws(() => ui.DatePicker(42, { selection: value.binding }), /title/);
  assert.throws(() => ui.DatePicker('Invalid', { selection: 42 }), /binding/);
  assert.equal(h.calls.length, before);
  const done = launch(ui, ui.DatePicker('Single instant', { selection: value.binding, min: 0, max: 0 }));
  h.emit({ type: 'stop' }); await done;
});

test('keyed date inputs preserve scoped state through zone/style changes and release stale native events', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), reversed = ui.State(false), zone = ui.State('UTC'), style = ui.State('compact');
  const instances = new Map(); let setups = 0, disposals = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const value = scope.state(0); instances.set(id, value); scope.onDispose(() => { disposals++; });
    return () => ui.DatePicker(id, { selection: value.binding, style: style.value, timeZone: zone.value });
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)) : ui.Text('hidden')));
  await tick(); const a = instances.get('a'), id = a.binding.id;
  const dateID = [...h.nodes.values()].find(n => n.kind === 'datepicker' && n.props.title === 'a').id;
  h.emit({ type: 'state', id, revision: 1, value: Date.UTC(2024, 1, 29) });
  reversed.value = true; style.value = 'graphical'; zone.value = 'America/Chicago'; await tick();
  assert.equal(instances.get('a'), a); assert.equal(a.value, Date.UTC(2024, 1, 29)); assert.equal(setups, 2);
  assert.equal(h.nodes.get(dateID).props.timeZone, 'America/Chicago');
  shown.value = false; await tick(); assert.equal(disposals, 2); assert.equal(h.states.size, 4);
  h.emit({ type: 'state', id, revision: 2, value: 0 }); assert.equal(a.value, Date.UTC(2024, 1, 29));
  h.emit({ type: 'stop' }); await done;
});

test('invalid dynamic date configuration recovers without committing malformed controls', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0), zone = ui.State('not/a-zone');
  const done = launch(ui, ui.View(() => ui.DatePicker('Date', { selection: value.binding, timeZone: zone.value }), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.ok(!h.calls.some(c => c.op === 'commit' && c.nodes.some(n => n.kind === 'datepicker')));
  zone.value = 'UTC'; await tick(); assert.ok([...h.nodes.values()].some(n => n.kind === 'datepicker'));
  h.emit({ type: 'stop' }); await done;
});

test('text submit callbacks synchronize native snapshots, retain tokens for current handlers and respect newer acknowledgements', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('initial'), version = ui.State(0), values = [];
  const done = launch(ui, ui.View(() => {
    const current = version.value;
    return ui.SecureField('Secret', { text: text.binding, onSubmit: function () { assert.equal(this, undefined); values.push([current, text.value]); } });
  }));
  let field = [...h.nodes.values()].find(n => n.kind === 'securefield');
  assert.equal(typeof field.props.submit, 'number'); assert.ok(!('onSubmit' in field.props));
  assert.equal(ui.__testing.stats().actions, 1);
  h.states.set(text.binding.id, { value: 'native 🦊', revision: 1 });
  h.emit({ type: 'textSubmit', id: field.id, token: field.props.submit, state: { id: text.binding.id, value: 'native 🦊', revision: 1 } });
  assert.deepEqual(values, [[0, 'native 🦊']]);
  version.value = 1; await tick();
  const updated = h.nodes.get(field.id); assert.equal(updated.props.submit, field.props.submit);
  text.value = 'acknowledged';
  h.emit({ type: 'textSubmit', id: field.id, token: field.props.submit, state: { id: text.binding.id, value: 'old native', revision: 1 } });
  assert.deepEqual(values.at(-1), [1, 'acknowledged']);
  h.emit({ type: 'stop' }); await done; assert.equal(ui.__testing.stats().actions, 0);
});

test('submit removal/readdition and binding changes reject old tokens and mismatched sources', async () => {
  const h = await setup(), { ui } = h;
  const enabled = ui.State(true), alternate = ui.State(false), first = ui.State('first'), second = ui.State('second'); let calls = 0;
  const done = launch(ui, ui.View(() => ui.TextField('Name', { text: (alternate.value ? second : first).binding, onSubmit: enabled.value ? () => { calls++; } : undefined })));
  const field = [...h.nodes.values()].find(n => n.kind === 'textfield'), original = field.props.submit;
  enabled.value = false; await tick(); assert.equal(ui.__testing.stats().actions, 0); assert.ok(!('submit' in h.nodes.get(field.id).props));
  enabled.value = true; await tick(); const renewed = h.nodes.get(field.id).props.submit; assert.notEqual(renewed, original);
  const emit = (token, state = first, value = 'stale') => h.emit({ type: 'textSubmit', id: field.id, token, state: { id: state.binding.id, value, revision: 99 } });
  emit(original); assert.equal(calls, 0); assert.equal(first.value, 'first');
  alternate.value = true; await tick(); const rebound = h.nodes.get(field.id).props.submit;
  assert.notEqual(rebound, renewed); emit(renewed); emit(rebound, first);
  assert.equal(calls, 0); assert.equal(first.value, 'first');
  emit(rebound, second, 'current'); assert.equal(calls, 1); assert.equal(second.value, 'current');
  h.emit({ type: 'stop' }); await done;
});

test('keyed secure/text inputs keep registrations bounded and release stale submits on unmount', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), reversed = ui.State(false), submitted = [];
  const inputs = new Map();
  const Row = ui.Component((scope, id) => {
    const text = scope.state(id); inputs.set(id, text);
    return () => ui.SecureField(id, { text: text.binding, onSubmit: () => submitted.push(id) });
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)) : ui.Text('hidden')));
  await tick(); const field = [...h.nodes.values()].find(n => n.kind === 'securefield' && n.props.title === 'a');
  reversed.value = true; await tick(); assert.equal(h.nodes.get(field.id).props.submit, field.props.submit); assert.equal(ui.__testing.stats().actions, 2);
  shown.value = false; await tick();
  h.emit({ type: 'textSubmit', id: field.id, token: field.props.submit, state: { id: field.props.state, value: 'late', revision: 1 } });
  assert.deepEqual(submitted, []); assert.equal(ui.__testing.stats().actions, 0); assert.equal(h.states.size, 2);
  shown.value = true; await tick(); assert.equal(ui.__testing.stats().actions, 2);
  h.emit({ type: 'stop' }); await done; assert.equal(ui.__testing.stats().actions, 0);
});

test('text input options reject malformed callbacks and labels before bridge serialization', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('initial'), before = h.calls.length;
  for (const field of [ui.TextField, ui.SecureField]) {
    assert.throws(() => field(42, { text: text.binding }), /title/);
    assert.throws(() => field('Invalid', { text: text.binding, onSubmit: true }), /onSubmit/);
    assert.throws(() => field('Invalid', { text: 42 }), /binding/);
    assert.throws(() => field('Invalid', { text: text.binding, unknown: true }), /Unknown/);
  }
  assert.equal(h.calls.length, before);
  const done = launch(ui, ui.SecureField('No callback', { text: text.binding })); assert.equal(ui.__testing.stats().actions, 0);
  h.emit({ type: 'stop' }); await done;
});

test('submit callback failures stop once and dispose all text callback registrations', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('dummy'); let stops = 0, disposed = 0;
  const Child = ui.Component(scope => {
    scope.onDispose(() => { disposed++; });
    return () => ui.SecureField('Submit', { text: text.binding, onSubmit: () => { throw new Error('intentional submit failure'); } });
  });
  const done = launch(ui, Child(), () => { stops++; });
  const field = [...h.nodes.values()].find(n => n.kind === 'securefield');
  const rejected = assert.rejects(done, /intentional submit failure/), previous = console.error; console.error = () => {};
  try { h.emit({ type: 'textSubmit', id: field.id, token: field.props.submit, state: { id: text.binding.id, value: 'dummy', revision: 0 } }); await rejected; }
  finally { console.error = previous; }
  assert.equal(stops, 1); assert.equal(disposed, 1); assert.equal(h.status(), 1);
  assert.deepEqual(ui.__testing.stats(), { actions: 0, cells: 0, dependencies: 0 });
});

test('render recovery removes text submit registrations from failed partial mounts', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.State('dummy'), broken = ui.State(true);
  const done = launch(ui, ui.View(() => ui.VStack([
    ui.SecureField('Partial', { text: text.binding, onSubmit: () => {} }),
    ui.View(() => { if (broken.value) throw new Error('partial mount'); return ui.Text('good'); }),
  ]), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.equal(ui.__testing.stats().actions, 0);
  broken.value = false; await tick(); assert.equal(ui.__testing.stats().actions, 1);
  h.emit({ type: 'stop' }); await done;
});

test('Picker snapshots typed options including distinct numeric/string/null and Unicode IDs', async () => {
  const h = await setup(), { ui } = h;
  const selection = ui.State(null);
  const options = [{ value: 1, label: 'Number' }, { value: '1', label: 'Text' }, { value: null, label: 'None' }, { value: 'café', label: 'Composed' }, { value: 'cafe\u0301', label: 'Decomposed' }];
  const picker = ui.Picker('Choice 🦊', { selection: selection.binding, options });
  options[0].label = 'outside'; options.push({ value: 'late', label: 'outside' });
  const done = launch(ui, picker);
  const node = [...h.nodes.values()].find(n => n.kind === 'picker');
  assert.equal(node.props.title, 'Choice 🦊'); assert.equal(node.props.style, 'automatic'); assert.equal(node.props.placeholder, 'Select…');
  assert.deepEqual(node.props.options.map(item => item.value), [1, '1', null, 'café', 'cafe\u0301']);
  assert.equal(node.props.options[0].label, 'Number'); assert.equal(node.props.state, selection.binding.id); assert.deepEqual(node.children, []);
  assert.ok(Object.isFrozen(picker.props.options) && Object.isFrozen(picker.props.options[0]));
  assert.equal(ui.__testing.stats().actions, 0);
  h.emit({ type: 'stop' }); await done;
});

test('Picker rejects invalid or duplicate IDs, malformed options and unsupported styles before bridge calls', async () => {
  const h = await setup(), { ui } = h;
  const selection = ui.State('a'), before = h.calls.length;
  for (const options of [
    [{ value: 'a', label: 'A' }, { value: 'a', label: 'Other' }],
    [{ value: 0, label: 'Zero' }, { value: -0, label: 'Negative zero' }],
    [{ value: null, label: 'None' }, { value: null, label: 'None again' }],
    ...[undefined, true, {}, [], NaN, Infinity, 1n, Symbol('x')].map(value => [{ value, label: 'Invalid' }]),
    [{ value: 'a', label: 42 }], [{ value: 'a', label: 'A', extra: true }], new Array(1), null,
  ]) assert.throws(() => ui.Picker('Invalid', { selection: selection.binding, options }), TypeError);
  assert.throws(() => ui.Picker('Invalid', { selection: selection.binding, options: [], style: 'wheel' }), /style/);
  assert.throws(() => ui.Picker('Invalid', { selection: selection.binding, options: [], placeholder: 42 }), /placeholder/);
  assert.throws(() => ui.Picker(42, { selection: selection.binding, options: [] }), /title/);
  assert.throws(() => ui.Picker('Invalid', { selection: 42, options: [] }), /binding/);
  assert.equal(h.calls.length, before);
  const done = launch(ui, ui.Picker('Empty', { selection: selection.binding, options: [] })); h.emit({ type: 'stop' }); await done;
});

test('Picker option removal and style changes preserve model values, keyed instances and scoped cleanup', async () => {
  const h = await setup(), { ui } = h;
  const items = ui.State([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]), shown = ui.State(true), style = ui.State('menu'), reversed = ui.State(false);
  const instances = new Map(); let setups = 0, disposals = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const value = scope.state('a'); instances.set(id, value);
    scope.onDispose(() => { disposals++; });
    return () => ui.Picker(id, { selection: value.binding, options: items.value, style: style.value, placeholder: 'Missing' });
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)) : ui.Text('hidden')));
  await tick(); const a = instances.get('a'), id = a.binding.id;
  const pickerID = [...h.nodes.values()].find(n => n.kind === 'picker' && n.props.title === 'a').id;
  h.emit({ type: 'state', id, revision: 1, value: 'b' });
  items.value = [{ value: 'a', label: 'Updated A' }]; style.value = 'segmented'; reversed.value = true; await tick();
  assert.equal(a.value, 'b', 'removing a choice does not rewrite the application model'); assert.equal(instances.get('a'), a); assert.equal(setups, 2);
  assert.equal(h.nodes.get(pickerID).props.style, 'segmented');
  items.value = []; await tick(); assert.equal(a.value, 'b');
  shown.value = false; await tick(); assert.equal(disposals, 2); assert.equal(h.states.size, 4);
  h.emit({ type: 'state', id, revision: 2, value: 'late' }); assert.equal(a.value, 'b');
  h.emit({ type: 'stop' }); await done;
});

test('duplicate Picker options recover through a render fallback without native commits of invalid data', async () => {
  const h = await setup(), { ui } = h;
  const selection = ui.State('a'), broken = ui.State(true);
  const done = launch(ui, ui.View(() => ui.Picker('Choice', { selection: selection.binding, options: broken.value ? [{ value: 'a', label: 'A' }, { value: 'a', label: 'Duplicate' }] : [{ value: 'a', label: 'A' }] }), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.ok(!h.calls.some(c => c.op === 'commit' && c.nodes.some(n => n.kind === 'picker')));
  broken.value = false; await tick(); assert.ok([...h.nodes.values()].some(n => n.kind === 'picker'));
  h.emit({ type: 'stop' }); await done;
});

test('forms and numeric controls serialize typed handles, defaults and detached sections', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0.5), children = [ui.Slider('Continuous', { value: value.binding }), ui.Stepper('Default', { value: value.binding })];
  const options = { footer: 'original' }, section = ui.Section('Settings 🦊', children, options);
  children.length = 0; options.footer = 'mutated';
  const done = launch(ui, ui.Form([section, ui.Section('Stepped', [ui.Slider('Fraction', { value: value.binding, min: -1, max: 1, step: 0.25 })])], { style: 'grouped' }));
  const nodes = [...h.nodes.values()];
  assert.ok(nodes.some(n => n.kind === 'form' && n.props.style === 'grouped'));
  assert.ok(nodes.some(n => n.kind === 'section' && n.props.title === 'Settings 🦊' && n.props.footer === 'original' && n.children.length === 2));
  const slider = nodes.find(n => n.kind === 'slider' && n.props.title === 'Continuous');
  assert.deepEqual(slider.props, { title: 'Continuous', min: 0, max: 1, state: value.binding.id });
  const stepper = nodes.find(n => n.kind === 'stepper');
  assert.deepEqual(stepper.props, { title: 'Default', min: 0, max: 100, step: 1, state: value.binding.id });
  assert.ok(nodes.some(n => n.kind === 'slider' && n.props.step === 0.25));
  h.emit({ type: 'stop' }); await done;
});

test('numeric range/step and form options reject invalid input before bridge calls', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0), before = h.calls.length;
  for (const control of [ui.Slider, ui.Stepper]) {
    for (const options of [
      { min: 1, max: 1 }, { min: 2, max: 1 }, { min: -1e308, max: 1e308 }, { min: NaN }, { max: Infinity },
      { step: 0 }, { step: -1 }, { step: Infinity }, { min: 0, max: 1, step: 2 }, { min: 0, max: 1e308, step: 1e-308 }, { unknown: true },
    ]) assert.throws(() => control('Invalid', { value: value.binding, ...options }), TypeError);
    assert.throws(() => control('Invalid', { value: 1 }), /binding/);
    assert.throws(() => control(null, { value: value.binding }), /title/);
  }
  assert.throws(() => ui.Form([], { style: 'table' }), /style/);
  assert.throws(() => ui.Section(42, []), /title/);
  assert.throws(() => ui.Section('Invalid', [], { footer: ui.Text('not text') }), /footer/);
  assert.equal(h.calls.length, before);
  const done = launch(ui, ui.Form([])); h.emit({ type: 'stop' }); await done;
});

test('keyed form sections retain scoped numeric state across style and range changes and release after removal', async () => {
  const h = await setup(), { ui } = h;
  const style = ui.State('automatic'), max = ui.State(10), shown = ui.State(true), reversed = ui.State(false);
  const instances = new Map(); let setups = 0, disposals = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const value = scope.state(2); instances.set(id, value);
    scope.onDispose(() => { disposals++; });
    return () => ui.Section(id, [ui.Slider(id, { value: value.binding, min: 0, max: max.value, step: 0.5 }), ui.Stepper(id, { value: value.binding, max: max.value })]);
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.Form([
    ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)),
  ], { style: style.value }) : ui.Text('hidden')));
  await tick(); const a = instances.get('a'), id = a.binding.id;
  h.emit({ type: 'state', id, revision: 1, value: 3.5 });
  style.value = 'columns'; max.value = 20; reversed.value = true; await tick();
  assert.equal(instances.get('a'), a); assert.equal(a.value, 3.5); assert.equal(setups, 2);
  assert.ok([...h.nodes.values()].some(n => n.kind === 'slider' && n.props.state === id && n.props.max === 20));
  shown.value = false; await tick(); assert.equal(disposals, 2); assert.equal(h.states.size, 4);
  h.emit({ type: 'state', id, revision: 2, value: 9 }); assert.equal(a.value, 3.5);
  h.emit({ type: 'stop' }); await done;
});

test('a dynamic numeric range failure recovers without committing invalid control descriptors', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0), max = ui.State(0);
  const done = launch(ui, ui.View(() => ui.Form([ui.Slider('Amount', { value: value.binding, min: 0, max: max.value })]), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.ok(!h.calls.some(c => c.op === 'commit' && c.nodes.some(n => n.kind === 'slider')));
  max.value = 1; await tick(); assert.ok([...h.nodes.values()].some(n => n.kind === 'slider'));
  h.emit({ type: 'stop' }); await done;
});

test('layout values serialize JSON-safe frames, alignments, padding and scroll defaults', async () => {
  const h = await setup(), { ui } = h;
  const options = { minWidth: 20, idealWidth: 60, maxWidth: 'infinity', alignment: 'bottomTrailing' };
  const frame = ui.Text('flex').frame(options); options.minWidth = 900;
  const done = launch(ui, ui.VStack([
    ui.ScrollView(ui.HStack([
      ui.Text('fixed').frame({ width: 80, height: 0, alignment: 'topLeading' }),
      ui.Text('insets').padding({ top: 1, leading: 2, bottom: 3, trailing: 4 }).fixedSize({ vertical: true }).layoutPriority(-1),
      frame, ui.Spacer({ minLength: 12 }),
    ], { alignment: 'firstTextBaseline', spacing: -2 })),
    ui.ScrollView(ui.Text('both').fixedSize(), { axes: 'both', showsIndicators: false }),
    ui.Text('default padding').padding(),
  ], { alignment: 'trailing' }));
  const nodes = [...h.nodes.values()];
  assert.ok(nodes.some(n => n.kind === 'scroll' && n.props.axes === 'vertical' && n.props.showsIndicators === true && n.children.length === 1));
  assert.ok(nodes.some(n => n.kind === 'scroll' && n.props.axes === 'both' && n.props.showsIndicators === false));
  assert.ok(nodes.some(n => n.props.name === 'frame' && n.props.minWidth === 20 && n.props.maxWidth === 'infinity'));
  assert.ok(nodes.some(n => n.props.name === 'frame' && n.props.height === 0));
  assert.ok(nodes.some(n => n.props.name === 'padding' && n.props.points === 16));
  assert.ok(nodes.some(n => n.props.name === 'padding' && n.props.trailing === 4));
  assert.ok(nodes.some(n => n.props.name === 'fixedSize' && n.props.horizontal === false && n.props.vertical === true));
  assert.ok(nodes.some(n => n.props.name === 'fixedSize' && n.props.horizontal === true && n.props.vertical === true));
  assert.ok(nodes.some(n => n.props.name === 'layoutPriority' && n.props.value === -1));
  assert.ok(nodes.some(n => n.kind === 'spacer' && n.props.minLength === 12));
  assert.equal(h.calls.filter(call => call.op === 'state.create').length, 0);
  h.emit({ type: 'stop' }); await done;
});

test('invalid layout options fail before bridge serialization, including nonfinite and inverted bounds', async () => {
  const h = await setup(), { ui } = h;
  const text = ui.Text('layout');
  const invalid = [
    () => text.frame({ width: 10, minHeight: 1 }), () => text.frame({ minWidth: 20, maxWidth: 10 }),
    () => text.frame({ minHeight: 20, idealHeight: 10 }), () => text.frame({ idealWidth: 20, maxWidth: 10 }),
    () => text.frame({ width: Infinity }), () => text.frame({ maxWidth: Infinity }), () => text.frame({ width: -1 }),
    () => text.frame({ minWidth: 'infinity' }), () => text.frame({ alignment: 'left' }), () => text.frame({ unknown: 1 }),
    () => text.padding(NaN), () => text.padding({ top: Infinity }), () => text.padding({ left: 1 }),
    () => text.fixedSize({ horizontal: 1 }), () => text.layoutPriority(Infinity),
    () => ui.ScrollView(text, { axes: 'diagonal' }), () => ui.ScrollView(text, { showsIndicators: 'yes' }),
    () => ui.VStack([], { alignment: 'top' }), () => ui.HStack([], { alignment: 'leading' }),
    () => ui.HStack([], { spacing: NaN }), () => ui.Spacer({ minLength: -1 }),
  ];
  for (const make of invalid) assert.throws(make, TypeError);
  assert.equal(h.calls.length, 0);
  for (const alignment of ['topLeading', 'top', 'topTrailing', 'leading', 'center', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']) text.frame({ alignment });
  for (const alignment of ['top', 'center', 'bottom', 'firstTextBaseline', 'lastTextBaseline']) ui.HStack([], { alignment });
  const done = launch(ui, text.padding(-1)); h.emit({ type: 'stop' }); await done;
});

test('scroll option changes and keyed reorder preserve scoped actions and bindings until unmount', async () => {
  const h = await setup(), { ui } = h;
  const axes = ui.State('vertical'), reversed = ui.State(false), shown = ui.State(true);
  const instances = new Map(); let setups = 0, disposals = 0;
  const Row = ui.Component((scope, id) => {
    setups++; const count = scope.state(0); instances.set(id, count);
    scope.onDispose(() => { disposals++; });
    return () => ui.Button(`${id}:${count.value}`, () => { count.value++; });
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ScrollView(ui.VStack([
    ui.ForEach(reversed.value ? ['b', 'a'] : ['a', 'b'], { id: id => id }, id => Row(id)),
  ]), { axes: axes.value }).frame({ width: 200, height: 100 }) : ui.Text('hidden')));
  await tick(); const before = instances.get('a');
  const scrollID = [...h.nodes.values()].find(node => node.kind === 'scroll').id;
  const button = [...h.nodes.values()].find(node => node.props.title === 'a:0').id;
  h.emit({ type: 'action', id: button }); await tick();
  axes.value = 'both'; reversed.value = true; await tick();
  assert.equal(instances.get('a'), before); assert.equal(before.value, 1); assert.equal(setups, 2);
  assert.equal(h.nodes.get(scrollID).props.axes, 'both'); assert.equal(h.nodes.get(button).props.title, 'a:1');
  shown.value = false; await tick();
  assert.equal(disposals, 2); assert.equal(h.states.size, 3); assert.equal(ui.__testing.stats().actions, 0);
  h.emit({ type: 'action', id: button }); assert.equal(before.value, 1);
  h.emit({ type: 'stop' }); await done;
});

test('invalid dynamic layout recovers without committing malformed native props', async () => {
  const h = await setup(), { ui } = h;
  const width = ui.State(-1);
  const done = launch(ui, ui.View(() => ui.ScrollView(ui.Text('recovered')).frame({ width: width.value }), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.ok([...h.nodes.values()].some(node => node.props.value?.includes('finite nonnegative')));
  assert.ok(!h.calls.some(call => call.op === 'commit' && call.nodes.some(node => node.props.width === -1)));
  width.value = 120; await tick();
  assert.ok([...h.nodes.values()].some(node => node.kind === 'scroll'));
  h.emit({ type: 'stop' }); await done;
});

test('Computed is lazy, shared by consumers, invalidates once and allocates no native cells', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(1); let evaluations = 0, bodies = 0, effects = 0;
  const doubled = ui.Computed(() => { evaluations++; return source.value * 2; });
  assert.equal(evaluations, 0); assert.equal(h.states.size, 1);
  assert.equal(doubled.value, 2); assert.equal(doubled.value, 2); assert.equal(evaluations, 1);
  const Child = ui.Component(scope => {
    scope.effect(() => { assert.equal(doubled.value % 2, 0); effects++; });
    return () => { bodies++; return ui.Text(String(doubled.value)); };
  });
  const done = launch(ui, ui.VStack([Child(), Child()])); await tick();
  assert.equal(evaluations, 1); assert.equal(bodies, 2); assert.equal(effects, 2);
  source.value = 2; source.value = 3;
  assert.equal(evaluations, 1); assert.equal(source.dependents.size, 0, 'stale cache detaches inputs until read');
  await tick();
  assert.equal(evaluations, 2); assert.equal(bodies, 4); assert.equal(effects, 4);
  assert.equal(doubled.value, 6); assert.equal(h.states.size, 1);
  h.emit({ type: 'stop' }); await done;
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
  assert.throws(() => doubled.value, /disposed Computed/);
});

test('computed diamonds stay fresh in synchronous subscribers and do not leak subscriber dependencies', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(1), unrelated = ui.State(0); let leftRuns = 0, rightRuns = 0, totalRuns = 0, effectRuns = 0;
  const left = ui.Computed(() => { leftRuns++; return source.value * 2; });
  const right = ui.Computed(() => { rightRuns++; return source.value * 3; });
  const total = ui.Computed(() => { totalRuns++; return left.value + right.value; });
  const values = [];
  source.subscribe(() => { unrelated.value; values.push(total.value); });
  const Child = ui.Component(scope => {
    scope.effect(() => { effectRuns++; source.value; });
    return () => ui.Text(String(total.value));
  });
  const done = launch(ui, Child()); await tick();
  source.value = 2; source.value = 3;
  assert.deepEqual(values, [10, 15]); assert.equal(total.value, 15);
  await tick(); assert.equal(effectRuns, 2);
  assert.equal(leftRuns, 3); assert.equal(rightRuns, 3); assert.equal(totalRuns, 3);
  unrelated.value++; await tick(); assert.equal(effectRuns, 2); assert.equal(totalRuns, 3);
  h.emit({ type: 'stop' }); await done;
});

test('computed conditional inputs detach eagerly and JSON results preserve equal snapshot references', async () => {
  const h = await setup(), { ui } = h;
  const branch = ui.State(true), left = ui.State(1), right = ui.State(1); let runs = 0;
  const selected = ui.Computed(() => { runs++; return { rows: [branch.value ? left.value : right.value] }; });
  const initial = selected.value;
  assert.ok(Object.isFrozen(initial) && Object.isFrozen(initial.rows));
  assert.throws(() => initial.rows.push(2), TypeError);
  right.value = 2; assert.equal(selected.value, initial); assert.equal(runs, 1);
  branch.value = false; assert.equal(left.dependents.size, 0);
  assert.deepEqual(selected.value, { rows: [2] }); assert.equal(runs, 2);
  left.value = 3; assert.equal(runs, 2);
  const second = selected.value;
  branch.value = true; left.value = 2;
  assert.equal(selected.value, second, 'equal output keeps snapshot despite a new dependency set');
  assert.equal(runs, 3); assert.equal(right.dependents.size, 0);
  const done = launch(ui, ui.Text('computed')); h.emit({ type: 'stop' }); await done;
});

test('scoped computed props drive views, effects and cancellable tasks and release on unmount', async () => {
  const h = await setup(), { ui } = h;
  const title = ui.State('a'), shown = ui.State(true), unrelated = ui.State(0);
  const tasks = [], effects = []; let derived, scopeRef, runs = 0;
  const Child = ui.Component(scope => {
    scopeRef = scope;
    derived = scope.computed(() => { runs++; return scope.props.title.toUpperCase(); });
    scope.effect(() => { effects.push(derived.value); });
    scope.task(async task => { const value = derived.value, wait = deferred(); tasks.push({ value, task, wait }); await wait.promise; });
    return () => ui.Text(derived.value);
  });
  const done = launch(ui, ui.View(() => { unrelated.value; return shown.value ? Child({ title: title.value }) : ui.Text('hidden'); }));
  await tick(); assert.equal(runs, 1); assert.deepEqual(effects, ['A']);
  assert.throws(() => scopeRef.computed(() => 42), /during component setup/);
  unrelated.value++; await tick(); assert.equal(runs, 1); assert.equal(tasks.length, 1);
  title.value = 'b'; await tick();
  assert.equal(runs, 2); assert.deepEqual(effects, ['A', 'B']); assert.equal(tasks[1].value, 'B');
  assert.equal(tasks[0].task.signal.aborted, true);
  shown.value = false; await tick();
  assert.equal(tasks[1].task.signal.aborted, true); assert.throws(() => derived.value, /disposed/);
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
  for (const task of tasks) task.wait.resolve(); await tick();
  h.emit({ type: 'stop' }); await done;
});

test('computed failures are cached until tracked inputs change and recover through render fallbacks', async () => {
  const h = await setup(), { ui } = h;
  const broken = ui.State(true); let runs = 0;
  const value = ui.Computed(() => { runs++; if (broken.value) throw new Error('derived failure'); return 'recovered'; });
  assert.throws(() => value.value, /derived failure/); assert.throws(() => value.value, /derived failure/); assert.equal(runs, 1);
  const done = launch(ui, ui.View(() => ui.Text(value.value), { fallback: error => ui.Text(error.message) }));
  await tick(); assert.equal(runs, 1);
  broken.value = false; await tick(); assert.equal(value.value, 'recovered'); assert.equal(runs, 2);
  assert.ok([...h.nodes.values()].some(node => node.props.value === 'recovered'));
  h.emit({ type: 'stop' }); await done;
});

test('direct and indirect computed cycles diagnose cleanly and conditional cycles can recover', async () => {
  const h = await setup(), { ui } = h;
  let self; self = ui.Computed(() => self.value);
  assert.throws(() => self.value, /Computed dependency cycle/);
  const cyclic = ui.State(true); let a, b;
  a = ui.Computed(() => cyclic.value ? b.value : 42);
  b = ui.Computed(() => a.value);
  assert.throws(() => a.value, /Computed dependency cycle/); assert.throws(() => b.value, /Computed dependency cycle/);
  const done = launch(ui, ui.View(() => ui.Text(String(a.value)), { fallback: e => ui.Text(e.message) }));
  cyclic.value = false; await tick();
  assert.equal(a.value, 42); assert.equal(b.value, 42);
  h.emit({ type: 'stop' }); await done;
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
});

test('computed derivations reject State mutations, allocation and owned resource operations', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(1); let stopEffect, scopeRef, taskRef;
  const Child = ui.Component(scope => {
    scopeRef = scope; stopEffect = scope.effect(() => {});
    scope.task(task => { taskRef = task; });
    return () => ui.Text('child');
  });
  const done = launch(ui, Child()); await tick();
  const actions = [
    () => { source.value = 2; }, () => ui.State(1), () => source.subscribe(() => {}),
    () => ui.Computed(() => 1), () => stopEffect(),
    () => taskRef.commit(() => {}), () => taskRef.onCancel(() => {}),
    () => scopeRef.effect(() => {}), () => scopeRef.onDispose(() => {}),
    () => ui.runApp({ title: 'Invalid', width: 1, height: 1, content: ui.Text('invalid') }),
  ];
  for (const action of actions) {
    const invalid = ui.Computed(() => { action(); return 1; });
    assert.throws(() => invalid.value, /Computed callbacks cannot/);
  }
  assert.equal(source.value, 1); assert.equal(ui.__testing.effectStats().active, 2);
  const invalidAsync = ui.Computed(async () => { await Promise.resolve(); source.value = 99; return 1; });
  assert.throws(() => invalidAsync.value, /synchronous JSON values/);
  await tick(); assert.equal(source.value, 1, 'invalid async derivations cannot mutate State after await');
  const invalidJSON = ui.Computed(() => ({ date: new Date() })); assert.throws(() => invalidJSON.value, /plain records/);
  let getterReads = 0;
  const accessor = ui.Computed(() => ({ get then() { getterReads++; return undefined; } }));
  assert.throws(() => accessor.value, /accessors/); assert.equal(getterReads, 0);
  h.emit({ type: 'stop' }); await done;
});

test('failed component mounts dispose scoped computations without resubscribing to dead derivations', async () => {
  const h = await setup(), { ui } = h;
  const retry = ui.State(0); let derivations = 0;
  const Child = ui.Component(scope => {
    const local = scope.state(1);
    const result = scope.computed(() => { derivations++; return local.value; });
    return () => { retry.value; result.value; throw new Error('derived mount failure'); };
  });
  const done = launch(ui, ui.View(() => Child(), { fallback: e => ui.Text(e.message) }));
  await tick(); assert.equal(derivations, 1);
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
  retry.value++; await tick(); assert.equal(derivations, 2);
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
  assert.equal(h.states.size, 1);
  h.emit({ type: 'stop' }); await done;
});

test('computed-fed effect feedback still hits the existing loop diagnostic and tears down', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(0), derived = ui.Computed(() => source.value);
  const Child = ui.Component(scope => { scope.effect(() => { source.value = derived.value + 1; }); return () => ui.Text('cycle'); });
  const previous = console.error; console.error = () => {};
  try { await assert.rejects(launch(ui, Child()), /did not settle after 100 cycles/); }
  finally { console.error = previous; }
  assert.equal(h.status(), 1); assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
});

test('component cleanup can inspect the cached computed result before final dependency disposal', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true); let value, neverRead, runs = 0;
  const cleaned = [];
  const Child = ui.Component(scope => {
    const local = scope.state('owned');
    value = scope.computed(() => { runs++; return `${scope.props.label}:${local.value}`; });
    neverRead = scope.computed(() => 'not evaluated');
    scope.effect(() => { value.value; return () => cleaned.push(value.value); });
    scope.onDispose(() => {
      cleaned.push(value.value);
      assert.throws(() => neverRead.value, /component is unmounting/);
    });
    return () => ui.Text(value.value);
  });
  const done = launch(ui, ui.View(() => shown.value ? Child({ label: 'current' }) : ui.Text('hidden')));
  await tick(); shown.value = false; await tick();
  assert.deepEqual(cleaned, ['current:owned', 'current:owned']); assert.equal(runs, 1);
  assert.throws(() => value.value, /disposed Computed/);
  assert.deepEqual(ui.__testing.computedStats(), { active: 0, dependencies: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('structured State snapshots detach and deeply freeze records, arrays and subscriber values', async () => {
  const h = await setup(), { ui } = h;
  const nested = { flags: [true, null] }, input = { title: 'first', rows: [nested, nested] };
  const model = ui.State(input), initial = model.value;
  input.title = 'outside'; nested.flags.push(false);
  assert.deepEqual(initial, { title: 'first', rows: [{ flags: [true, null] }, { flags: [true, null] }] });
  assert.notEqual(initial, input); assert.notEqual(initial.rows[0], nested);
  assert.ok(Object.isFrozen(initial) && Object.isFrozen(initial.rows) && Object.isFrozen(initial.rows[0].flags));
  assert.throws(() => { initial.title = 'mutation'; }, TypeError);
  assert.throws(() => initial.rows.push({}), TypeError);
  assert.throws(() => { initial.rows[0].flags[0] = false; }, TypeError);
  let delivered;
  model.subscribe(value => { delivered = value; assert.ok(Object.isFrozen(value.rows[0].flags)); });
  const replacement = { title: 'Hello 🦊 café', rows: [{ flags: [false] }] };
  model.value = replacement; replacement.rows[0].flags.push(true);
  assert.deepEqual(model.value, { title: 'Hello 🦊 café', rows: [{ flags: [false] }] });
  assert.equal(delivered, model.value); assert.notEqual(initial, model.value);
  assert.equal(initial.title, 'first');
  const protoKey = ui.State(JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}'));
  assert.equal(Object.getPrototypeOf(protoKey.value), Object.prototype);
  assert.equal(protoKey.value.__proto__.polluted, true); assert.equal({}.polluted, undefined);
  const done = launch(ui, ui.Text(model.value.title)); h.emit({ type: 'stop' }); await done;
});

test('invalid structured state fails before crossing the bridge and leaves existing state unchanged', async () => {
  const h = await setup(), { ui } = h;
  const cycle = {}; cycle.self = cycle;
  const sparse = new Array(1), extra = [1]; extra.note = 'not JSON';
  let getterReads = 0;
  const accessor = { get title() { getterReads++; return 'unexpected'; } };
  const invalid = [undefined, NaN, Infinity, 1n, Symbol('x'), () => {}, new Date(), new Map(), new Set(),
    cycle, [cycle], sparse, extra, accessor, { nested: [undefined] }, { [Symbol('x')]: true },
    Object.defineProperty({}, 'hidden', { value: true })];
  const model = ui.State({ safe: [1] }), initial = model.value, before = h.calls.length;
  for (const value of invalid) {
    assert.throws(() => ui.State(value), /State/);
    assert.throws(() => { model.value = value; }, /State/);
    assert.equal(model.value, initial);
  }
  assert.equal(getterReads, 0); assert.equal(h.calls.length, before);
  const done = launch(ui, ui.Text('valid')); h.emit({ type: 'stop' }); await done;
});

test('structured equality preserves snapshots and avoids redundant subscribers, bodies and effects', async () => {
  const h = await setup(), { ui } = h;
  const model = ui.State({ title: 'first', rows: [{ id: 'a', count: 1 }] });
  let views = 0, effects = 0, notifications = 0;
  model.subscribe(() => { notifications++; });
  const Child = ui.Component(scope => {
    scope.effect(() => { model.value; effects++; });
    return () => { views++; return ui.Text(model.value.title); };
  });
  const done = launch(ui, Child()); await tick(); const initial = model.value;
  model.value = { rows: [{ count: 1, id: 'a' }], title: 'first' };
  await tick(); assert.equal(model.value, initial);
  assert.equal(views, 1); assert.equal(effects, 1); assert.equal(notifications, 0);
  model.value = { ...model.value, title: 'second' };
  model.value = { ...model.value, rows: [...model.value.rows, { id: 'b', count: 2 }] };
  await tick(); assert.equal(views, 2); assert.equal(effects, 2); assert.equal(notifications, 2);
  assert.deepEqual(model.value.rows.map(row => row.id), ['a', 'b']);
  h.emit({ type: 'stop' }); await done;
});

test('structured native mirrors freeze events and reject revisions older than acknowledged writes', async () => {
  const h = await setup(), { ui } = h;
  const model = ui.State([{ id: 'a' }]), id = h.calls.at(-1).id;
  let notifications = 0; model.subscribe(() => { notifications++; });
  const done = launch(ui, ui.View(() => ui.Text(model.value[0].id)));
  model.value = [{ id: 'newer JS' }];
  h.emit({ type: 'state', id, value: [{ id: 'older native' }], revision: 0 });
  assert.equal(model.value[0].id, 'newer JS');
  h.emit({ type: 'state', id, value: [{ id: 'latest native' }], revision: 2 });
  assert.equal(model.value[0].id, 'latest native'); assert.ok(Object.isFrozen(model.value[0]));
  const latest = model.value;
  h.emit({ type: 'state', id, value: [{ id: 'latest native' }], revision: 3 });
  assert.equal(model.value, latest); assert.equal(notifications, 2);
  h.emit({ type: 'stop' }); await done;
});

test('structured scoped state releases on unmount and obsolete tasks cannot publish structured results', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), shared = ui.State({ rows: [] }), wait = deferred();
  let local, lateNotifications = 0;
  const Child = ui.Component(scope => {
    local = scope.state([{ id: 'owned' }]);
    scope.task(async () => { await wait.promise; local.value = [{ id: 'late' }]; shared.value = { rows: ['late'] }; });
    return () => ui.Text(local.value[0].id);
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden'))); await tick();
  assert.throws(() => local.binding, /scalar State/);
  shown.value = false; await tick();
  local.subscribe(() => { lateNotifications++; }); wait.resolve(); await tick();
  assert.deepEqual(local.value, [{ id: 'owned' }]); assert.deepEqual(shared.value, { rows: [] });
  assert.equal(lateNotifications, 0); assert.equal(h.states.size, 2);
  assert.throws(() => local.binding, /unmounted/);
  h.emit({ type: 'stop' }); await done;
});

test('only dependent bodies rerun; synchronous writes batch', async () => {
  const h = await setup(), { ui } = h;
  const favorite = ui.State(false), timer = ui.State(0);
  let favoriteRuns = 0, timerRuns = 0;
  const done = launch(ui, ui.VStack([
    ui.View(() => { favoriteRuns++; return ui.Text(favorite.value ? 'yes' : 'no'); }),
    ui.View(() => { timerRuns++; return ui.Text(String(timer.value)); }),
  ]));
  timer.value = 1; timer.value = 2; timer.value = 3;
  await tick();
  assert.equal(timerRuns, 2); assert.equal(favoriteRuns, 1);
  favorite.value = true; await tick();
  assert.equal(favoriteRuns, 2); assert.equal(timerRuns, 2);
  h.emit({ type: 'stop' }); await done;
});

test('conditional dependencies are replaced after every evaluation', async () => {
  const h = await setup(), { ui } = h;
  const branch = ui.State(true), left = ui.State('left'), right = ui.State('right'); let runs = 0;
  const done = launch(ui, ui.View(() => { runs++; return ui.Text(branch.value ? left.value : right.value); }));
  right.value = 'unused'; await tick(); assert.equal(runs, 1);
  branch.value = false; await tick(); assert.equal(runs, 2);
  left.value = 'now unused'; await tick(); assert.equal(runs, 2);
  right.value = 'used'; await tick(); assert.equal(runs, 3);
  h.emit({ type: 'stop' }); await done;
});

test('keyed boundaries survive reorder and stale unmounted actions are discarded', async () => {
  const h = await setup(), { ui } = h;
  const reverse = ui.State(false), show = ui.State(true); let clicked = 0;
  const done = launch(ui, ui.View(() => ui.ForEach(
    (show.value ? (reverse.value ? ['b', 'a'] : ['a', 'b']) : ['b']), { id: x => x },
    item => ui.View(() => ui.Button(item, () => { clicked++; })),
  )));
  const before = new Map([...h.nodes.values()].filter(n => n.kind === 'button').map(n => [n.props.title, n.id]));
  reverse.value = true; await tick();
  const update = h.calls.filter(c => c.op === 'commit').at(-1);
  for (const n of update.nodes.filter(n => n.kind === 'button')) assert.equal(n.id, before.get(n.props.title));
  show.value = false; await tick();
  h.emit({ type: 'action', id: before.get('a') }); assert.equal(clicked, 0);
  h.emit({ type: 'action', id: before.get('b') }); assert.equal(clicked, 1);
  h.emit({ type: 'stop' }); await done;
});

test('native acknowledgements win over older queued native state events', async () => {
  const h = await setup(), { ui } = h;
  const state = ui.State('initial'), values = [];
  state.subscribe(value => values.push(value));
  h.states.set(1, { value: 'queued native', revision: 1 });
  state.value = 'newer JS';
  h.emit({ type: 'state', id: 1, value: 'queued native', revision: 1 });
  h.emit({ type: 'state', id: 1, value: 'duplicate', revision: 2 });
  assert.equal(state.value, 'newer JS'); assert.deepEqual(values, ['newer JS']);
  h.emit({ type: 'state', id: 1, value: 'latest native', revision: 3 });
  assert.equal(state.value, 'latest native');
  h.emit({ type: 'stop' });
});

test('stop hook runs once and unmount removes all subscriptions', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0); let stops = 0;
  const done = launch(ui, ui.View(() => ui.Text(String(value.value))), () => { stops++; });
  h.emit({ type: 'stop' }); h.emit({ type: 'stop' }); await done;
  assert.equal(stops, 1); assert.equal(value.dependents.size, 0);
  const count = h.calls.length; value.value = 4; await tick(); assert.equal(h.calls.length, count);
});

test('async bodies and duplicate keys reject startup and clean up', async () => {
  let h = await setup();
  await assert.rejects(launch(h.ui, h.ui.View(async () => h.ui.Text('invalid'))), /synchronously return/);
  assert.equal(h.calls.at(-1).op, 'dispose');
  h = await setup();
  assert.throws(() => h.ui.ForEach(['a', 'a'], { id: x => x }, x => h.ui.Text(x)), /Duplicate/);
  h.emit({ type: 'stop' });
});

test('state reads in ForEach row factories belong to the enclosing body', async () => {
  const h = await setup(), { ui } = h;
  const label = ui.State('first'); let runs = 0;
  const done = launch(ui, ui.View(() => {
    runs++;
    return ui.ForEach(['row'], { id: x => x }, () => ui.Text(label.value));
  }));
  label.value = 'second'; await tick();
  assert.equal(runs, 2);
  h.emit({ type: 'stop' }); await done;
});

test('recoverable previews discard partial mounts and retry when state changes', async () => {
  const h = await setup(), { ui } = h;
  const broken = ui.State(false); let clicks = 0;
  const done = launch(ui, ui.VStack([
    ui.TextEditor({ text: ui.State('source').binding, monospaced: true }),
    ui.View(() => ui.VStack([
      ui.Button('Partial mount', () => { clicks++; }),
      ui.View(() => { if (broken.value) throw new Error('preview failure'); return ui.Text('healthy'); }),
    ]), { fallback: error => ui.Text(error.message) }),
  ]));
  const oldAction = [...h.nodes.values()].find(n => n.kind === 'button').id;
  broken.value = true; await tick();
  assert.equal(h.status(), undefined);
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'preview failure'));
  h.emit({ type: 'action', id: oldAction }); assert.equal(clicks, 0);
  broken.value = false; await tick();
  const commit = h.calls.filter(c => c.op === 'commit').at(-1);
  assert.ok(commit.nodes.some(n => n.props.value === 'healthy'));
  const action = commit.nodes.find(n => n.kind === 'button').id;
  h.emit({ type: 'action', id: action }); assert.equal(clicks, 1);
  h.emit({ type: 'stop' }); await done;
  assert.equal(broken.dependents.size, 0);
});

test('preview fallback handles malformed descendants and tracks fresh failed body reads', async () => {
  const h = await setup(), { ui } = h;
  const mode = ui.State(0);
  const done = launch(ui, ui.View(() => {
    if (mode.value === 0) return ui.VStack([ui.Text('partial'), 42]);
    if (mode.value === 1) throw new Error('another failure');
    return ui.Text('recovered');
  }, { fallback: error => ui.Text(error.message) }));
  assert.equal(h.status(), undefined);
  mode.value = 1; await tick();
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'another failure'));
  mode.value = 2; await tick();
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'recovered'));
  h.emit({ type: 'stop' }); await done;
});

test('an outer preview catches a nested fallback failing on a descendant update', async () => {
  const h = await setup(), { ui } = h;
  const broken = ui.State(false);
  const done = launch(ui, ui.View(() => ui.View(() => {
    if (broken.value) throw new Error('inner body');
    return ui.Text('fine');
  }, { fallback: () => { throw new Error('inner fallback'); } }),
  { fallback: error => ui.Text(error.message) }));
  broken.value = true; await tick();
  assert.equal(h.status(), undefined);
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'inner fallback'));
  broken.value = false; await tick();
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'fine'));
  h.emit({ type: 'stop' }); await done;
});

test('web controls snapshot JSON data, update handlers, and discard unmounted messages', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(1), show = ui.State(true), messages = [], errors = [];
  const data = { nested: [1, true, null] };
  const standalone = ui.WebView({ html: '<p>test</p>', data });
  data.nested[0] = 99;
  assert.equal(standalone.props.data.nested[0], 1);
  assert.throws(() => ui.WebView({ html: '', data: { invalid: NaN } }), /JSON/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => ui.WebView({ html: '', data: cycle }), /JSON/);
  const done = launch(ui, ui.View(() => show.value ? ui.WebView({
    html: '<p>control</p>', data: { value: value.value },
    onMessage: message => messages.push([value.value, message]), onError: error => errors.push(error),
  }) : ui.Text('unmounted')));
  const id = [...h.nodes.values()].find(n => n.kind === 'webview').id;
  h.emit({ type: 'webMessage', id, value: { event: 'first' } });
  value.value = 2; await tick();
  const latest = h.calls.filter(c => c.op === 'commit').at(-1).nodes.find(n => n.kind === 'webview');
  assert.equal(latest.id, id); assert.equal(latest.props.data.value, 2);
  h.emit({ type: 'webMessage', id, value: 'second' });
  h.emit({ type: 'webError', id, message: 'web error' });
  assert.deepEqual(messages, [[1, { event: 'first' }], [2, 'second']]);
  assert.deepEqual(errors, ['web error']);
  show.value = false; await tick();
  h.emit({ type: 'webMessage', id, value: 'stale' });
  h.emit({ type: 'webError', id, message: 'stale' });
  assert.equal(messages.length, 2); assert.equal(errors.length, 1);
  h.emit({ type: 'stop' }); await done;
});

test('component state follows keys, uses current props, and releases after native unmount', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true), reversed = ui.State(false), label = ui.State('first');
  const instances = new Map(), cleanups = [], setups = [];
  const Counter = ui.Component((scope, initial) => {
    setups.push(initial.id);
    const count = scope.state(0);
    instances.set(initial.id, count);
    scope.onDispose(() => cleanups.push(`${initial.id}:first`));
    scope.onDispose(() => cleanups.push(`${initial.id}:last`));
    return props => ui.VStack([
      ui.Text(`${props.label}:${props.id}:${count.value}`),
      ui.Button(`increment-${props.id}`, () => { count.value++; }),
    ]);
  });
  const done = launch(ui, ui.View(() => shown.value ? ui.ForEach(
    reversed.value ? ['b', 'a'] : ['a', 'b'], { id: x => x },
    id => Counter({ id, label: label.value }),
  ) : ui.Text('hidden')));
  const a = instances.get('a'), id = a.binding.id;
  const button = [...h.nodes.values()].find(n => n.kind === 'button' && n.props.title === 'increment-a').id;
  h.emit({ type: 'action', id: button }); await tick();
  assert.equal(a.value, 1); assert.deepEqual(setups, ['a', 'b']);
  reversed.value = true; label.value = 'current'; await tick();
  assert.equal(instances.get('a'), a); assert.deepEqual(setups, ['a', 'b']);
  assert.ok(h.calls.filter(c => c.op === 'commit').at(-1).nodes.some(n => n.props.value === 'current:a:1'));
  shown.value = false; await tick();
  assert.equal(h.states.size, 3); // only the app-owned state remains
  assert.deepEqual(cleanups, ['b:last', 'b:first', 'a:last', 'a:first']);
  assert.equal(h.calls.at(-2).op, 'commit'); assert.equal(h.calls.at(-1).op, 'state.release');
  const requests = h.calls.length;
  a.value = 100;
  h.emit({ type: 'state', id, value: 200, revision: 500 });
  h.emit({ type: 'action', id: button });
  await tick(); assert.equal(a.value, 1); assert.equal(h.calls.length, requests);
  assert.throws(() => a.binding, /unmounted/);
  shown.value = true; await tick();
  assert.notEqual(instances.get('a'), a); assert.equal(instances.get('a').value, 0);
  h.emit({ type: 'stop' }); await done;
  assert.equal(h.states.size, 0); assert.equal(a.dependents.size, 0);
});

test('failed component setup/body disposes partial local state and registered cleanup', async () => {
  const h = await setup(), { ui } = h;
  const mode = ui.State(0); let disposed = 0;
  const FailedSetup = ui.Component(scope => {
    scope.state('partial'); scope.onDispose(() => { disposed++; });
    throw new Error('setup failed');
  });
  const FailedBody = ui.Component(scope => {
    scope.state('partial body'); scope.onDispose(() => { disposed++; });
    return () => 42;
  });
  const done = launch(ui, ui.View(() => mode.value === 0 ? FailedSetup() : FailedBody(),
    { fallback: error => ui.Text(error.message) }));
  assert.equal(disposed, 1); assert.equal(h.states.size, 1);
  mode.value = 1; await tick();
  assert.equal(disposed, 2); assert.equal(h.states.size, 1);
  assert.equal(h.status(), undefined);
  h.emit({ type: 'stop' }); await done;
});

test('cleanup failures still dispose sibling components and finish native shutdown', async () => {
  const h = await setup(), { ui } = h;
  const cleanups = [];
  const Child = ui.Component((scope, name) => {
    scope.state(name);
    scope.onDispose(() => { cleanups.push(name); if (name === 'a') throw new Error('cleanup failed'); });
    return () => ui.Text(name);
  });
  const done = launch(ui, ui.VStack([Child('a'), Child('b')]));
  const rejected = assert.rejects(done, /cleanup failed/);
  const previous = console.error; console.error = () => {};
  try { h.emit({ type: 'stop' }); } finally { console.error = previous; }
  await rejected;
  assert.deepEqual(cleanups, ['a', 'b']);
  assert.equal(h.calls.at(-1).op, 'dispose'); assert.equal(h.states.size, 0); assert.equal(h.status(), 1);
});

test('component definitions reset identity and scope allocation stays setup-only', async () => {
  const h = await setup(), { ui } = h;
  const alternative = ui.State(false); let old, current, scopeRef;
  const First = ui.Component(scope => { scopeRef = scope; old = scope.state(1); return () => ui.Text(String(old.value)); });
  const Second = ui.Component(scope => { current = scope.state(2); return () => ui.Text(String(current.value)); });
  const done = launch(ui, ui.View(() => alternative.value ? Second() : First()));
  assert.throws(() => scopeRef.state(3), /during setup/);
  assert.throws(() => scopeRef.onDispose(() => {}), /during setup/);
  alternative.value = true; await tick();
  assert.equal(h.states.size, 2); assert.equal(current.value, 2);
  assert.throws(() => old.binding, /unmounted/);
  h.emit({ type: 'stop' }); await done;
});

test('recovery does not subscribe to disposed component locals or endlessly recreate failures', async () => {
  const h = await setup(), { ui } = h;
  const retry = ui.State(0), broken = ui.State(true); let setups = 0, disposed = 0;
  const Child = ui.Component(scope => {
    setups++; const local = scope.state(0);
    scope.onDispose(() => { disposed++; });
    return () => {
      const value = local.value;
      if (broken.value) throw new Error('local render failed');
      return ui.Text(String(value));
    };
  });
  const done = launch(ui, ui.View(() => { retry.value; return Child(); }, { fallback: e => ui.Text(e.message) }));
  await tick(); assert.equal(setups, 1); assert.equal(disposed, 1); assert.equal(h.states.size, 2);
  retry.value++; await tick(); assert.equal(setups, 2); assert.equal(disposed, 2);
  broken.value = false; await tick(); assert.equal(setups, 3); assert.equal(h.states.size, 3);
  h.emit({ type: 'stop' }); await done; assert.equal(disposed, 3);
});

test('effects run after commit, batch writes, replace dependencies, and clean up before rerun', async () => {
  const h = await setup(), { ui } = h;
  const branch = ui.State(true), left = ui.State(1), right = ui.State(9);
  const log = []; let stopEffect;
  const Child = ui.Component(scope => {
    const output = scope.state(0);
    stopEffect = scope.effect(() => {
      assert.equal(h.calls.at(-1).op, 'commit');
      const value = branch.value ? left.value : right.value;
      log.push(`run:${value}`); output.value = value;
      return () => log.push(`cleanup:${value}`);
    });
    return () => ui.Text(`${branch.value ? left.value : right.value}:${output.value}`);
  });
  const done = launch(ui, Child());
  assert.deepEqual(log, []);
  await tick(); assert.deepEqual(log, ['run:1']);
  left.value = 2; left.value = 3; await tick();
  assert.deepEqual(log, ['run:1', 'cleanup:1', 'run:3']);
  right.value = 10; await tick(); assert.equal(log.length, 3);
  branch.value = false; await tick();
  assert.deepEqual(log.slice(-2), ['cleanup:3', 'run:10']);
  left.value = 20; await tick(); assert.equal(log.length, 5);
  stopEffect(); stopEffect(); assert.equal(log.at(-1), 'cleanup:10');
  right.value = 11; await tick(); assert.equal(log.length, 6);
  assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
  h.emit({ type: 'stop' }); await done;
  assert.equal(log.length, 6);
});

test('effects observe current shallow props only when scope.props is read', async () => {
  const h = await setup(), { ui } = h;
  const title = ui.State('a'), unrelated = ui.State(0);
  const seen = []; let once = 0, cleanups = 0;
  const Child = ui.Component(scope => {
    scope.effect(() => { seen.push(scope.props.title); return () => { cleanups++; }; });
    scope.effect(() => { once++; });
    return props => ui.Text(props.title);
  });
  const done = launch(ui, ui.View(() => { unrelated.value; return Child({ title: title.value }); }));
  await tick(); assert.deepEqual(seen, ['a']); assert.equal(once, 1);
  unrelated.value++; await tick(); assert.deepEqual(seen, ['a']); assert.equal(cleanups, 0);
  title.value = 'b'; await tick(); assert.deepEqual(seen, ['a', 'b']); assert.equal(cleanups, 1); assert.equal(once, 1);
  h.emit({ type: 'stop' }); await done;
  assert.equal(cleanups, 2); assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
});

test('effects from failed setup or render never start', async () => {
  const h = await setup(), { ui } = h;
  const mode = ui.State(0); let runs = 0;
  const Bad = ui.Component(scope => {
    scope.effect(() => { runs++; });
    if (mode.value === 0) throw new Error('setup');
    return () => { throw new Error('body'); };
  });
  const done = launch(ui, ui.View(() => { mode.value; return Bad(); }, { fallback: e => ui.Text(e.message) }));
  await tick(); assert.equal(runs, 0); assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
  mode.value = 1; await tick(); assert.equal(runs, 0); assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('stopped and self-stopping effects do not retain dependencies or leak returned cleanup', async () => {
  const h = await setup(), { ui } = h;
  const input = ui.State(0); let stopSelf, runs = 0, cleanups = 0, queuedRuns = 0;
  const Child = ui.Component(scope => {
    stopSelf = scope.effect(() => { input.value; runs++; stopSelf(); return () => { cleanups++; }; });
    const stopQueued = scope.effect(() => { queuedRuns++; });
    stopQueued();
    return () => ui.Text('child');
  });
  const done = launch(ui, Child());
  await tick(); assert.equal(runs, 1); assert.equal(cleanups, 1); assert.equal(queuedRuns, 0);
  assert.equal(input.dependents.size, 0);
  input.value++; await tick(); assert.equal(runs, 1);
  h.emit({ type: 'stop' }); await done; assert.equal(cleanups, 1);
});

test('cleanup and synchronous subscriber reads do not become effect dependencies', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(1), output = ui.State(0), listenerInput = ui.State(0), cleanupInput = ui.State(0);
  output.subscribe(() => { listenerInput.value; });
  let runs = 0;
  const Child = ui.Component(scope => {
    scope.effect(() => {
      runs++; output.value = source.value;
      return () => { cleanupInput.value; };
    });
    return () => ui.Text('child');
  });
  const done = launch(ui, Child());
  await tick(); source.value = 2; await tick(); assert.equal(runs, 2);
  listenerInput.value++; cleanupInput.value++; await tick(); assert.equal(runs, 2);
  assert.equal(listenerInput.dependents.size, 0); assert.equal(cleanupInput.dependents.size, 0);
  h.emit({ type: 'stop' }); await done;
});

test('an effect write can remove a component before its queued effect starts', async () => {
  const h = await setup(), { ui } = h;
  const shown = ui.State(true); let victimRuns = 0;
  const Controller = ui.Component(scope => { scope.effect(() => { shown.value = false; }); return () => ui.Text('controller'); });
  const Victim = ui.Component(scope => { scope.effect(() => { victimRuns++; }); return () => ui.Text('victim'); });
  const done = launch(ui, ui.VStack([Controller(), ui.View(() => shown.value ? Victim() : ui.Text('hidden'))]));
  await tick(); assert.equal(victimRuns, 0);
  h.emit({ type: 'stop' }); await done;
});

test('effect feedback loops fail with a diagnostic and release subscriptions', async () => {
  const h = await setup(), { ui } = h;
  const value = ui.State(0);
  const Child = ui.Component(scope => { scope.effect(() => { value.value++; }); return () => ui.Text('cycle'); });
  const previous = console.error; console.error = () => {};
  try {
    const done = launch(ui, Child());
    await assert.rejects(done, /did not settle/);
  } finally { console.error = previous; }
  assert.equal(h.status(), 1); assert.equal(value.dependents.size, 0);
  assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
});

test('effect and cleanup failures still clean up other effects and stop the native host', async () => {
  for (const failure of ['body', 'cleanup', 'async-body', 'async-cleanup']) {
    const h = await setup(), { ui } = h;
    const value = ui.State(0); let cleaned = 0;
    const Child = ui.Component(scope => {
      scope.effect(() => () => { cleaned++; });
      scope.effect(() => {
        value.value;
        if (failure === 'body') throw new Error('effect failure');
        if (failure === 'async-body') return Promise.resolve();
        return () => {
          if (failure === 'async-cleanup') return Promise.resolve();
          throw new Error('cleanup failure');
        };
      });
      return () => ui.Text('child');
    });
    const previous = console.error; console.error = () => {};
    try {
      const done = launch(ui, Child());
      const rejected = assert.rejects(done, /failure|synchronous|synchronously/);
      if (failure === 'cleanup' || failure === 'async-cleanup') { await tick(); value.value++; }
      await rejected;
    } finally { console.error = previous; }
    assert.equal(cleaned, 1, failure); assert.equal(h.status(), 1);
    assert.equal(h.calls.at(-1).op, 'dispose');
    assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
  }
});

test('large keyed lists of independent state-writing effects do not look like a feedback loop', async () => {
  const h = await setup(), { ui } = h;
  let runs = 0, cleaned = 0;
  const Child = ui.Component(scope => {
    const value = scope.state(0);
    scope.effect(() => { value.value = 1; runs++; return () => { cleaned++; }; });
    return () => ui.Text(String(value.value));
  });
  const done = launch(ui, ui.ForEach(Array.from({ length: 150 }, (_, i) => i), { id: n => n }, () => Child()));
  await tick(); assert.equal(runs, 150); assert.equal(h.status(), undefined);
  h.emit({ type: 'stop' }); await done; assert.equal(cleaned, 150);
});

test('render bodies cannot synchronously stop effects and run resource cleanup', async () => {
  const h = await setup(), { ui } = h;
  let started = 0;
  const Child = ui.Component(scope => {
    const stop = scope.effect(() => { started++; });
    return () => { stop(); return ui.Text('invalid'); };
  });
  const done = launch(ui, ui.View(() => Child(), { fallback: e => ui.Text(e.message) }));
  await tick(); assert.equal(started, 0); assert.equal(h.status(), undefined);
  assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
  h.emit({ type: 'stop' }); await done;
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('tasks cancel superseded runs and prevent stale scoped/global writes and external commits', async () => {
  const h = await setup(), { ui } = h;
  const query = ui.State('a'), shared = ui.State('initial'), shown = ui.State(true);
  const runs = [], canceled = [], external = []; let output;
  const Child = ui.Component(scope => {
    output = scope.state('pending');
    scope.task(async task => {
      const name = query.value, wait = deferred();
      runs.push({ name, task, wait });
      task.onCancel(() => canceled.push(name));
      task.signal.addEventListener('abort', () => { shared.value = `abort:${name}`; });
      try { await wait.promise; } finally { shared.value = `finally:${name}`; }
      output.value = name; shared.value = name;
      task.commit(() => external.push(name));
    });
    return () => ui.Text(output.value);
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden')));
  await tick(); assert.equal(runs.length, 1);
  query.value = 'b'; await tick();
  assert.equal(runs.length, 2); assert.equal(runs[0].task.signal.aborted, true);
  assert.deepEqual(canceled, ['a']); assert.equal(shared.value, 'initial');
  runs[1].wait.resolve(); await tick();
  assert.equal(output.value, 'b'); assert.equal(shared.value, 'b'); assert.deepEqual(external, ['b']);
  runs[0].wait.resolve(); await tick();
  assert.equal(output.value, 'b'); assert.equal(shared.value, 'b'); assert.deepEqual(external, ['b']);
  assert.equal(runs[0].task.isCurrent, false); assert.equal(runs[1].task.isCurrent, true);
  shown.value = false; await tick();
  assert.equal(runs[1].task.signal.aborted, true); assert.equal(shared.value, 'b');
  assert.deepEqual(canceled, ['a', 'b']); assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('task dependency tracking is synchronous, conditional and batched', async () => {
  const h = await setup(), { ui } = h;
  const branch = ui.State(true), left = ui.State(1), right = ui.State(9), afterAwait = ui.State(0);
  const runs = [];
  const Child = ui.Component(scope => {
    scope.task(async task => {
      const value = branch.value ? left.value : right.value, wait = deferred();
      runs.push({ value, task, wait });
      await wait.promise; afterAwait.value;
    });
    return () => ui.Text('child');
  });
  const done = launch(ui, Child()); await tick();
  right.value = 10; await tick(); assert.equal(runs.length, 1);
  left.value = 2; left.value = 3; await tick(); assert.equal(runs.length, 2); assert.equal(runs[1].value, 3);
  branch.value = false; await tick(); assert.equal(runs.length, 3); assert.equal(runs[2].value, 10);
  assert.equal(runs[1].task.signal.aborted, true);
  left.value = 4; await tick(); assert.equal(runs.length, 3);
  runs[2].wait.resolve(); await tick();
  afterAwait.value++; await tick(); assert.equal(runs.length, 3); assert.equal(afterAwait.dependents.size, 0);
  h.emit({ type: 'stop' }); await done;
  for (const run of runs) run.wait.resolve(); await tick();
  assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
});

test('tasks observe current props and quietly handle obsolete rejections', async () => {
  const h = await setup(), { ui } = h;
  const title = ui.State('a'), unrelated = ui.State(0), shared = ui.State('safe');
  const runs = [];
  const Child = ui.Component(scope => {
    scope.task(async task => {
      const name = scope.props.name, wait = deferred(); runs.push({ name, task, wait });
      try { await wait.promise; shared.value = name; } finally { if (name === 'a') shared.value = 'obsolete finally'; }
    });
    return () => ui.Text('child');
  });
  const done = launch(ui, ui.View(() => { unrelated.value; return Child({ name: title.value }); }));
  await tick(); unrelated.value++; await tick(); assert.equal(runs.length, 1);
  title.value = 'b'; await tick(); assert.equal(runs.length, 2); assert.equal(runs[1].name, 'b');
  runs[1].wait.resolve(); await tick(); assert.equal(shared.value, 'b');
  runs[0].wait.reject(new Error('obsolete rejection')); await tick();
  assert.equal(h.status(), undefined); assert.equal(shared.value, 'b');
  h.emit({ type: 'stop' }); await done;
});

test('task stop owns subscriptions and guards late callbacks, allocation and cleanup registration', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(0), shared = ui.State('safe');
  const wait = deferred(); let taskRef, stopTask, cleaned = 0, lateCleaned = 0, local, lateAllocation;
  const Child = ui.Component(scope => {
    local = scope.state('initial');
    stopTask = scope.task(async task => {
      taskRef = task;
      source.subscribe(value => { shared.value = `sub:${value}`; });
      const unregister = task.onCancel(() => { throw new Error('must be unregistered'); }); unregister();
      task.onCancel(() => { cleaned++; });
      task.signal.addEventListener('abort', () => { shared.value = 'abort'; queueMicrotask(() => { shared.value = 'abort microtask'; }); });
      await wait.promise;
      local.value = 'late'; shared.value = 'late';
      source.subscribe(() => { shared.value = 'late subscription'; });
      task.onCancel(() => { lateCleaned++; });
      try { ui.State('late allocation'); } catch (error) { lateAllocation = error.message; }
    });
    return () => ui.Text(local.value);
  });
  const done = launch(ui, Child()); await tick();
  source.value = 1; assert.equal(shared.value, 'sub:1');
  stopTask(); stopTask(); await tick();
  assert.equal(cleaned, 1); assert.equal(taskRef.signal.aborted, true); assert.equal(shared.value, 'sub:1');
  const allocations = h.calls.filter(c => c.op === 'state.create').length;
  wait.resolve(); await tick();
  assert.equal(local.value, 'initial'); assert.equal(shared.value, 'sub:1'); assert.equal(lateCleaned, 1);
  assert.match(lateAllocation, /cancelled task/);
  assert.equal(h.calls.filter(c => c.op === 'state.create').length, allocations);
  source.value = 2; await tick(); assert.equal(shared.value, 'sub:1');
  h.emit({ type: 'stop' }); await done; assert.equal(cleaned, 1);
  assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
});

test('completed task resources remain owned until stop or unmount', async () => {
  const h = await setup(), { ui } = h;
  const source = ui.State(0), shared = ui.State(0); let context, cleaned = 0, stopTask;
  const Child = ui.Component(scope => {
    stopTask = scope.task(async task => {
      context = task; task.onCancel(() => { cleaned++; });
      source.subscribe(value => { shared.value = value; });
    });
    return () => ui.Text('child');
  });
  const done = launch(ui, Child()); await tick();
  assert.deepEqual(ui.__testing.taskStats(), { pending: 0 }); assert.equal(context.isCurrent, true);
  source.value = 1; assert.equal(shared.value, 1);
  stopTask(); source.value = 2; assert.equal(shared.value, 1); assert.equal(cleaned, 1);
  h.emit({ type: 'stop' }); await done; assert.equal(cleaned, 1);
});

test('task writes do not lend their cancellation context to ordinary effects, cleanup or subscribers', async () => {
  const h = await setup(), { ui } = h;
  const input = ui.State(0), effectOutput = ui.State(-1), cleanupOutput = ui.State('before');
  const source = ui.State(0), subscriberOutput = ui.State(-1), shown = ui.State(true);
  const waits = [], subscriberWait = deferred();
  source.subscribe(value => { subscriberWait.promise.then(() => { subscriberOutput.value = value; }); });
  const Child = ui.Component(scope => {
    scope.onDispose(() => { cleanupOutput.value = 'disposed'; });
    scope.task(async () => {
      const value = input.value, wait = deferred(); waits.push(wait);
      await wait.promise;
      if (value === 0) { input.value = 1; source.value = 7; }
      else shown.value = false;
    });
    scope.effect(() => { effectOutput.value = input.value; });
    return () => ui.Text('child');
  });
  const done = launch(ui, ui.View(() => shown.value ? Child() : ui.Text('hidden')));
  await tick(); waits[0].resolve(); await tick();
  assert.equal(waits.length, 2); assert.equal(effectOutput.value, 1);
  subscriberWait.resolve(); await tick(); assert.equal(subscriberOutput.value, 7);
  waits[1].resolve(); await tick(); assert.equal(cleanupOutput.value, 'disposed');
  assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
  h.emit({ type: 'stop' }); await done;
});

test('failed mounts never launch tasks and synchronous self-stop aborts immediately', async () => {
  const h = await setup(), { ui } = h;
  const failed = ui.State(true), shared = ui.State('safe'); let started = 0, stopSelf, cleaned = 0;
  const Child = ui.Component(scope => {
    stopSelf = scope.task(task => {
      started++; stopSelf();
      assert.equal(task.signal.aborted, true); assert.equal(task.isCurrent, false);
      shared.value = 'bad'; task.onCancel(() => { cleaned++; });
    });
    return () => { if (failed.value) throw new Error('render failed'); return ui.Text('good'); };
  });
  const done = launch(ui, ui.View(() => Child(), { fallback: e => ui.Text(e.message) }));
  await tick(); assert.equal(started, 0); assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
  failed.value = false; await tick(); assert.equal(started, 1); assert.equal(cleaned, 1); assert.equal(shared.value, 'safe');
  h.emit({ type: 'stop' }); await done;
});

test('current task failures and cancellation cleanup errors dispose sibling work', async () => {
  for (const mode of ['sync', 'reject', 'cleanup', 'async-cleanup', 'invalid-result', 'async-commit']) {
    const h = await setup(), { ui } = h;
    const input = ui.State(0), never = deferred(); let otherCleaned = 0;
    const Child = ui.Component(scope => {
      scope.task(async task => { task.onCancel(() => { otherCleaned++; }); await never.promise; });
      scope.task(task => {
        input.value;
        if (mode === 'sync') throw new Error('task failure');
        if (mode === 'reject') return Promise.reject(new Error('task failure'));
        if (mode === 'invalid-result') return 42;
        if (mode === 'async-commit') { task.commit(async () => {}); return; }
        task.onCancel(() => { if (mode === 'async-cleanup') return Promise.resolve(); throw new Error('task cleanup failure'); });
        return never.promise;
      });
      return () => ui.Text('child');
    });
    const previous = console.error; console.error = () => {};
    try {
      const done = launch(ui, Child());
      const rejected = assert.rejects(done, /failure|synchronous|undefined or a Promise/);
      if (mode === 'cleanup' || mode === 'async-cleanup') { await tick(); input.value++; }
      await rejected;
    } finally { console.error = previous; }
    assert.equal(h.status(), 1, mode); assert.equal(otherCleaned, 1, mode);
    assert.deepEqual(ui.__testing.taskStats(), { pending: 0 });
    assert.deepEqual(ui.__testing.effectStats(), { active: 0, pending: 0 });
    never.resolve(); await tick();
  }
});
