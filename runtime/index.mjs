import { AsyncLocalStorage } from "node:async_hooks";
import { isPromise } from "node:util/types";
import { randomUUID } from "node:crypto";
// Public constructors build immutable values. Only mounted values own native views.
const bridge = globalThis.__jonuiNative;
if (!bridge) throw new Error('Run this application with the jonui launcher');
function request(op, args = {}) {
  const result = JSON.parse(bridge.request(JSON.stringify({ op, ...args })));
  if (result.error) throw new Error(result.error);
  return result;
}
let nextState = 1, nextView = 1, nextSubmit = 1, nextEditing = 1, nextAppearance = 1, nextTap = 1, active = null, root = null, stop = null;
let stopped = false, scheduled = false, mounting = false, flushing = false;
const cells = new Map(), actions = new Map(), dirty = new Set(), updates = new Map();
const recoveryScopes = [];
const pendingStateReleases = new Set();
const pendingEffects = new Set(), effects = new Set();
const taskStorage = new AsyncLocalStorage(), pendingTasks = new Set();
let focusLeaseClock = 0;
const computationStorage = new AsyncLocalStorage(), computations = new Set();
const liveDependencies = new WeakSet();
const webErrors = new Map(), webAPIs = new Map();
let nextWebEpoch = 1;
const textSubmits = new Map();
const textEditings = new Map();
const appearances = new Map();
const taps = new Map();
const windowViews = new Map();
const viewMarker = Symbol('JonUI.View');
const bindingMarker = Symbol('JonUI.Binding');
const focusBindings = new WeakMap();
const focusControllers = new WeakMap();
function focusProjection(value) {
  const projection = focusBindings.get(value);
  if (!projection) throw new TypeError('Expected an owned FocusBinding');
  if (projection.owner.disposed) throw new Error('Cannot use a disposed FocusBinding');
  return projection;
}
const supportedKinds = new Set(['text', 'image', 'spacer', 'divider', 'vstack', 'hstack', 'lazyvstack', 'lazyhstack', 'lazyvgrid', 'lazyhgrid', 'scroll', 'form', 'section', 'slider', 'stepper', 'picker', 'datepicker', 'button', 'toggle', 'textfield', 'securefield', 'texteditor', 'webview', 'split', 'list', 'foreach', 'dynamic', 'component', 'modifier']);
// UTC instants spanning years 0001 through 9999, in Unix milliseconds.
const earliestDate = -62135596800000, latestDate = 253402300799999;
function dateTimestamp(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < earliestDate || value > latestDate) throw new TypeError(`${label} must be Unix milliseconds within UTC years 0001...9999`);
}
const horizontalAlignments = ['leading', 'center', 'trailing'];
const verticalAlignments = ['top', 'center', 'bottom', 'firstTextBaseline', 'lastTextBaseline'];
const frameAlignments = [...horizontalAlignments, 'top', 'bottom', 'topLeading', 'topTrailing', 'bottomLeading', 'bottomTrailing'];
function layoutOptions(options, keys, label) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError(`${label} requires an options object`);
  const props = {};
  for (const [key, value] of Object.entries(options)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown ${label} option: ${key}`);
    if (value !== undefined) props[key] = value;
  }
  return props;
}
function layoutNumber(value, label, nonnegative = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || nonnegative && value < 0) throw new TypeError(`${label} must be a finite${nonnegative ? ' nonnegative' : ''} number`);
  return value;
}
function layoutEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`Invalid ${label}: ${String(value)}`);
}
function frameOptions(options) {
  const props = layoutOptions(options, ['width', 'height', 'minWidth', 'idealWidth', 'maxWidth', 'minHeight', 'idealHeight', 'maxHeight', 'alignment'], 'frame');
  const fixed = 'width' in props || 'height' in props;
  const flexible = Object.keys(props).some(key => /^(min|ideal|max)/.test(key));
  if (fixed && flexible) throw new TypeError('Fixed and flexible frame options must use separate modifiers');
  for (const [key, value] of Object.entries(props)) {
    if (key === 'alignment') layoutEnum(value, frameAlignments, 'frame alignment');
    else if (!key.startsWith('max') || value !== 'infinity') layoutNumber(value, `frame ${key}`, true);
  }
  for (const axis of ['Width', 'Height']) {
    const values = ['min', 'ideal', 'max'].map(key => props[key + axis]).filter(value => value !== undefined).map(value => value === 'infinity' ? Infinity : value);
    if (values.some((value, index) => index && value < values[index - 1])) throw new TypeError('Frame bounds must be ordered min <= ideal <= max');
  }
  return props;
}
function stackOptions(options, vertical) {
  const props = layoutOptions(options, ['alignment', 'spacing'], vertical ? 'VStack' : 'HStack');
  if ('alignment' in props) layoutEnum(props.alignment, vertical ? horizontalAlignments : verticalAlignments, 'stack alignment');
  if ('spacing' in props) layoutNumber(props.spacing, 'stack spacing');
  return props;
}
function taskIsCurrent(run) {
  if (stopped || run.cancelled || run.owner.disposed) return false;
  if (run.web && !request('web.claim', run.route).accepted) {
    webAPIs.get(run.route.id)?.runs.delete(run.key); cancelTask(run); return false;
  }
  return true;
}
function registerTaskCleanup(run, cleanup) {
  assertNotComputing('register task cleanup');
  if (typeof cleanup !== 'function') throw new TypeError('Task cleanup must be a function');
  if (active && !active.effect) throw new Error('Register task cleanup outside view bodies');
  if (!taskIsCurrent(run)) {
    taskStorage.run(run, () => synchronousCleanup(cleanup, "Task cleanup"));
    return () => {};
  }
  run.cleanups.add(cleanup);
  return () => run.cleanups.delete(cleanup);
}
function cancelTask(run) {
  if (!run || run.cancelled) return;
  run.cancelled = true; pendingTasks.delete(run);
  const failures = [];
  // Abort listeners run in the obsolete task's context too, so their State
  // writes cannot erase the result of a newer task or resurrect an owner.
  taskStorage.run(run, () => {
    try { run.controller.abort(); } catch (error) { failures.push(error); }
    for (const cleanup of [...run.cleanups].reverse()) {
      try { synchronousCleanup(cleanup, "Task cleanup"); } catch (error) { failures.push(error); }
    }
  });
  run.cleanups.clear();
  throwFailures(failures);
}
function createTaskContext(run) {
  return Object.freeze({
    signal: run.controller.signal,
    get isCurrent() { return taskIsCurrent(run); },
    onCancel(cleanup) { return registerTaskCleanup(run, cleanup); },
    commit(callback) {
      if (!taskIsCurrent(run)) return false;
      assertNotComputing('commit task results');
      if (active && !active.effect) throw new Error('Commit task results outside view bodies');
      if (typeof callback !== 'function') throw new TypeError('Task commit expects a function');
      const result = taskStorage.run(run, () => untracked(callback));
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError('Task commit must be synchronous');
      }
      return true;
    },
  });
}
function startTask(owner, callback, remember) {
  const run = { owner, focusEpoch: focusLeaseClock, cancelled: false, controller: new AbortController(), cleanups: new Set() };
  remember(run); pendingTasks.add(run);
  const context = createTaskContext(run);
  let result;
  try {
    result = taskStorage.run(run, () => callback(context));
    if (result !== undefined && (!result || typeof result.then !== 'function')) throw new TypeError('Task callbacks must return undefined or a Promise');
  } catch (error) {
    try { cancelTask(run); } catch (cleanupError) { throw new AggregateError([error, cleanupError], String(error)); }
    throw error;
  }
  Promise.resolve(result).then(() => {
    pendingTasks.delete(run);
  }, error => {
    pendingTasks.delete(run);
    if (!taskIsCurrent(run)) return;
    try { cancelTask(run); } catch (cleanupError) { error = new AggregateError([error, cleanupError], String(error)); }
    taskStorage.run(undefined, () => fail(error));
  });
  return () => cancelTask(run);
}
function invalidate(dependency) {
  for (const observer of [...dependency.dependents]) {
    if (!observer.alive || observer.effect && observer.owner.disposed) continue;
    if (observer.computed) {
      if (observer.stale) continue;
      observer.stale = true;
      // A stale cache needs no subscriptions until it is read again. Detach
      // immediately so even unobserved derivations release disposed inputs.
      detachComputation(observer);
      invalidate(observer);
    } else (observer.effect ? pendingEffects : dirty).add(observer);
  }
}
function assertNotComputing(action) {
  if (computationStorage.getStore()) throw new Error(`Computed callbacks cannot ${action}`);
}
function readDependency(dependency) {
  if (!active) return;
  active.nextDependencies.add(dependency);
  // Subscribe immediately so an effect reading then writing its own input is
  // scheduled again and diagnosed, including on its very first execution.
  if (active.effect) dependency.dependents.add(active);
}
function untracked(callback) {
  const previous = active; active = null;
  try { return callback(); } finally { active = previous; }
}
function synchronousCleanup(callback, label = "Effect cleanup") {
  const result = untracked(callback);
  if (result && typeof result.then === 'function') {
    Promise.resolve(result).catch(() => {});
    throw new TypeError(`${label} must be synchronous`);
  }
}
function stateSnapshot(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('State numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('State requires JSON values');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('State objects must be plain records');
  if (ancestors.has(value)) throw new TypeError('State cannot contain cycles');
  ancestors.add(value);
  try {
    const result = array ? [] : {};
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw new TypeError('State arrays must be dense without extra properties');
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('State requires enumerable data properties without symbols or accessors');
      }
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('State arrays cannot have extra properties');
      Object.defineProperty(result, key, {
        value: stateSnapshot(descriptor.value, ancestors), enumerable: true, writable: true, configurable: true,
      });
    }
    return Object.freeze(result);
  } finally { ancestors.delete(value); }
}
function equalState(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalState(left[key], right[key]));
}
function binding(value) {
  if (!value?.[bindingMarker]) throw new TypeError('Expected a JonUI binding');
  return value.id;
}
export function State(initialValue) {
  assertNotComputing('allocate State');
  const task = taskStorage.getStore();
  if (task && !taskIsCurrent(task)) throw new Error('Cannot allocate State from a cancelled task');
  if (active) throw new Error("Allocate State outside View bodies");
  return createState(initialValue);
}
function createState(initialValue, owner = null) {
  const id = nextState++;
  const first = request('state.create', { id, value: stateSnapshot(initialValue) });
  let value = stateSnapshot(first.value), revision = first.revision, disposed = false;
  const dependents = new Set(), listeners = new Set();
  const cell = {
    get value() {
      if (active && disposed) throw new Error('Cannot read unmounted component state from a view');
      readDependency(cell);
      return value;
    },
    set value(next) {
      assertNotComputing('write State');
      const task = taskStorage.getStore();
      if (stopped || disposed || task && !taskIsCurrent(task)) return;
      if (active && !active.effect) throw new Error("View bodies cannot write State");
      const committed = request('state.write', { id, value: stateSnapshot(next) });
      accept(committed);
    },
    get binding() {
      if (disposed) throw new Error('Cannot bind unmounted component state');
      if (value !== null && typeof value === 'object') throw new TypeError('Native bindings require scalar State; use a separate scalar cell for editable fields');
      return nativeBinding;
    },
    subscribe(listener) {
      assertNotComputing('subscribe to State');
      if (typeof listener !== 'function') throw new TypeError('Expected a listener');
      const task = taskStorage.getStore();
      if (stopped || disposed || task && !taskIsCurrent(task)) return () => {};
      const wrapped = task ? value => {
        if (taskIsCurrent(task)) taskStorage.run(task, () => listener(value));
      } : listener;
      let unregister = () => {};
      const unsubscribe = () => { listeners.delete(wrapped); unregister(); };
      listeners.add(wrapped);
      if (task) unregister = registerTaskCleanup(task, unsubscribe);
      return unsubscribe;
    },
    dependents,
  };
  const nativeBinding = Object.freeze({ [bindingMarker]: true, id });
  function accept(event) {
    if (event.revision <= revision || stopped || disposed) return;
    const next = stateSnapshot(event.value);
    revision = event.revision;
    if (equalState(value, next)) return;
    value = next;
    invalidate(cell);
    // Notify after the native acknowledgement, before any scheduled body runs.
    try {
      taskStorage.run(undefined, () => untracked(() => { for (const listener of [...listeners]) listener(value); }));
    } finally { schedule(); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    // Remaining consumers outside the owner must retry rather than silently
    // retaining a subscription to a cell whose native binding has been freed.
    liveDependencies.delete(cell);
    invalidate(cell);
    dependents.clear(); listeners.clear(); cells.delete(id);
    pendingStateReleases.add(id);
  }
  liveDependencies.add(cell);
  cells.set(id, { accept, cell, listeners, dispose });
  owner?.cells.add(id);
  return cell;
}
/** A lazy, read-only JSON derivation; root instances are app-owned. */
export function Computed(callback) {
  assertNotComputing('allocate Computed values');
  const task = taskStorage.getStore();
  if (stopped || task && !taskIsCurrent(task)) throw new Error('Cannot allocate Computed after its lifetime ends');
  if (active) throw new Error('Allocate Computed outside reactive callbacks');
  return createComputed(callback);
}
function createComputed(callback, owner = null) {
  if (typeof callback !== 'function') throw new TypeError('Computed expects a synchronous derivation');
  const observer = {
    computed: true, alive: true, stale: true, evaluating: false, callback, owner,
    dependencies: new Set(), nextDependencies: new Set(), dependents: new Set(),
    hasValue: false, value: undefined, failed: false, error: undefined,
  };
  computations.add(observer); owner?.computations.add(observer); liveDependencies.add(observer);
  return Object.freeze({
    get value() {
      if (!observer.alive) throw new Error('Cannot read disposed Computed');
      if (observer.owner?.disposed) {
        // Lifetime cleanup may inspect the last successful result, but must
        // never reevaluate against props/cells already detached by unmount.
        if (!active && observer.hasValue && !observer.failed) return observer.value;
        throw new Error('Cannot evaluate Computed while its component is unmounting');
      }
      readDependency(observer);
      if (observer.evaluating) throw new Error('Computed dependency cycle');
      if (observer.stale) {
        observer.evaluating = true;
        try {
          const next = computationStorage.run(true, () => track(observer, () => {
            const result = observer.callback();
            if (isPromise(result)) {
              Promise.resolve(result).catch(() => {});
              throw new TypeError('Computed callbacks must return synchronous JSON values');
            }
            return stateSnapshot(result);
          }));
          if (!observer.hasValue || !equalState(observer.value, next)) observer.value = next;
          observer.hasValue = true; observer.failed = false; observer.error = undefined;
        } catch (error) {
          observer.failed = true; observer.error = error;
        } finally { observer.stale = false; observer.evaluating = false; }
      }
      if (observer.failed) throw observer.error;
      return observer.value;
    },
  });
}
function detachComputation(observer) {
  for (const dependency of [...observer.dependencies, ...observer.nextDependencies]) dependency.dependents.delete(observer);
  observer.dependencies.clear(); observer.nextDependencies.clear();
}
function disposeComputed(observer) {
  if (!observer.alive) return;
  observer.alive = false;
  computations.delete(observer); observer.owner?.computations.delete(observer);
  liveDependencies.delete(observer); invalidate(observer);
  detachComputation(observer); observer.dependents.clear();
  observer.callback = null; observer.value = undefined; observer.error = undefined;
}
class ViewValue {
  constructor(kind, props = {}, children = []) {
    this[viewMarker] = true; this.kind = kind; this.props = props; this.children = children;
    Object.freeze(this.props); Object.freeze(this.children); Object.freeze(this);
  }
  modifier(name, props) { return new ViewValue('modifier', { name, ...props }, [this]); }
  font(value) { return this.modifier('font', { value }); }
  foregroundStyle(value) { return this.modifier('foregroundStyle', { value }); }
  padding(options = 16) {
    if (typeof options === 'number') return this.modifier('padding', { points: layoutNumber(options, 'padding') });
    const props = layoutOptions(options, ['top', 'leading', 'bottom', 'trailing'], 'padding');
    for (const value of Object.values(props)) layoutNumber(value, 'padding');
    return this.modifier('padding', props);
  }
  frame(options) { return this.modifier('frame', frameOptions(options)); }
  fixedSize(options) {
    const props = options === undefined ? { horizontal: true, vertical: true } : { horizontal: false, vertical: false, ...layoutOptions(options, ['horizontal', 'vertical'], 'fixedSize') };
    if (Object.values(props).some(value => typeof value !== 'boolean')) throw new TypeError('fixedSize axes must be boolean');
    return this.modifier('fixedSize', props);
  }
  layoutPriority(value) { return this.modifier('layoutPriority', { value: layoutNumber(value, 'layoutPriority') }); }
  navigationTitle(value) { return this.modifier('navigationTitle', { value }); }
  accessibilityIdentifier(value) { return this.modifier('accessibilityIdentifier', { value }); }
  contentShape(shape, ...unsupported) {
    if (unsupported.length || !['rectangle', 'circle', 'ellipse', 'capsule'].includes(shape)) throw new TypeError('contentShape expects one native interaction shape');
    return this.modifier('contentShape', { shape });
  }
  disabled(value = true) {
    if (typeof value !== 'boolean') throw new TypeError('disabled expects a boolean');
    return this.modifier('disabled', { value });
  }
  focusSection(...args) {
    if (args.length) throw new TypeError('focusSection accepts no arguments');
    return this.modifier('focusSection', {});
  }
  onAppear(callback) {
    if (typeof callback !== 'function') throw new TypeError('onAppear expects a function');
    return this.modifier('onAppear', { onAppearance: callback });
  }
  onDisappear(callback) {
    if (typeof callback !== 'function') throw new TypeError('onDisappear expects a function');
    return this.modifier('onDisappear', { onAppearance: callback });
  }
  onTapGesture(callback, options = {}) {
    if (typeof callback !== 'function') throw new TypeError('onTapGesture expects a function');
    const { count = 1, priority = 'normal' } = layoutOptions(options, ['count', 'priority'], 'onTapGesture');
    if (count !== 1 && count !== 2) throw new TypeError('Tap count must be 1 or 2');
    if (!['normal', 'high', 'simultaneous'].includes(priority)) throw new TypeError('Invalid tap priority');
    return this.modifier('onTapGesture', { count, priority, onTap: callback });
  }
  focused(binding) {
    const projection = focusProjection(binding);
    if (this.kind === 'modifier' && this.children.length === 1) return new ViewValue(this.kind, this.props, [this.children[0].focused(binding)]);
    if (!['textfield', 'securefield', 'texteditor', 'datepicker', 'stepper', 'picker', 'button', 'toggle', 'slider', 'webview'].includes(this.kind)) throw new TypeError('focused requires one text input, DatePicker, Stepper, Picker, Button, Toggle, Slider or WebView');
    if (this.props.focusName !== undefined && !this.props.focusBinding && this.props.focusName !== projection.name) throw new TypeError('focused conflicts with explicit focusName');
    return new ViewValue(this.kind, { ...this.props, focusName: projection.name, focusBinding: binding }, this.children);
  }
  keyboardShortcut(key, ...unsupported) {
    if (this.kind === 'modifier' && this.children.length === 1) return new ViewValue(this.kind, this.props, [this.children[0].keyboardShortcut(key, ...unsupported)]);
    if (this.kind !== 'button') throw new TypeError('keyboardShortcut requires one Button');
    if (typeof key !== 'string' || !/^[a-z0-9]$/.test(key)) throw new TypeError('Shortcut key must be one lowercase ASCII letter or digit');
    if (unsupported.length) throw new TypeError('keyboardShortcut currently supports the default command modifier only');
    const shortcut = Object.freeze({ key });
    return new ViewValue(this.kind, { ...this.props, shortcut }, this.children);
  }
  tag(value) { itemKey(value); return this.modifier('tag', { value }); }
  sheet({ isPresented, content }) { return new ViewValue('modifier', { name: 'sheet', state: binding(isPresented) }, [this, content]); }
  window(options) {
    const props = layoutOptions(options, ['isPresented', 'content', 'title', 'width', 'height'], 'window');
    if (typeof props.title !== 'string' || ![props.width, props.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)) throw new TypeError('window requires a title and positive finite dimensions');
    return new ViewValue('modifier', { name: 'window', state: binding(props.isPresented), title: props.title, width: props.width, height: props.height }, [this, props.content]);
  }
}
export function View(body, options = {}) {
  if (typeof body !== 'function') throw new TypeError('View expects a synchronous body');
  if (options.fallback !== undefined && typeof options.fallback !== 'function') throw new TypeError('View fallback must be a function');
  return new ViewValue('dynamic', { body, fallback: options.fallback });
}
/** Define once; each mounted instance owns its setup state and cleanup. */
export function Component(setup) {
  if (typeof setup !== 'function') throw new TypeError('Component expects a setup function');
  const definition = Object.freeze({});
  return props => new ViewValue('component', { definition, setup, componentProps: props });
}
function windowRoot(mounted) {
  for (let child = mounted, parent = child?.parent; parent; child = parent, parent = parent.parent) {
    if (parent.value.kind === 'modifier' && parent.value.props.name === 'window' && child.key === '1') return parent.id;
  }
  return 0;
}
function initializeComponent(mounted) {
  const owned = { cells: new Set(), computations: new Set(), effects: new Set(), propsSignal: { dependents: new Set() }, nextEffectIndex: 0, cleanups: [], initializing: true, disposed: false, render: null };
  owned.windowRoot = windowRoot(mounted);
  liveDependencies.add(owned.propsSignal);
  mounted.component = owned;
  const scope = Object.freeze({
    get props() {
      if (active && owned.disposed) throw new Error('Cannot observe unmounted component props');
      readDependency(owned.propsSignal);
      return mounted.value.props.componentProps;
    },
    effect(callback) {
      assertNotComputing('register effects');
      if (!owned.initializing || owned.disposed) throw new Error('Register effects during component setup');
      if (typeof callback !== 'function') throw new TypeError('Effect expects a function');
      const path = [owned.nextEffectIndex++];
      for (let node = mounted; node; node = node.parent) path.unshift(node.key);
      const observer = { effect: true, site: JSON.stringify(path), owner: owned, alive: true, callback, cleanup: null, dependencies: new Set(), nextDependencies: new Set() };
      owned.effects.add(observer); effects.add(observer); pendingEffects.add(observer);
      return () => {
        if (!observer.alive) return;
        assertNotComputing('stop effects');
        if (active && !active.effect) throw new Error('Stop effects outside view bodies');
        disposeEffect(observer);
      };
    },
    task(callback) {
      if (!owned.initializing || owned.disposed) throw new Error('Register tasks during component setup');
      if (typeof callback !== 'function') throw new TypeError('Task expects a function');
      let current;
      const stopEffect = scope.effect(() => startTask(owned, callback, run => { current = run; }));
      return () => {
        // The effect stop enforces render purity before aborting any work.
        stopEffect(); cancelTask(current);
      };
    },
    state(initialValue) {
      assertNotComputing('allocate State');
      if (!owned.initializing || owned.disposed) throw new Error('Component state must be allocated during setup');
      return createState(initialValue, owned);
    },
    computed(callback) {
      assertNotComputing('allocate Computed values');
      if (!owned.initializing || owned.disposed) throw new Error('Allocate scoped Computed during component setup');
      return createComputed(callback, owned);
    },
    focus(initialName = null, options = {}) {
      assertNotComputing('allocate focus controllers');
      if (!owned.initializing || owned.disposed) throw new Error('Allocate focus controllers during component setup');
      if (initialName !== null) focusName(initialName);
      const settings = layoutOptions(options, ['window'], 'focus');
      const ownerWindow = settings.window === undefined ? undefined : focusWindowID(settings.window);
      const desired = scope.state(initialName), actual = scope.state(null), retired = scope.state(false), revision = scope.state(0), activation = scope.state(0);
      let context, token, ready = false, first = true, resuming = false, baseline = null, lease = focusLeaseClock, requestTask = null, resumeTask = null, unsubscribe = () => {};
      let conditionalClear = null, pendingIntent = initialName !== null;
      let retry = null, pendingRetry = null;
      function cancelRetry(waiter = retry) {
        if (!waiter?.active) return;
        waiter.active = false;
        if (retry === waiter) retry = null;
        if (pendingRetry === waiter) { pendingIntent = false; conditionalClear = null; requestTask = null; }
        const stop = waiter.stop; waiter.stop = () => {}; waiter.baseline = null; stop();
      }
      const taskLeases = new WeakMap();
      const availabilitySubscriptions = new Set();
      function stopAvailabilitySubscriptions() {
        const failures = [];
        for (const stop of [...availabilitySubscriptions]) { try { stop(); } catch (error) { failures.push(error); } }
        throwFailures(failures);
      }
      const allowed = task => !task || task.focusEpoch >= lease || taskLeases.get(task) === lease;
      function canWrite(action) {
        if (owned.disposed || !canMoveFocus(action)) return false;
        const task = taskStorage.getStore();
        return allowed(task);
      }
      function retire() {
        ready = false; requestTask = null; conditionalClear = null; pendingIntent = false; retired.value = true; actual.value = null;
        cancelRetry(); pendingRetry = null;
        try { stopAvailabilitySubscriptions(); } finally { unsubscribe(); }
      }
      function queueIntent(name, onlyClear = null, source = null) {
        if (source !== retry) cancelRetry();
        pendingRetry = source;
        requestTask = taskStorage.getStore(); conditionalClear = onlyClear; pendingIntent = true;
        desired.value = name; revision.value = untracked(() => revision.value) + 1;
      }
      scope.onDispose(() => { ready = false; requestTask = null; resumeTask = null; baseline = null; conditionalClear = null; pendingIntent = false; cancelRetry(); pendingRetry = null; try { stopAvailabilitySubscriptions(); } finally { unsubscribe(); } });
      scope.effect(() => {
        activation.value;
        const caller = resumeTask; resumeTask = null;
        if (caller && !taskIsCurrent(caller)) { resuming = false; baseline = null; requestTask = null; conditionalClear = null; pendingIntent = false; retired.value = true; cancelRetry(); pendingRetry = null; stopAvailabilitySubscriptions(); return; }
        unsubscribe = subscribeFocus(sample => {
          if (!ready) return;
          if (sample.token !== token || sample.context !== context || (sample.root ?? 0) !== owned.windowRoot || ownerWindow !== undefined && sample.window !== ownerWindow) { retire(); return; }
          if (retry?.baseline && (sample.name !== retry.baseline.name || sample.responderRevision !== retry.baseline.responderRevision)) cancelRetry();
          actual.value = sample.name;
        }, true);
        try {
          const sample = request('focus.snapshot', { token: focusWatch.token }).observation;
          if (!sample) throw new Error('Focus observation session expired');
          receiveFocusChange(sample);
          if ((sample.root ?? 0) !== owned.windowRoot || ownerWindow !== undefined && sample.window !== ownerWindow) { resuming = false; retire(); return; }
          token = sample.token; context = sample.context; ready = true; resuming = false; retired.value = false; actual.value = sample.name;
          if (retry && !retry.baseline) { retry.baseline = sample; if (sample.name === retry.name) cancelRetry(); }
        } catch (error) { unsubscribe(); throw error; }
        return () => { ready = false; unsubscribe(); };
      });
      scope.effect(() => {
        const name = desired.value, attempt = revision.value, ended = retired.value;
        if (!ready || ended) { if (!resuming) { requestTask = null; conditionalClear = null; pendingIntent = false; cancelRetry(); pendingRetry = null; } return; }
        if (baseline) {
          const prior = baseline; baseline = null;
          if (name === prior.name && attempt === prior.attempt) return;
        }
        if (first) { first = false; if (name === null && attempt === 0) return; }
        const caller = requestTask, onlyClear = conditionalClear, source = pendingRetry; requestTask = null; conditionalClear = null; pendingIntent = false; pendingRetry = null;
        if (source && (!source.active || retry !== source || name !== source.name)) { cancelRetry(source); return; }
        if (caller && (!allowed(caller) || !taskIsCurrent(caller))) { if (source) cancelRetry(source); return; }
        if (focusWatch?.token !== token) { retire(); return; }
        if (source) {
          const sample = contextSnapshot();
          if (!sample || !source.active || sample.name !== source.baseline?.name || sample.responderRevision !== source.baseline?.responderRevision) { cancelRetry(source); return; }
        }
        const op = onlyClear !== null ? 'focus.blurNamed' : name === null ? 'focus.move' : 'focus.named';
        const args = onlyClear !== null ? { name: onlyClear } : name === null ? { direction: 'clear' } : { name };
        let result;
        try { result = requestFocus(op, args, context, ownerWindow, owned.windowRoot); } finally { if (source) cancelRetry(source); }
        const sample = result.observation;
        if (!sample || result.focusAccepted === false || sample.context !== context || sample.token !== token || (sample.root ?? 0) !== owned.windowRoot || ownerWindow !== undefined && sample.window !== ownerWindow) { retire(); return; }
        actual.value = sample.name;
        if (retry && sample.name === retry.name) cancelRetry();
      });
      const selection = Object.freeze({
        get value() { return desired.value; },
        set value(name) {
          if (!canWrite('write desired focus')) return;
          if (name !== null) focusName(name);
          if (untracked(() => desired.value) === name) return;
          cancelRetry(); pendingRetry = null;
          requestTask = taskStorage.getStore();
          conditionalClear = null; pendingIntent = true;
          desired.value = name;
        },
        subscribe: listener => desired.subscribe(listener),
      });
      const observed = scope.computed(() => actual.value);
      function contextSnapshot() {
        const sample = request('focus.snapshot', { token }).observation;
        if (sample) receiveFocusChange(sample);
        if (!sample || sample.token !== token || sample.context !== context || (sample.root ?? 0) !== owned.windowRoot || ownerWindow !== undefined && sample.window !== ownerWindow) { retire(); return null; }
        return sample;
      }
      function subscribeOwnedAvailability(name, callback, onStop) {
        if (!canWrite('subscribe to scoped availability') || !resuming && untracked(() => retired.value)) { onStop?.(); return () => {}; }
        focusName(name);
        if (typeof callback !== 'function') throw new TypeError('Expected an availability listener');
        const subscriptionLease = lease; let stop, ended = false;
        stop = subscribeAvailability(name, value => {
          if (ended || subscriptionLease !== lease || !ready || !canWrite('deliver scoped availability')) { stop(); return; }
          if (!contextSnapshot()) return;
          return callback(value);
        }, () => { ended = true; availabilitySubscriptions.delete(stop); onStop?.(); });
        if (!ended) availabilitySubscriptions.add(stop);
        return stop;
      }
      const controller = Object.freeze({
        desired: selection, actual: observed, retired: scope.computed(() => retired.value),
        request(name) {
          if (!canWrite('request scoped focus') || !resuming && untracked(() => retired.value)) return;
          if (name !== null) focusName(name);
          queueIntent(name);
        },
        availability(name) {
          if (!canWrite('read scoped focus availability')) return null;
          return request('focus.availability', { name: focusName(name), root: owned.windowRoot }).availability;
        },
        subscribeAvailability(name, callback) {
          return subscribeOwnedAvailability(name, callback);
        },
        retryWhenReady() {
          if (!canWrite('arm focus retry') || !resuming && untracked(() => retired.value)) return () => {};
          cancelRetry();
          const name = untracked(() => desired.value);
          if (name === null) return () => {};
          const wasReady = ready, initial = wasReady ? contextSnapshot() : null;
          if (wasReady && !initial || initial?.name === name) return () => {};
          if (initial && !Number.isSafeInteger(initial.responderRevision)) throw new Error('Focus responder revision unavailable');
          const waiter = { name, active: true, queued: false, baseline: initial, stop: () => {} }; retry = waiter;
          try {
            waiter.stop = subscribeOwnedAvailability(name, value => {
              if (value !== 'ready' || !waiter.active || retry !== waiter) return;
              if (untracked(() => desired.value) !== name || Focus.availabilityNamed(name) !== 'ready') return;
              const sample = contextSnapshot();
              if (!sample || !waiter.active) return;
              waiter.baseline ??= sample;
              if (sample.name === name || sample.name !== waiter.baseline.name || sample.responderRevision !== waiter.baseline.responderRevision) { cancelRetry(waiter); return; }
              waiter.queued = true; queueIntent(name, null, waiter);
              const stop = waiter.stop; waiter.stop = () => {}; stop();
            }, () => { if (!waiter.queued) cancelRetry(waiter); });
          } catch (error) { cancelRetry(waiter); throw error; }
          return () => cancelRetry(waiter);
        },
        resume() {
          if (owned.disposed || !canMoveFocus('resume scoped focus')) return;
          cancelRetry(); pendingRetry = null;
          stopAvailabilitySubscriptions();
          lease = ++focusLeaseClock;
          const task = taskStorage.getStore(); if (task) taskLeases.set(task, lease);
          resumeTask = task;
          baseline = untracked(() => ({ name: desired.value, attempt: revision.value }));
          ready = false; first = false; resuming = true; requestTask = null; conditionalClear = null; pendingIntent = false; unsubscribe();
          actual.value = null; retired.value = true;
          activation.value = untracked(() => activation.value) + 1;
        },
        binding(name) {
          if (owned.disposed) throw new Error('Cannot project disposed focus controller');
          focusName(name);
          const projection = Object.freeze({
            get value() { return observed.value === name; },
            set value(focused) {
              if (!canWrite('write projected focus') || !resuming && untracked(() => retired.value)) return;
              if (typeof focused !== 'boolean') throw new TypeError('FocusBinding value must be boolean');
              if (focused) { queueIntent(name); return; }
              untracked(() => {
                if (pendingIntent && requestTask && (!allowed(requestTask) || !taskIsCurrent(requestTask))) { requestTask = null; conditionalClear = null; pendingIntent = false; }
                if (pendingIntent && desired.value !== name) return;
                if (desired.value === name || observed.value === name) queueIntent(null, name);
              });
            },
          });
          focusBindings.set(projection, { owner: owned, name, setDesired(focused) {
            if (!canWrite('write boolean desired focus')) return;
            if (typeof focused !== 'boolean') throw new TypeError('Desired focus must be boolean');
            untracked(() => {
              if (focused ? desired.value === name : desired.value !== name) return;
              cancelRetry(); pendingRetry = null;
              requestTask = taskStorage.getStore(); conditionalClear = focused ? null : name; pendingIntent = true;
              desired.value = focused ? name : null;
            });
          } });
          return projection;
        },
      });
      focusControllers.set(controller, { canWrite, canRequest: () => resuming || !untracked(() => retired.value) });
      return controller;
    },
    focusSelection(values, initialValue = null, options = {}) {
      assertNotComputing('allocate selection focus controllers');
      if (!owned.initializing || owned.disposed) throw new Error('Allocate selection focus controllers during component setup');
      if (!Array.isArray(values)) throw new TypeError('Focus selections require an array of string or finite number IDs');
      const names = new Map(), selections = new Map();
      for (const value of values) {
        if (typeof value === 'string' ? !value.isWellFormed() : typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Focus selection IDs must be well-formed strings or finite numbers');
        if (names.has(value)) throw new TypeError('Duplicate focus selection ID');
        const name = `jonui:selection:${randomUUID()}`;
        names.set(value, name); selections.set(name, value === 0 ? 0 : value);
      }
      function nameFor(value) {
        if (value === null) return null;
        if (!names.has(value)) throw new TypeError('Unknown focus selection ID');
        return names.get(value);
      }
      const controller = scope.focus(nameFor(initialValue), options), guards = focusControllers.get(controller);
      const selected = name => selections.has(name) ? selections.get(name) : null;
      const desired = Object.freeze({
        get value() { return selected(controller.desired.value); },
        set value(value) {
          if (!guards.canWrite('write desired focus selection')) return;
          controller.desired.value = nameFor(value);
        },
        subscribe(listener) {
          if (typeof listener !== 'function') throw new TypeError('Expected a listener');
          return controller.desired.subscribe(name => listener(selected(name)));
        },
      });
      return Object.freeze({
        desired, actual: Object.freeze({ get value() { return selected(controller.actual.value); } }), retired: controller.retired,
        request(value) {
          if (!guards.canWrite('request focus selection') || !guards.canRequest()) return;
          controller.request(nameFor(value));
        },
        availability(value) {
          if (!guards.canWrite('read focus selection availability')) return null;
          if (value === null) throw new TypeError('A focus selection availability query requires a non-null ID');
          return controller.availability(nameFor(value));
        },
        subscribeAvailability(value, callback) {
          if (!guards.canWrite('subscribe to focus selection availability') || !guards.canRequest()) return () => {};
          if (value === null) throw new TypeError('A focus selection availability subscription requires a non-null ID');
          return controller.subscribeAvailability(nameFor(value), callback);
        },
        resume: controller.resume,
        retryWhenReady: controller.retryWhenReady,
        binding(value) {
          if (value === null) throw new TypeError('A focus selection binding requires a non-null ID');
          return controller.binding(nameFor(value));
        },
      });
    },
    focusBoolean(initialFocused = false, options = {}) {
      assertNotComputing('allocate boolean focus controllers');
      if (!owned.initializing || owned.disposed) throw new Error('Allocate boolean focus controllers during component setup');
      if (typeof initialFocused !== 'boolean') throw new TypeError('Initial focus must be boolean');
      const name = `jonui:boolean:${randomUUID()}`, controller = scope.focus(initialFocused ? name : null, options), projected = controller.binding(name);
      const setDesired = focusBindings.get(projected).setDesired;
      const desired = Object.freeze({
        get value() { return controller.desired.value === name; },
        set value(value) { setDesired(value); },
        subscribe(listener) {
          if (typeof listener !== 'function') throw new TypeError('Expected a listener');
          return controller.desired.subscribe(value => listener(value === name));
        },
      });
      return Object.freeze({
        desired, actual: Object.freeze({ get value() { return projected.value; } }), retired: controller.retired,
        binding: projected, request(value) { projected.value = value; }, availability: () => controller.availability(name), resume: controller.resume,
        subscribeAvailability: callback => controller.subscribeAvailability(name, callback),
        retryWhenReady: controller.retryWhenReady,
      });
    },
    onDispose(cleanup) {
      assertNotComputing('register component cleanup');
      if (!owned.initializing || owned.disposed) throw new Error('Register component cleanup during setup');
      if (typeof cleanup !== 'function') throw new TypeError('Expected a cleanup function');
      owned.cleanups.push(cleanup);
    },
  });
  try {
    owned.render = mounted.value.props.setup(scope, mounted.value.props.componentProps);
    if (typeof owned.render !== 'function') throw new TypeError('Component setup must return a synchronous view body');
  } catch (error) {
    try { disposeComponent(owned); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], String(error));
    }
    throw error;
  } finally { owned.initializing = false; }
}
function throwFailures(failures) {
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Component cleanup failed');
}
function disposeComponent(owned) {
  if (!owned || owned.disposed) return;
  owned.disposed = true;
  liveDependencies.delete(owned.propsSignal); invalidate(owned.propsSignal); owned.propsSignal.dependents.clear();
  for (const id of owned.cells) cells.get(id)?.dispose();
  owned.cells.clear();
  const failures = [];
  for (const observer of [...owned.effects].reverse()) {
    try { disposeEffect(observer); } catch (error) { failures.push(error); }
  }
  for (const cleanup of owned.cleanups.reverse()) {
    try { untracked(cleanup); } catch (error) { failures.push(error); }
  }
  for (const observer of [...owned.computations]) disposeComputed(observer);
  owned.cleanups = []; owned.render = null;
  throwFailures(failures);
}
function disposeEffect(observer) {
  if (!observer.alive) return;
  observer.alive = false;
  pendingEffects.delete(observer); effects.delete(observer); observer.owner.effects.delete(observer);
  for (const dependency of [...observer.dependencies, ...observer.nextDependencies]) dependency.dependents.delete(observer);
  observer.dependencies.clear(); observer.nextDependencies.clear();
  const cleanup = observer.cleanup;
  observer.cleanup = null; observer.callback = null;
  if (cleanup) synchronousCleanup(cleanup);
}
function runEffect(observer) {
  pendingEffects.delete(observer);
  if (!observer.alive || observer.owner.disposed) return;
  for (const dependency of observer.dependencies) dependency.dependents.delete(observer);
  observer.dependencies.clear();
  const cleanup = observer.cleanup; observer.cleanup = null;
  if (cleanup) synchronousCleanup(cleanup);
  if (!observer.alive || observer.owner.disposed) return;
  const result = track(observer, observer.callback);
  if (result !== undefined && typeof result !== 'function') {
    if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    throw new TypeError('Effect must synchronously return a cleanup function or undefined');
  }
  if (typeof result === 'function') {
    if (observer.alive && !observer.owner.disposed) observer.cleanup = result;
    else synchronousCleanup(result);
  }
}
function equalProps(previous, next) {
  if (Object.is(previous, next)) return true;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false;
  const prototype = Object.getPrototypeOf(previous);
  if (prototype !== Object.getPrototypeOf(next) || ![Object.prototype, Array.prototype, null].includes(prototype)) return false;
  const keys = Reflect.ownKeys(previous), nextKeys = Reflect.ownKeys(next);
  return keys.length === nextKeys.length && keys.every(key => Object.hasOwn(next, key) && Object.is(previous[key], next[key]));
}
function unmountAll(children) {
  const failures = [];
  for (const child of children) {
    try { unmount(child); } catch (error) { failures.push(error); }
  }
  throwFailures(failures);
}
export const Text = value => new ViewValue('text', { value });
export const Image = options => new ViewValue('image', options);
export const Spacer = (options = {}) => {
  const props = layoutOptions(options, ['minLength'], 'Spacer');
  if ('minLength' in props) layoutNumber(props.minLength, 'Spacer minLength', true);
  return new ViewValue('spacer', props);
};
export const Divider = () => new ViewValue('divider');
export const VStack = (children, options = {}) => new ViewValue('vstack', stackOptions(options, true), [...children]);
export const HStack = (children, options = {}) => new ViewValue('hstack', stackOptions(options, false), [...children]);
export const LazyVStack = (children, options = {}) => new ViewValue('lazyvstack', stackOptions(options, true), [...children]);
export const LazyHStack = (children, options = {}) => new ViewValue('lazyhstack', stackOptions(options, false), [...children]);
function gridOptions(options, vertical) {
  const axis = vertical ? 'columns' : 'rows';
  const props = layoutOptions(options, [axis, 'alignment', 'spacing'], vertical ? 'LazyVGrid' : 'LazyHGrid');
  if ('alignment' in props) layoutEnum(props.alignment, vertical ? horizontalAlignments : verticalAlignments, 'grid alignment');
  if ('spacing' in props) layoutNumber(props.spacing, 'grid spacing', true);
  if (!Array.isArray(props[axis]) || !props[axis].length) throw new TypeError(`Grid ${axis} must be a nonempty array`);
  const tracks = Object.freeze(Array.from(props[axis], item => {
    const track = layoutOptions(item, ['size', 'value', 'min', 'max', 'spacing', 'alignment'], 'GridItem');
    layoutEnum(track.size, ['fixed', 'flexible', 'adaptive'], 'grid item size');
    if ('alignment' in track) layoutEnum(track.alignment, frameAlignments, 'grid item alignment');
    if ('spacing' in track) layoutNumber(track.spacing, 'grid item spacing', true);
    if (track.size === 'fixed') {
      if ('min' in track || 'max' in track) throw new TypeError('Fixed GridItem uses value, not min/max');
      layoutNumber(track.value, 'fixed grid item value', true);
    } else {
      if ('value' in track) throw new TypeError('Flexible/adaptive GridItem uses min/max, not value');
      if (!('min' in track) && track.size === 'flexible') track.min = 10;
      layoutNumber(track.min, 'grid item min', true);
      if (track.size === 'adaptive' && track.min === 0) throw new TypeError('Adaptive GridItem min must be positive');
      if (!('max' in track)) track.max = 'infinity';
      if (track.max !== 'infinity') layoutNumber(track.max, 'grid item max', true);
      if (track.max !== 'infinity' && track.max < track.min) throw new TypeError('GridItem bounds must satisfy min <= max');
    }
    return Object.freeze(track);
  }));
  delete props[axis]; props.tracks = tracks;
  return props;
}
export const LazyVGrid = (children, options) => new ViewValue('lazyvgrid', gridOptions(options, true), [...children]);
export const LazyHGrid = (children, options) => new ViewValue('lazyhgrid', gridOptions(options, false), [...children]);
export const ScrollView = (content, options = {}) => {
  const props = { axes: 'vertical', showsIndicators: true, ...layoutOptions(options, ['axes', 'showsIndicators'], 'ScrollView') };
  layoutEnum(props.axes, ['vertical', 'horizontal', 'both'], 'scroll axes');
  if (typeof props.showsIndicators !== 'boolean') throw new TypeError('ScrollView showsIndicators must be boolean');
  return new ViewValue('scroll', props, [content]);
};
export const Form = (children, options = {}) => {
  const props = { style: 'automatic', ...layoutOptions(options, ['style'], 'Form') };
  layoutEnum(props.style, ['automatic', 'grouped', 'columns'], 'form style');
  return new ViewValue('form', props, [...children]);
};
export const Section = (title, children, options = {}) => {
  if (typeof title !== 'string') throw new TypeError('Section title must be a string');
  const props = { title, ...layoutOptions(options, ['footer'], 'Section') };
  if ('footer' in props && typeof props.footer !== 'string') throw new TypeError('Section footer must be a string');
  return new ViewValue('section', props, [...children]);
};
function numericInput(kind, title, options) {
  if (typeof title !== 'string') throw new TypeError('Numeric input title must be a string');
  const props = { min: 0, max: kind === 'slider' ? 1 : 100, ...(kind === 'stepper' ? { step: 1 } : {}), ...layoutOptions(options, ['value', 'min', 'max', 'step', 'focusName'], kind) };
  if (props.focusName !== undefined) focusName(props.focusName);
  for (const key of ['min', 'max']) layoutNumber(props[key], `${kind} ${key}`);
  const span = props.max - props.min;
  if (!(span > 0) || !Number.isFinite(span)) throw new TypeError('Numeric input range must have a positive finite span');
  if ('step' in props) {
    layoutNumber(props.step, `${kind} step`);
    if (!(props.step > 0) || props.step > span || !Number.isFinite(span / props.step)) throw new TypeError('Numeric input step must be positive, fit the range, and produce a finite step count');
  }
  const state = binding(props.value); delete props.value;
  return new ViewValue(kind, { title, ...props, state });
}
export const Slider = (title, options) => numericInput('slider', title, options);
export const Stepper = (title, options) => numericInput('stepper', title, options);
export function DatePicker(title, options) {
  if (typeof title !== 'string') throw new TypeError('DatePicker title must be a string');
  const props = { components: 'dateAndTime', style: 'automatic', ...layoutOptions(options, ['selection', 'min', 'max', 'components', 'style', 'timeZone', 'focusName'], 'DatePicker') };
  if (props.focusName !== undefined) focusName(props.focusName);
  layoutEnum(props.components, ['date', 'time', 'dateAndTime'], 'date components');
  layoutEnum(props.style, ['automatic', 'compact', 'graphical'], 'date picker style');
  for (const key of ['min', 'max']) if (key in props) dateTimestamp(props[key], `DatePicker ${key}`);
  if ((props.min ?? earliestDate) > (props.max ?? latestDate)) throw new TypeError('DatePicker bounds must satisfy min <= max');
  if ('timeZone' in props) {
    if (typeof props.timeZone !== 'string' || !props.timeZone || /^[+-]/.test(props.timeZone)) throw new TypeError('DatePicker timeZone must be a named time zone');
    try { props.timeZone = new Intl.DateTimeFormat('en-US', { timeZone: props.timeZone }).resolvedOptions().timeZone; }
    catch { throw new TypeError('DatePicker timeZone must be a supported named time zone'); }
  }
  const state = binding(props.selection); delete props.selection;
  return new ViewValue('datepicker', { title, ...props, state });
}
export function Picker(title, options) {
  if (typeof title !== 'string') throw new TypeError('Picker title must be a string');
  const props = { style: 'automatic', placeholder: 'Select…', ...layoutOptions(options, ['selection', 'options', 'style', 'placeholder', 'focusName'], 'Picker') };
  if (props.focusName !== undefined) focusName(props.focusName);
  layoutEnum(props.style, ['automatic', 'menu', 'segmented'], 'picker style');
  if (typeof props.placeholder !== 'string') throw new TypeError('Picker placeholder must be a string');
  if (!Array.isArray(props.options)) throw new TypeError('Picker options must be an array');
  const seen = new Set();
  const items = Array.from(props.options, item => {
    const option = layoutOptions(item, ['value', 'label'], 'Picker option');
    if (option.value !== null && !['string', 'number'].includes(typeof option.value) || typeof option.value === 'number' && !Number.isFinite(option.value)) throw new TypeError('Picker option values must be strings, finite numbers or null');
    if (typeof option.label !== 'string') throw new TypeError('Picker option label must be a string');
    const key = JSON.stringify([typeof option.value, option.value]);
    if (seen.has(key)) throw new TypeError(`Duplicate Picker option: ${String(option.value)}`);
    seen.add(key);
    return Object.freeze({ value: option.value, label: option.label });
  });
  const state = binding(props.selection);
  return new ViewValue('picker', { title, state, style: props.style, placeholder: props.placeholder, options: Object.freeze(items), ...(props.focusName === undefined ? {} : { focusName: props.focusName }) });
}
export const Button = (title, action, options = {}) => {
  const props = layoutOptions(options, ['focusName'], 'Button');
  if (props.focusName !== undefined) focusName(props.focusName);
  return new ViewValue('button', { title, action, ...props });
};
const focusTargets = new WeakMap();
const focusWindows = new WeakMap();
function focusWindowID(value) {
  const id = focusWindows.get(value);
  if (id === undefined) throw new TypeError('Expected a captured FocusWindow');
  return id;
}
const focusListeners = new Set();
const availabilityWatches = new Map(), availabilityTokens = new Map();
const availabilityValues = new Set(['missing', 'unrealized', 'inactiveWindow', 'unavailable', 'ready']);
let nextAvailabilityWatch = 1;
function scheduleAvailabilityDelivery(watch) {
  if (watch.scheduled) return;
  watch.scheduled = true;
  queueMicrotask(() => {
    watch.scheduled = false;
    if (stopped || availabilityWatches.get(watch.name) !== watch) return;
    const sequence = watch.sequence, value = watch.availability;
    try {
      taskStorage.run(undefined, () => untracked(() => {
        for (const entry of [...watch.entries]) {
          if (availabilityWatches.get(watch.name) !== watch || watch.sequence !== sequence || !watch.entries.has(entry) || entry.last === value) continue;
          if (entry.task && !taskIsCurrent(entry.task)) continue;
          entry.last = value;
          const result = entry.task ? taskStorage.run(entry.task, () => entry.callback(value)) : entry.callback(value);
          if (result && typeof result.then === 'function') {
            Promise.resolve(result).catch(() => {});
            throw new TypeError('Availability listeners must be synchronous; use scope.task for asynchronous work');
          }
        }
      }));
    } catch (error) { fail(error); }
  });
}
function receiveAvailabilityChange(event) {
  const watch = availabilityTokens.get(event.token);
  if (!watch || !Number.isSafeInteger(event.sequence) || event.sequence <= watch.sequence || !availabilityValues.has(event.availability)) return;
  watch.sequence = event.sequence; watch.availability = event.availability; scheduleAvailabilityDelivery(watch);
}
function subscribeAvailability(name, callback, onStop) {
  if (!canMoveFocus('subscribe to native availability')) { onStop?.(); return () => {}; }
  focusName(name);
  if (typeof callback !== 'function') throw new TypeError('Expected an availability listener');
  let watch = availabilityWatches.get(name);
  if (!watch) {
    watch = { name, token: nextAvailabilityWatch++, entries: new Set() };
    let snapshot;
    try {
      snapshot = request('focus.availability.watch', { token: watch.token, name });
      if (!availabilityValues.has(snapshot.availability) || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) throw new Error('Invalid availability observation');
      watch.sequence = snapshot.sequence; watch.availability = snapshot.availability;
    } catch (error) {
      if (snapshot) request('focus.availability.unwatch', { token: watch.token });
      throw error;
    }
    availabilityWatches.set(name, watch); availabilityTokens.set(watch.token, watch);
  }
  const entry = { callback, task: taskStorage.getStore(), unregister: () => {} };
  const unsubscribe = () => {
    if (!watch.entries.delete(entry)) return;
    entry.unregister(); entry.unregister = () => {}; entry.callback = null; entry.task = null;
    onStop?.();
    if (!watch.entries.size && availabilityWatches.get(name) === watch) {
      availabilityWatches.delete(name); availabilityTokens.delete(watch.token);
      request('focus.availability.unwatch', { token: watch.token });
    }
  };
  watch.entries.add(entry);
  try {
    if (entry.task) entry.unregister = registerTaskCleanup(entry.task, unsubscribe);
    scheduleAvailabilityDelivery(watch);
  } catch (error) { unsubscribe(); throw error; }
  return unsubscribe;
}
let focusWatch = null, nextFocusWatch = 1;
function stopFocusListener(entry) {
  if (!focusListeners.delete(entry)) return;
  entry.unregister();
  if (!focusListeners.size && focusWatch) {
    const token = focusWatch.token; focusWatch = null;
    request('focus.unwatch', { token });
  }
}
function receiveFocusChange(event) {
  const watch = focusWatch;
  if (!watch || event.token !== watch.token || !Number.isSafeInteger(event.sequence) || event.sequence <= watch.sequence ||
      !Number.isSafeInteger(event.context) || event.context < watch.context ||
      !Number.isSafeInteger(event.generation) || event.generation < watch.generation ||
      event.window !== undefined && (!Number.isSafeInteger(event.window) || event.window < 1) ||
      event.root !== undefined && (!Number.isSafeInteger(event.root) || event.root < 0) ||
      event.responderRevision !== undefined && (!Number.isSafeInteger(event.responderRevision) || event.responderRevision < (watch.responderRevision ?? 0)) ||
      event.name !== null && (typeof event.name !== 'string' || !event.name.length || !event.name.isWellFormed())) return;
  watch.sequence = event.sequence; watch.context = event.context; watch.name = event.name;
  watch.generation = event.generation; watch.requestGeneration = Math.max(watch.requestGeneration, event.generation);
  watch.responderRevision = event.responderRevision ?? watch.responderRevision;
  watch.window = event.window ?? watch.window;
  watch.root = event.root ?? watch.root ?? 0;
  if (watch.deliveryScheduled) return;
  watch.deliveryScheduled = true;
  queueMicrotask(() => {
    watch.deliveryScheduled = false;
    if (stopped || focusWatch !== watch) return;
    const sequence = watch.sequence, name = watch.name;
    try {
      taskStorage.run(undefined, () => untracked(() => {
        for (const entry of [...focusListeners]) {
          if (focusWatch !== watch || watch.sequence !== sequence || !focusListeners.has(entry) || entry.name === name && (!entry.metadata || entry.context === watch.context && entry.root === watch.root && entry.window === watch.window && entry.responderRevision === watch.responderRevision)) continue;
          entry.name = name; entry.context = watch.context; entry.root = watch.root; entry.window = watch.window; entry.responderRevision = watch.responderRevision;
          const value = entry.metadata ? { token: watch.token, context: watch.context, root: watch.root, window: watch.window, responderRevision: watch.responderRevision, name } : name;
          if (!entry.task) entry.callback(value);
          else if (taskIsCurrent(entry.task)) taskStorage.run(entry.task, () => entry.callback(value));
        }
      }));
    } catch (error) { fail(error); }
  });
}
function requestFocus(op, args = {}, context, ownerWindow, ownerRoot) {
  const watch = focusWatch;
  if (!watch) return request(op, args);
  const result = request(op, { ...args, focusRequest: { token: watch.token, generation: ++watch.requestGeneration, ...(context === undefined ? {} : { context }), ...(ownerWindow === undefined ? {} : { window: ownerWindow }), ...(ownerRoot === undefined ? {} : { root: ownerRoot }) } });
  if (focusWatch === watch && result.observation) receiveFocusChange(result.observation);
  return result;
}
function subscribeFocus(callback, metadata = false) {
  if (!canMoveFocus('subscribe to native focus')) return () => {};
  if (typeof callback !== 'function') throw new TypeError('Expected a focus listener');
  const entry = { callback, metadata, task: taskStorage.getStore(), unregister: () => {} };
  const unsubscribe = () => stopFocusListener(entry);
  focusListeners.add(entry);
  if (!focusWatch) {
    const watch = { token: nextFocusWatch++, requestGeneration: 0 }; focusWatch = watch;
    try { Object.assign(watch, request('focus.watch', { token: watch.token })); }
    catch (error) { focusListeners.delete(entry); focusWatch = null; throw error; }
  }
  entry.name = focusWatch.name; entry.context = focusWatch.context; entry.root = focusWatch.root ?? 0; entry.window = focusWatch.window; entry.responderRevision = focusWatch.responderRevision;
  if (entry.task) entry.unregister = registerTaskCleanup(entry.task, unsubscribe);
  return unsubscribe;
}
function focusName(value) {
  if (typeof value !== 'string' || !value.length || !value.isWellFormed()) throw new TypeError('Focus names must be nonempty well-formed strings');
  return value;
}
function canMoveFocus(action = 'move focus') {
  assertNotComputing(action);
  const task = taskStorage.getStore();
  if (stopped || task && !taskIsCurrent(task)) return false;
  if (active && !active.effect) throw new Error(`${action[0].toUpperCase()}${action.slice(1)} outside view bodies`);
  return true;
}
function moveFocus(direction) {
  if (!canMoveFocus()) return;
  requestFocus('focus.move', { direction });
}
export const Focus = Object.freeze({
  next: () => moveFocus('next'), previous: () => moveFocus('previous'), clear: () => moveFocus('clear'),
  move(direction) {
    if (!canMoveFocus()) return false;
    layoutEnum(direction, ['left', 'right', 'up', 'down'], 'focus direction');
    return requestFocus('focus.direction', { direction }).moved;
  },
  capture() {
    if (!canMoveFocus()) return null;
    const { target } = request('focus.capture');
    if (target === null) return null;
    const value = Object.freeze({}); focusTargets.set(value, target); return value;
  },
  captureWindow() {
    if (!canMoveFocus('capture focus windows')) return null;
    const { window } = request('focus.window.capture');
    if (!Number.isSafeInteger(window) || window < 1) throw new Error('Invalid focus window handle');
    const value = Object.freeze({}); focusWindows.set(value, window); return value;
  },
  request(target) {
    if (!canMoveFocus()) return false;
    const id = focusTargets.get(target);
    if (id === undefined) throw new TypeError('Focus.request expects a captured FocusTarget');
    return requestFocus('focus.target', { target: id }).focused;
  },
  requestNamed(name) {
    if (!canMoveFocus()) return false;
    return requestFocus('focus.named', { name: focusName(name) }).focused;
  },
  availabilityNamed(name) {
    if (!canMoveFocus('read native focus availability')) return null;
    return request('focus.availability', { name: focusName(name) }).availability;
  },
  subscribeAvailability(name, callback) { return subscribeAvailability(name, callback); },
  currentName() {
    if (!canMoveFocus('read native focus')) return null;
    return request('focus.currentName').name;
  },
  subscribe(callback) {
    return subscribeFocus(callback);
  },
  setTraversal(targets, options = {}) {
    if (!canMoveFocus()) return false;
    if (!Array.isArray(targets)) throw new TypeError('Focus.setTraversal expects an array of captured FocusTargets');
    const props = layoutOptions(options, ['tabNavigation'], 'focus traversal');
    if ('tabNavigation' in props && typeof props.tabNavigation !== 'boolean') throw new TypeError('Focus tabNavigation must be boolean');
    const ids = Array.from(targets, target => {
      const id = focusTargets.get(target);
      if (id === undefined) throw new TypeError('Focus.setTraversal expects captured FocusTargets');
      return id;
    });
    if (new Set(ids).size !== ids.length) throw new TypeError('Focus traversal targets must be distinct');
    return request('focus.traversal', { targets: ids, ...props }).configured;
  },
});
export const Toggle = (title, options) => {
  const props = layoutOptions(options, ['isOn', 'focusName'], 'Toggle');
  if (props.focusName !== undefined) focusName(props.focusName);
  return new ViewValue('toggle', { title, state: binding(props.isOn), ...(props.focusName === undefined ? {} : { focusName: props.focusName }) });
};
function textInput(kind, title, options) {
  if (typeof title !== 'string') throw new TypeError('Text input title must be a string');
  const props = layoutOptions(options, ['text', 'onSubmit', 'onEditingChanged', 'focusName'], kind);
  if (props.focusName !== undefined) focusName(props.focusName);
  if (props.onSubmit !== undefined && typeof props.onSubmit !== 'function') throw new TypeError('Text input onSubmit must be a function');
  if (props.onEditingChanged !== undefined && typeof props.onEditingChanged !== 'function') throw new TypeError('Text input onEditingChanged must be a function');
  return new ViewValue(kind, { title, state: binding(props.text), onSubmit: props.onSubmit, onEditingChanged: props.onEditingChanged, ...(props.focusName === undefined ? {} : { focusName: props.focusName }) });
}
export const TextField = (title, options) => textInput('textfield', title, options);
export const SecureField = (title, options) => textInput('securefield', title, options);
export const TextEditor = options => {
  const props = layoutOptions(options, ['text', 'monospaced', 'onEditingChanged', 'focusName'], 'TextEditor');
  if (props.focusName !== undefined) focusName(props.focusName);
  if (props.monospaced !== undefined && typeof props.monospaced !== 'boolean') throw new TypeError('TextEditor monospaced must be boolean');
  if (props.onEditingChanged !== undefined && typeof props.onEditingChanged !== 'function') throw new TypeError('Text input onEditingChanged must be a function');
  return new ViewValue('texteditor', { state: binding(props.text), monospaced: props.monospaced ?? false, onEditingChanged: props.onEditingChanged, ...(props.focusName === undefined ? {} : { focusName: props.focusName }) });
};
function jsonSnapshot(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('WebView data must be finite, acyclic JSON');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('WebView data must contain plain JSON objects');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? Array.from(value, child => jsonSnapshot(child, ancestors))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSnapshot(child, ancestors)]));
  } finally { ancestors.delete(value); }
}
function disposeWebAPI(id) {
  const entry = webAPIs.get(id); if (!entry) return;
  webAPIs.delete(id); entry.owner.disposed = true;
  const runs = [...entry.runs.values()]; entry.runs.clear();
  const errors = []; for (const run of runs) { try { cancelTask(run); } catch (error) { errors.push(error); } }
  throwFailures(errors);
}
export const WebRequest = Object.freeze({
  get current() {
    const run = taskStorage.getStore();
    if (!run?.web) throw new Error('WebRequest.current is only available inside a WebView API call');
    return run.context;
  },
});
function webError(error) {
  try { return { name: error instanceof Error ? String(error.name) : 'Error', message: error instanceof Error ? String(error.message) : String(error) }; }
  catch { return { name: 'Error', message: 'WebView API failed' }; }
}
function handleWebRequest(event) {
  const entry = webAPIs.get(event.id);
  if (!entry || entry.epoch !== event.epoch) return;
  const { id, epoch, call, document, method, args } = event;
  const route = { id, epoch, call, document }, key = JSON.stringify([document, call]);
  if (!request('web.claim', route).accepted) return;
  const reply = result => request('web.reply', { ...route, result });
  if (!Object.hasOwn(entry.api, method)) { reply({ ok: false, error: { name: 'TypeError', message: 'Unknown WebView API method' } }); return; }
  const run = { web: true, focusEpoch: focusLeaseClock, route, key, owner: entry.owner, cancelled: false, controller: new AbortController(), cleanups: new Set() };
  run.context = createTaskContext(run); entry.runs.set(key, run);
  let result;
  try { result = taskStorage.run(run, () => entry.api[method](...jsonSnapshot(args))); }
  catch (error) { result = Promise.reject(error); }
  // Promise continuations keep only this run and its routing identity alive.
  Promise.resolve(result).then(value => finishWebRequest(run, value), error => finishWebRequest(run, undefined, error, true));
}
function finishWebRequest(run, value, error, failed = false) {
  if (!taskIsCurrent(run)) return;
  let result;
  try { result = failed ? { ok: false, error: webError(error) } : { ok: true, ...(value === undefined ? {} : { value: taskStorage.run(run, () => jsonSnapshot(value)) }) }; }
  catch (error) { result = { ok: false, error: webError(error) }; }
  if (!taskIsCurrent(run)) return;
  webAPIs.get(run.route.id)?.runs.delete(run.key);
  try { cancelTask(run); } catch (error) { result = { ok: false, error: webError(error) }; }
  request('web.reply', { ...run.route, result });
}
/** Data updates preserve the mounted browser; only HTML changes reload it. */
export function WebView({ html, data = null, onMessage, onError, focusName: name, api = {}, tabFocusable = true }) {
  if (typeof html !== 'string') throw new TypeError('WebView requires an HTML string');
  for (const fn of [onMessage, onError]) if (fn !== undefined && typeof fn !== 'function') throw new TypeError('WebView callbacks must be functions');
  if (name !== undefined) focusName(name);
  if (typeof tabFocusable !== 'boolean') throw new TypeError('WebView tabFocusable must be a boolean');
  if (!api || typeof api !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(api)) || Object.getOwnPropertySymbols(api).length) throw new TypeError('WebView api must be a plain string-keyed method table');
  const methods = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(api))) {
    if (!descriptor.enumerable) continue;
    if (!key || !key.isWellFormed() || ['then', '__proto__', 'prototype', 'constructor', 'toJSON'].includes(key) || typeof descriptor.value !== 'function') throw new TypeError('WebView api requires named functions without accessors or reserved names');
    methods[key] = descriptor.value;
  }
  return new ViewValue('webview', { html, api: Object.freeze(methods), tabFocusable, data: jsonSnapshot(data), onMessage, onError, ...(name === undefined ? {} : { focusName: name }) });
}
export const NavigationSplitView = ({ sidebar, detail }) => new ViewValue('split', {}, [sidebar, detail]);
export const List = ({ selection }, content) => new ViewValue('list', { state: binding(selection) }, [content]);
function itemKey(id) {
  if (!['string', 'number'].includes(typeof id) || (typeof id === 'number' && !Number.isFinite(id))) throw new TypeError('ForEach IDs must be strings or finite numbers');
  return JSON.stringify([typeof id, id]);
}
export function ForEach(items, { id }, row) {
  const keys = new Set();
  const rows = items.map(item => {
    const key = itemKey(id(item));
    if (keys.has(key)) throw new Error(`Duplicate ForEach ID: ${key}`);
    keys.add(key); return { key, value: row(item) };
  });
  return new ViewValue('foreach', { rows });
}
function validate(value) {
  if (!value?.[viewMarker] || !supportedKinds.has(value.kind)) throw new TypeError('View body must synchronously return a JonUI View');
  if (value.props.focusBinding) focusProjection(value.props.focusBinding);
}
function unmount(mounted) {
  if (!mounted.alive) return;
  mounted.alive = false;
  const failures = [];
  dirty.delete(mounted); updates.delete(mounted.id); actions.delete(mounted.id); webErrors.delete(mounted.id);
  windowViews.delete(mounted.id);
  try { disposeWebAPI(mounted.id); } catch (error) { failures.push(error); }
  textSubmits.delete(mounted.submitToken);
  textEditings.delete(mounted.editingToken);
  appearances.delete(mounted.appearanceToken);
  taps.delete(mounted.tapToken);
  for (const cell of mounted.dependencies) cell.dependents.delete(mounted);
  try { unmountAll(mounted.children); } catch (error) { failures.push(error); }
  try { disposeComponent(mounted.component); } catch (error) { failures.push(error); }
  mounted.children = []; mounted.dependencies.clear();
  throwFailures(failures);
}
function reconcile(previous, value, key, parent = null) {
  validate(value);
  if (value.props.focusBinding) {
    const owner = focusProjection(value.props.focusBinding).owner;
    if (windowRoot({ parent, key }) !== owner.windowRoot) throw new Error('Focused views must share their controller window root');
    let ancestor = parent;
    while (ancestor && ancestor.component !== owner) ancestor = ancestor.parent;
    if (!ancestor) throw new Error('Focused views must be descendants of their controller component');
  }
  if (previous && (previous.value.kind !== value.kind ||
      (previous.value.kind === 'modifier' && (previous.value.props.name === 'window') !== (value.props.name === 'window')) ||
      (value.kind === 'component' && previous.value.props.definition !== value.props.definition))) { unmount(previous); previous = null; }
  const mounted = previous ?? { id: nextView++, key, children: [], dependencies: new Set(), alive: true };
  const propsChanged = mounted.component && !equalProps(mounted.value.props.componentProps, value.props.componentProps);
  mounted.value = value; mounted.parent = parent;
  if (propsChanged) invalidate(mounted.component.propsSignal);
  for (const scope of recoveryScopes) scope.add(mounted);
  evaluate(mounted);
  return mounted;
}
function track(mounted, callback, keepDependencies = false) {
  const parent = active;
  mounted.nextDependencies = new Set(keepDependencies ? mounted.dependencies : []);
  active = mounted;
  try { return callback(); } finally {
    active = parent;
    for (const cell of mounted.dependencies) cell.dependents.delete(mounted);
    if (mounted.alive) {
      mounted.dependencies = mounted.nextDependencies;
      for (const cell of mounted.dependencies) cell.dependents.add(mounted);
    } else {
      for (const cell of mounted.nextDependencies) cell.dependents.delete(mounted);
      mounted.dependencies = new Set();
    }
  }
}
function evaluate(mounted) {
  if (!mounted.alive) return;
  dirty.delete(mounted);
  const fallback = mounted.value.kind === 'dynamic' && mounted.value.props.fallback;
  if (!fallback) return evaluateContent(mounted);
  // Track partial mounts too: a failed descendant may throw before its parent's
  // new children array is assigned. None of those registrations may survive.
  const scope = new Set();
  recoveryScopes.push(scope);
  try { evaluateContent(mounted); } catch (error) {
    const failedDependencies = new Set();
    const collect = child => {
      for (const cell of child.dependencies) failedDependencies.add(cell);
      for (const nested of child.children) collect(nested);
    };
    for (const child of mounted.children) collect(child);
    for (const child of scope) collect(child);
    unmountAll([...mounted.children, ...scope]);
    // Retry on surviving inputs, never on locals whose owner just failed. A
    // failed local starts fresh on every retry, so subscribing to its disposal
    // would otherwise create an endless initialize/fail/dispose loop.
    const live = liveDependencies;
    for (const cell of mounted.dependencies) if (!live.has(cell)) {
      cell.dependents.delete(mounted); mounted.dependencies.delete(cell);
    }
    for (const cell of failedDependencies) if (live.has(cell)) {
      mounted.dependencies.add(cell); cell.dependents.add(mounted);
    }
    mounted.children = [];
    const value = track(mounted, () => fallback(error), true);
    validate(value);
    finishEvaluation(mounted, [{ key: 'fallback', value }]);
  } finally { recoveryScopes.pop(); }
}
function evaluateContent(mounted) {
  const { value } = mounted;
  let children = value.children.map((child, index) => ({ key: String(index), value: child }));
  if (value.kind === 'dynamic' || value.kind === 'component') {
    if (value.kind === 'component' && !mounted.component) initializeComponent(mounted);
    const body = track(mounted, () => value.kind === 'component' ? mounted.component.render(value.props.componentProps) : value.props.body());
    validate(body);
    children = [{ key: 'body', value: body }];
  } else if (value.kind === 'foreach') {
    children = value.props.rows;
  } else if (value.kind === 'modifier' && value.props.name === 'window') {
    const presented = track(mounted, () => cells.get(value.props.state).cell.value);
    if (typeof presented !== 'boolean') throw new TypeError('window requires a boolean presentation binding');
    if (!presented) children = children.slice(0, 1);
  }
  finishEvaluation(mounted, children);
}
function finishEvaluation(mounted, children) {
  const { value } = mounted;
  const old = new Map(mounted.children.map(child => [child.key, child]));
  mounted.children = children.map(child => {
    const result = reconcile(old.get(child.key), child.value, child.key, mounted);
    old.delete(child.key); return result;
  });
  unmountAll(old.values());
  if (value.kind === 'modifier' && value.props.name === 'window') windowViews.set(mounted.id, mounted);
  const { body, fallback, rows, row, action, onMessage, onError, api, onSubmit, onEditingChanged, onAppearance, onTap, focusBinding, definition, setup, componentProps, ...props } = value.props;
  if (mounted.tapCount !== props.count || mounted.tapPriority !== props.priority || props.name !== 'onTapGesture' || !onTap) {
    taps.delete(mounted.tapToken); mounted.tapToken = undefined;
  }
  if (value.kind === 'modifier' && props.name === 'onTapGesture') {
    mounted.tapToken ??= nextTap++; mounted.tapCount = props.count; mounted.tapPriority = props.priority;
    taps.set(mounted.tapToken, { id: mounted.id, count: props.count, callback: onTap }); props.tap = mounted.tapToken;
  }
  if (mounted.appearancePhase !== props.name || !onAppearance) {
    appearances.delete(mounted.appearanceToken); mounted.appearanceToken = undefined;
  }
  if (value.kind === 'modifier' && ['onAppear', 'onDisappear'].includes(props.name)) {
    if (typeof onAppearance !== 'function') throw new TypeError('Appearance modifier expects a function');
    mounted.appearanceToken ??= nextAppearance++; mounted.appearancePhase = props.name;
    appearances.set(mounted.appearanceToken, { id: mounted.id, phase: props.name, callback: onAppearance });
    props.appearance = mounted.appearanceToken;
  }
  if (value.kind === 'textfield' || value.kind === 'securefield') {
    if (!onSubmit || mounted.submitState !== props.state) {
      textSubmits.delete(mounted.submitToken); mounted.submitToken = undefined;
    }
    if (onSubmit) {
      mounted.submitToken ??= nextSubmit++;
      mounted.submitState = props.state;
      textSubmits.set(mounted.submitToken, { id: mounted.id, state: props.state, callback: onSubmit });
      props.submit = mounted.submitToken;
    }
  }
  if (['textfield', 'securefield', 'texteditor'].includes(value.kind)) {
    if (!onEditingChanged || mounted.editingState !== props.state) {
      textEditings.delete(mounted.editingToken); mounted.editingToken = undefined;
    }
    if (onEditingChanged) {
      mounted.editingToken ??= nextEditing++;
      mounted.editingState = props.state;
      textEditings.set(mounted.editingToken, { id: mounted.id, state: props.state, callback: onEditingChanged });
      props.editing = mounted.editingToken;
    }
  }
  if (value.kind === 'button') {
    if (typeof action !== 'function') throw new TypeError('Button expects an action');
    actions.set(mounted.id, action);
  }
  if (value.kind === 'webview') {
    let entry = webAPIs.get(mounted.id);
    if (entry && entry.html !== props.html) { disposeWebAPI(mounted.id); entry = undefined; }
    if (!entry) { entry = { html: props.html, epoch: nextWebEpoch++, owner: { disposed: false }, runs: new Map() }; webAPIs.set(mounted.id, entry); }
    entry.api = api; props.rpcEpoch = entry.epoch; props.methods = Object.keys(api);
    if (onMessage) actions.set(mounted.id, onMessage); else actions.delete(mounted.id);
    webErrors.set(mounted.id, onError ?? null);
  }
  updates.set(mounted.id, { id: mounted.id, kind: value.kind === 'component' ? 'dynamic' : value.kind, props, children: mounted.children.map(child => child.id) });
}
function commit(initial = false, options = {}) {
  if (updates.size || initial) {
    request('commit', { nodes: [...updates.values()], ...(initial ? { root: root.id, window: options } : {}) });
    updates.clear();
  }
  // Native bindings must remain valid until the committed tree no longer uses
  // them. The host validates that a cell cannot escape its owner's lifetime.
  if (pendingStateReleases.size) {
    request('state.release', { ids: [...pendingStateReleases] });
    pendingStateReleases.clear();
  }
}
function flush() {
  // Reconciliation and ordinary effects belong to the app scheduler. A task
  // writing an input must not pass its (possibly soon cancelled) async context
  // into unrelated renders, cleanup or effects scheduled by that write.
  if (taskStorage.getStore()) return taskStorage.run(undefined, flush);
  scheduled = false;
  if (stopped || !root || flushing) return;
  flushing = true;
  try {
    let cycles = 0;
    const effectRuns = new Map();
    while (dirty.size || pendingEffects.size) {
      if (++cycles > 10000) throw new Error('Reactive updates did not settle after 10000 cycles; check effect state writes');
      // Reconcile parents first; they can remove pending children and effects.
      const views = [...dirty].sort((a, b) => a.id - b.id);
      for (const mounted of views) {
        if (!dirty.has(mounted)) continue;
        dirty.delete(mounted);
        if (!mounted.alive) continue;
        let target = mounted;
        for (let parent = mounted.parent; parent; parent = parent.parent) {
          if (parent.value.props.fallback) target = parent;
        }
        evaluate(target);
      }
      if (dirty.size) continue;
      commit();
      // Effects run only after their views have committed. A write can unmount
      // another queued effect, so reconcile that write before starting more.
      for (const observer of [...pendingEffects]) {
        if (pendingEffects.has(observer)) {
          const runs = (effectRuns.get(observer.site) ?? 0) + 1;
          effectRuns.set(observer.site, runs);
          if (runs > 100) throw new Error('Reactive updates did not settle after 100 cycles at one effect site; check effect state writes');
          runEffect(observer);
        }
        if (dirty.size) break;
      }
    }
    commit();
  } finally { flushing = false; }
}
function fail(error) {
  console.error(error?.stack ?? error);
  shutdown(error instanceof Error ? error : new Error(String(error)));
  bridge.finish(1);
}
function schedule() {
  if (scheduled || mounting || flushing || !root || stopped) return;
  scheduled = true; queueMicrotask(() => { try { flush(); } catch (error) { fail(error); } });
}
function shutdown(error, partialMounts = []) {
  if (stopped) return;
  stopped = true;
  let failure = error;
  try { stop?.onStop?.(); } catch (caught) { failure ??= caught; }
  try { unmountAll([...(root ? [root] : []), ...partialMounts]); } catch (caught) { failure ??= caught; } finally { root = null; }
  focusListeners.clear(); focusWatch = null;
  for (const watch of availabilityWatches.values()) {
    for (const entry of watch.entries) { entry.callback = null; entry.task = null; entry.unregister = () => {}; }
    watch.entries.clear();
  }
  availabilityWatches.clear(); availabilityTokens.clear();
  for (const observer of [...computations]) disposeComputed(observer);
  for (const id of [...webAPIs.keys()]) disposeWebAPI(id);
  dirty.clear(); updates.clear(); actions.clear(); webErrors.clear(); textSubmits.clear(); textEditings.clear(); appearances.clear(); taps.clear(); windowViews.clear();
  for (const { listeners, cell } of cells.values()) { listeners.clear(); cell.dependents.clear(); }
  cells.clear();
  try { request('dispose'); } catch (caught) { failure ??= caught; }
  pendingStateReleases.clear(); pendingEffects.clear(); effects.clear(); pendingTasks.clear();
  if (failure) stop?.reject(failure); else stop?.resolve();
  if (failure && !error) { console.error(failure?.stack ?? failure); bridge.finish(1); }
}
globalThis.__jonuiFail = error => shutdown(error);
bridge.listen(json => {
  try {
    const event = JSON.parse(json);
    if (stopped) return;
    if (event.type === 'state') cells.get(event.id)?.accept(event);
    else if (event.type === 'windowClosed') {
      const mounted = windowViews.get(event.id);
      if (mounted?.alive && mounted.children[1]?.id === event.content) {
        const removed = mounted.children.slice(1); mounted.children = mounted.children.slice(0, 1);
        unmountAll(removed);
        updates.set(mounted.id, { id: mounted.id, kind: 'modifier', props: mounted.value.props, children: mounted.children.map(child => child.id) });
        dirty.add(mounted);
      }
      cells.get(event.state?.id)?.accept(event.state);
      schedule();
    }
    else if (event.type === 'action') actions.get(event.id)?.();
    else if (event.type === 'focusChanged') receiveFocusChange(event);
    else if (event.type === 'focusAvailability') receiveAvailabilityChange(event);
    else if (event.type === 'tap') {
      const entry = taps.get(event.token);
      if (!entry || entry.id !== event.id || entry.count !== event.count) return;
      const result = taskStorage.run(undefined, () => untracked(entry.callback));
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError('Tap callbacks must be synchronous; use scope.task for asynchronous work');
      }
    }
    else if (event.type === 'appearance') {
      const entry = appearances.get(event.token);
      if (!entry || entry.id !== event.id || entry.phase !== event.phase) return;
      const result = taskStorage.run(undefined, () => untracked(() => entry.callback()));
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError('Appearance callbacks must be synchronous; use scope.task for asynchronous work');
      }
    }
    else if (event.type === 'textSubmit') {
      const submit = textSubmits.get(event.token);
      if (!submit || submit.id !== event.id || submit.state !== event.state?.id) return;
      cells.get(submit.state)?.accept(event.state);
      const callback = textSubmits.get(event.token)?.callback;
      callback?.();
    }
    else if (event.type === 'textEditing') {
      const editing = textEditings.get(event.token);
      if (!editing || editing.id !== event.id || editing.state !== event.state?.id || typeof event.editing !== 'boolean') return;
      cells.get(editing.state)?.accept(event.state);
      const callback = textEditings.get(event.token)?.callback;
      callback?.(event.editing);
    }
    else if (event.type === 'webRequest') handleWebRequest(event);
    else if (event.type === 'webCancel') {
      const entry = webAPIs.get(event.id);
      if (entry?.epoch === event.epoch) for (const call of event.calls) { const key = JSON.stringify([event.document, call]), run = entry.runs.get(key); entry.runs.delete(key); cancelTask(run); }
    }
    else if (event.type === 'webMessage') actions.get(event.id)?.(event.value);
    else if (event.type === 'webError') {
      if (!webErrors.has(event.id)) return;
      const handler = webErrors.get(event.id);
      if (handler) handler(event.message); else console.error(`WebView ${event.id}: ${event.message}`);
    }
    else if (event.type === 'stop') shutdown();
  } catch (error) { fail(error); }
});
export function runApp(options) {
  assertNotComputing('start applications');
  if (typeof options.title !== 'string' || ![options.width, options.height].every(n => Number.isFinite(n) && n > 0)) throw new TypeError('runApp requires a title and positive finite window dimensions');
  if (root || stop || stopped) throw new Error('runApp can only be called once');
  return new Promise((resolve, reject) => {
    stop = { resolve, reject, onStop: options.onStop };
    const initialMounts = new Set(); recoveryScopes.push(initialMounts);
    try {
      mounting = true;
      root = reconcile(null, options.content, 'root');
      commit(true, { title: options.title, width: options.width, height: options.height });
    } catch (error) { shutdown(error, [...initialMounts].reverse()); } finally { recoveryScopes.pop(); mounting = false; }
    schedule();
  });
}
// Test-only entry points use the real Swift host and event queue, not a mock.
export const __testing = process.env.JONUI_TEST === '1' ? Object.freeze({
  request,
  flush,
  webRequestStats: () => ({ apis: webAPIs.size, pending: [...webAPIs.values()].reduce((n, entry) => n + entry.runs.size, 0) }),
  taskStats: () => ({ pending: pendingTasks.size }),
  effectStats: () => ({ active: effects.size, pending: pendingEffects.size }),
  computedStats: () => ({ active: computations.size, dependencies: [...computations].reduce((n, observer) => n + observer.dependencies.size, 0) }),
  focusStats: () => ({ listeners: focusListeners.size, watching: focusWatch !== null }),
  availabilityStats: () => ({ names: availabilityWatches.size, listeners: [...availabilityWatches.values()].reduce((n, watch) => n + watch.entries.size, 0) }),
  stats: () => ({ actions: actions.size + focusListeners.size + [...availabilityWatches.values()].reduce((n, watch) => n + watch.entries.size, 0) + textSubmits.size + textEditings.size + appearances.size + taps.size + [...webErrors.values()].filter(Boolean).length + [...webAPIs.values()].reduce((n, entry) => n + Object.keys(entry.api).length, 0), cells: cells.size, dependencies: [...cells.values()].reduce((n, v) => n + v.cell.dependents.size, 0) }),
}) : undefined;
