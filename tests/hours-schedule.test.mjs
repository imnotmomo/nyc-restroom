import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';

const require = createRequire(import.meta.url);
await loadBindings();
async function compile(relative, imports = {}) {
  const result = await transform(await readFile(new URL(relative, import.meta.url), 'utf8'), {
    filename: relative, jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' }
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.code)(module, module.exports, name => Object.hasOwn(imports, name) ? imports[name] : require(name));
  return module.exports;
}
const model = await compile('../lib/hours-schedule.ts');
const weekly = ['Monday: 9am–5pm', 'Tuesday: 10am–6pm', 'Wednesday: 11am–7pm', 'Thursday: 9am–8pm',
  'Friday: 9am–9pm', 'Saturday: 10am–4pm', 'Sunday: Closed'].join('\n');

test('word ranges and explicit daily selectors preserve the intended complete week', () => {
  for (const separator of ['to', 'through']) {
    const value = `Monday ${separator} Saturday: 7:30 am–9:30 pm; Sunday: 11 am–7 pm`;
    assert.equal(model.compactHours(value, new Date('2026-11-05T18:00:00Z')).text, 'Today (Thu): 7:30 am–9:30 pm');
    assert.equal(model.compactHours(value, new Date('2026-11-08T18:00:00Z')).text, 'Today (Sun): 11 am–7 pm');
  }
  for (const selector of ['Daily', 'Every day']) {
    assert.equal(model.compactHours(`${selector}: 8am–6pm`, new Date('2026-11-05T18:00:00Z')).text, 'Daily: 8am–6pm');
  }
});

test('complete colon and tab schedules show only the New York weekday, not the host or UTC day', () => {
  for (const value of [weekly, weekly.replaceAll(': ', '\t'), weekly.replace('Thursday: ', 'Thursday ')]) {
    assert.equal(model.parseWeeklyHours(value).length, 7);
    assert.equal(model.compactHours(value, new Date('2026-11-06T02:00:00Z')).text, 'Today (Thu): 9am–8pm');
    assert.equal(model.compactHours(value, new Date('2026-11-06T05:00:00Z')).text, 'Today (Fri): 9am–9pm');
    assert.equal(model.compactHours(value, new Date('2026-11-08T17:00:00Z')).text, 'Today (Sun): Closed');
  }
});

test('every reviewed complete seven-day source schedule can be reduced without losing raw evidence', async () => {
  const source = JSON.parse(await readFile(new URL('../data/research-map-2026-10-24/public-card-profiles.json', import.meta.url), 'utf8'));
  let count = 0;
  for (const profile of source.profiles) for (const fact of profile.facts) {
    if (['hours', 'restroomHours', 'venueHours'].includes(fact.field) && /Monday[:\t]/i.test(fact.value) && /Sunday[:\t]/i.test(fact.value)) {
      assert.ok(model.parseWeeklyHours(fact.value), profile.placeID);
      assert.equal(model.compactHours(fact.value, new Date('2026-11-05T18:00:00Z')).weekly, true, profile.placeID);
      count++;
    }
  }
  assert.ok(count >= 201, `Reviewed full-week schedules: ${count}`);
});

test('weekday ranges, abbreviations, lists and literal overnight/multiple windows are preserved', () => {
  const rows = 'Mon.–Fri.: 9am–5pm / 7pm–10pm; Saturday: 10pm–2am; Sunday: Closed';
  assert.equal(model.compactHours(rows, new Date('2026-11-07T18:00:00Z')).text, 'Today (Sat): 10pm–2am');
  assert.equal(model.compactHours(rows, new Date('2026-11-05T18:00:00Z')).text, 'Today (Thu): 9am–5pm / 7pm–10pm');
  const list = 'Monday, Wednesday & Friday: 9–5\nTue and Thu: 10–6\nSat–Sun: Closed';
  assert.equal(model.parseWeeklyHours(list)[2], '10–6');
  const wrap = 'Fri–Mon: 9–5; Tues.–Thurs.: 10–6';
  assert.equal(model.parseWeeklyHours(wrap)[0], '9–5');
  assert.equal(model.parseWeeklyHours(wrap)[4], '10–6');
});

test('ambiguous, partial, overlapping or extra-note weeks never guess today', () => {
  for (const value of [
    'Monday: 9–5\nTuesday: Closed', 'Mon–Fri: 9–5; Friday–Sunday: 10–6',
    'Mon–Sat: 9–5; Sun:', 'Mon–Fri: 9–5 Tue: 10–6; Sat–Sun: Closed',
    weekly + '\nHoliday hours vary', weekly + '\nMonday: 10–6', 'Monday–Sunday: ' + 'x'.repeat(501)
  ]) {
    assert.equal(model.parseWeeklyHours(value), null, value);
    assert.doesNotMatch(model.compactHours(value, new Date('2026-11-05T18:00:00Z')).text, /Today/, value);
  }
});

test('identical weekdays compress to Daily while generic daily and seasonal restrictions remain literal', () => {
  assert.equal(model.compactHours('Mon–Sun: 9am–5pm', null).text, 'Daily: 9am–5pm');
  for (const value of ['24/7', 'Daily 10am–6pm', 'Seasonal; check park opening times', 'Closed', 'Open by permit', 'Concession Operating Hours']) {
    assert.equal(model.compactHours(value, new Date('2026-11-05T18:00:00Z')).text, value);
  }
  assert.equal(model.compactHours('x'.repeat(200), null).text.length, 108);
  for (const value of [undefined, null, '', ' unknown ', 'not-reported', 'Hours unknown', 'N/A']) {
    assert.equal(model.compactHours(value, null).text, 'Hours unknown');
  }
});

test('null/invalid clocks keep a stable SSR summary without a false weekday', () => {
  for (const date of [null, new Date('invalid')]) {
    assert.deepEqual(model.compactHours(weekly, date), { text: 'See weekly schedule', weekly: true, varying: true, weekday: null });
  }
});

test('direct/restroom source precedence and explicit venue fallback cannot conflate business hours', () => {
  const at = new Date('2026-11-05T18:00:00Z');
  const venue = { field: 'venueHours', scope: 'venue', value: weekly };
  const restroom = { field: 'restroomHours', scope: 'restroom', value: '9–5' };
  assert.equal(model.cardHoursPresentation({ reported: '24/7', listed: '8–6', facts: [restroom, venue] }, at).text, '24/7');
  assert.equal(model.cardHoursPresentation({ listed: '8–6', facts: [restroom, venue] }, at).source, 'listed-restroom');
  assert.equal(model.cardHoursPresentation({ facts: [restroom, venue] }, at).source, 'researched-restroom');
  const fallback = model.cardHoursPresentation({ facts: [venue] }, at);
  assert.equal(fallback.source, 'venue'); assert.match(fallback.label, /restroom hours unconfirmed/);
  assert.equal(fallback.text, 'Today (Thu): 9am–8pm');
  assert.equal(model.cardHoursPresentation({ facts: [{ ...venue, scope: 'restroom' }] }, at).source, 'unknown');
  assert.equal(model.cardHoursPresentation({ facts: [restroom, { ...restroom, value: '10–6' }, venue] }, at).text, 'See full schedules');
  assert.equal(model.cardHoursPresentation({ facts: [{ ...restroom, context: 'Men’s room' }] }, at).text, 'See full schedules');
});

test('next New York midnight handles ordinary, spring-forward and fall-back days exactly', () => {
  for (const [start, end] of [
    ['2026-11-05T04:59:59.900Z', '2026-11-05T05:00:00Z'],
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
    ['2026-11-05T15:20:00Z', '2026-11-06T05:00:00Z']
  ]) assert.equal(model.millisecondsUntilNextNewYorkDay(new Date(start)), Date.parse(end) - Date.parse(start), start);
});

test('mounted hours clock refreshes at midnight/foreground and removes timers and listeners on unmount', async () => {
  const RealDate = globalThis.Date;
  const original = { window: globalThis.window, document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let now = Date.parse('2026-11-05T04:59:59Z'), effect, cleanup, nextTimer, states = [], cleared = [];
  const windowListeners = new Map(), documentListeners = new Map();
  const events = map => ({ addEventListener: (name, handler) => map.set(name, handler), removeEventListener: (name, handler) => { assert.equal(map.get(name), handler); map.delete(name); } });
  try {
    globalThis.Date = class extends RealDate { constructor(value) { super(arguments.length ? value : now); } };
    globalThis.window = events(windowListeners);
    globalThis.document = { ...events(documentListeners), visibilityState: 'visible' };
    globalThis.setTimeout = (fn, delay) => { nextTimer = { fn, delay }; return 17; };
    globalThis.clearTimeout = id => cleared.push(id);
    const hook = await compile('../components/finder/use-hours-date.ts', { '@/lib/hours-schedule': model,
      react: { useState: () => [null, value => states.push(value)], useEffect: fn => { effect = fn; } } });
    assert.equal(hook.useHoursDate(), null); assert.equal(states.length, 0);
    cleanup = effect();
    assert.equal(states[0].toISOString(), '2026-11-05T04:59:59.000Z');
    assert.equal(nextTimer.delay, 1050);
    now += 1100; nextTimer.fn();
    assert.equal(states.at(-1).toISOString(), '2026-11-05T05:00:00.100Z');
    now += 86400000; windowListeners.get('pageshow')();
    assert.equal(states.at(-1).getTime(), now);
    const before = states.length; globalThis.document.visibilityState = 'hidden'; documentListeners.get('visibilitychange')();
    assert.equal(states.length, before);
    globalThis.document.visibilityState = 'visible'; documentListeners.get('visibilitychange')();
    assert.equal(states.length, before + 1);
    windowListeners.get('focus')(); assert.equal(states.length, before + 2);
    const staleTimer = nextTimer.fn; cleanup(); cleanup = null;
    assert.equal(windowListeners.size, 0); assert.equal(documentListeners.size, 0); assert.ok(cleared.includes(17));
    const last = states.length; staleTimer(); assert.equal(states.length, last);
  } finally {
    cleanup?.(); globalThis.Date = RealDate;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
