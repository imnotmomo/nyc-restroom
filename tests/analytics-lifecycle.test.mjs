import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transform, loadBindings } from 'next/dist/build/swc/index.js';

const require = createRequire(import.meta.url);
await loadBindings();
async function compiled(path) {
  return (await transform(await readFile(new URL(path, import.meta.url), 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'typescript', tsx: path.endsWith('tsx') },
      target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  })).code;
}
const modelCode = await compiled('../lib/analytics.ts');
const componentCode = await compiled('../components/analytics.tsx');

// Execute the real compiled component/effects with a deterministic hook host.
// No browser, Google tag, Firebase account or production traffic is involved.
function harness() {
  const events = [], listeners = new Map(), cells = [], effects = new Map();
  let cursor = 0, dirty = false, pending = [], fail = true, output;
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const unlisten = (name, fn) => listeners.get(name)?.delete(fn);
  const window = { location: { href: 'https://nyc.imfinethanku.me/find/' }, addEventListener: listen, removeEventListener: unlisten,
    gtag: (...args) => { if (fail) throw Error('tag initialization unavailable'); events.push(args); } };
  const document = { referrer: '', title: 'Find a restroom', visibilityState: 'visible', addEventListener: listen, removeEventListener: unlisten };
  const react = {
    Suspense: Symbol('Suspense'),
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      return [cells[index], value => { if (cells[index] !== value) { cells[index] = value; dirty = true; } }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = effects.get(index);
      if (!previous || dependencies.some((value, n) => value !== previous.dependencies[n])) {
        pending.push(() => { previous?.cleanup?.(); effects.set(index, { dependencies, cleanup: callback() }); });
      }
    },
  };
  function evaluate(code, imports = {}) {
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, window, document, URL, URLSearchParams, Date, Reflect,
      process: { env: {} }, require: name => Object.hasOwn(imports, name) ? imports[name] : require(name) });
    return module.exports;
  }
  const model = evaluate(modelCode);
  const Script = () => null;
  const component = evaluate(componentCode, {
    react,
    'next/navigation': { usePathname: () => new URL(window.location.href).pathname, useSearchParams: () => new URL(window.location.href).searchParams },
    'next/script': { __esModule: true, default: Script },
    '@/analytics/web-config.json': { __esModule: true, default: { measurementId: 'G-MOCKTEST' } },
    '@/lib/analytics': model,
  });
  function render() {
    let rounds = 0;
    do {
      dirty = false; cursor = 0; pending = [];
      const page = component.Analytics().props.children;
      output = page.type(page.props);
      for (const effect of pending) effect();
      assert.ok(++rounds < 12, 'effects must settle');
    } while (dirty);
    return output;
  }
  return { component, window, render, setReady: () => { fail = false; },
    signup: () => component.trackNewGoogleAccount({ isNewUser: true, providerId: null, credentialProviderId: 'google.com', accountId: 'private-account', currentAccountId: 'private-account' }),
    signupEvents: () => events.filter(args => args[0] === 'event' && args[1] === 'sign_up'),
    events,
  };
}

test('the real component loads the tag after initialization fails and drains one signup on readiness', () => {
  const app = harness();
  const script = app.render();
  assert.ok(script?.props.src.includes('G-MOCKTEST'), 'tag loading cannot depend on successful initialization');
  app.component.setAnalyticsAccount('private-account');
  app.signup();
  assert.equal(app.signupEvents().length, 0);
  app.setReady();
  script.props.onReady();
  app.render();
  app.signup();
  app.render().props.onReady();
  app.render();
  assert.equal(app.signupEvents().length, 1);
  assert.equal(app.events.filter(args => args[0] === 'event' && args[1] === 'page_view').length, 1);
  assert.doesNotMatch(JSON.stringify(app.events), /private-account|accountId|user_id/);
});

test('private-route navigation disables the tag and cannot replay an earlier pending signup', () => {
  const app = harness();
  app.render(); app.component.setAnalyticsAccount('private-account'); app.signup();
  app.window.location.href = 'https://nyc.imfinethanku.me/admin/';
  assert.equal(app.render(), null);
  assert.equal(app.window['ga-disable-G-MOCKTEST'], true);
  app.setReady();
  app.window.location.href = 'https://nyc.imfinethanku.me/find/';
  app.render().props.onReady(); app.render();
  assert.equal(app.signupEvents().length, 0);
});

test('sign-out and moderator exclusion clear pending candidates before the tag becomes ready', () => {
  for (const allowed of [true, false]) {
    const app = harness();
    const script = app.render(); app.component.setAnalyticsAccount('private-account'); app.signup();
    app.component.setAnalyticsAccount(allowed ? null : 'private-account', allowed);
    app.setReady(); script.props.onReady(); app.render();
    assert.equal(app.signupEvents().length, 0);
  }
});
