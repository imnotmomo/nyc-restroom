/** Presentation only: schedules are dated reports, never an open-now calculation. */
export const HOURS_TIME_ZONE = "America/New_York";
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const dayNames = new Map(days.flatMap((day, index) => [[day.toLowerCase(), index], [day.slice(0, 3).toLowerCase(), index]] as const));
dayNames.set("tues", 2); dayNames.set("thur", 4); dayNames.set("thurs", 4);
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: HOURS_TIME_ZONE, weekday: "long" });
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: HOURS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayWord = /\b(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/i;

export function knownHours(value: string | null | undefined): string | null {
  const text = value?.trim();
  return !text || /^(?:unknown|hours unknown|not[ -]reported|not available|n\/a)$/i.test(text) ? null : text;
}

function dayNumber(value: string): number | undefined {
  return dayNames.get(value.trim().toLowerCase().replace(/\.$/, ""));
}

function selectedDays(selector: string): number[] | null {
  if (/^(?:daily|every day)$/i.test(selector.trim())) return [0, 1, 2, 3, 4, 5, 6];
  const values: number[] = [];
  for (const part of selector.split(/\s*(?:,|&|\band\b)\s*/i)) {
    const range = part.split(/\s*(?:[-–—]|\bto\b|\bthrough\b)\s*/i);
    if (range.length > 2) return null;
    const first = dayNumber(range[0]);
    const last = range.length === 1 ? first : dayNumber(range[1]);
    if (first === undefined || last === undefined) return null;
    for (let day = first, count = 0; count < 7; count++, day = (day + 1) % 7) {
      if (values.includes(day)) return null;
      values.push(day);
      if (day === last) break;
    }
  }
  return values.length ? values : null;
}

/** Accept only a complete, nonoverlapping seven-day schedule. Keep every value literal. */
export function parseWeeklyHours(value: string): readonly string[] | null {
  if (value.length > 4_000) return null;
  const rows = value.trim().split(/\r?\n|;/).map(row => row.trim()).filter(Boolean);
  if (!rows.length || rows.length > 7) return null;
  const schedule: (string | undefined)[] = new Array(7);
  for (const row of rows) {
    const parts = row.match(/^((?:daily|every day)|[A-Za-z.]+(?:(?:\s*[-–—,&]\s*|\s+(?:and|to|through)\s+)[A-Za-z.]+)*)\s*(?::|\t|\s+)\s*(.+)$/i);
    if (!parts) return null;
    const selection = selectedDays(parts[1]);
    const hours = parts[2].trim();
    // An extra weekday/line inside a value suggests a missing separator or a
    // second schedule. It must never silently become today's sole answer.
    if (!selection || !hours || hours.length > 500 || dayWord.test(hours)
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(hours)) return null;
    for (const day of selection) {
      if (schedule[day] !== undefined) return null;
      schedule[day] = hours;
    }
  }
  return schedule.every(value => value !== undefined) && Object.keys(schedule).length === 7 ? schedule as string[] : null;
}

function bounded(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 110 ? compact : compact.slice(0, 107).trimEnd() + "…";
}

export interface HoursPresentation { text: string; weekly: boolean; varying: boolean; weekday: string | null }

/** A null date is the stable server/first-hydration state; no build-time 'today'. */
export function compactHours(value: string | null | undefined, at: Date | null): HoursPresentation {
  const text = knownHours(value);
  if (!text) return { text: "Hours unknown", weekly: false, varying: false, weekday: null };
  const schedule = parseWeeklyHours(text);
  if (schedule) {
    const varying = new Set(schedule).size > 1;
    if (!varying) return { text: bounded(/^(?:daily|every\s+day)\s+[^:]/i.test(text) ? text : `Daily: ${schedule[0]}`), weekly: true, varying: false, weekday: null };
    if (!at || !Number.isFinite(at.getTime())) return { text: "See weekly schedule", weekly: true, varying: true, weekday: null };
    const weekday = weekdayFormatter.format(at);
    return { text: bounded(`Today (${weekday.slice(0, 3)}): ${schedule[days.indexOf(weekday as typeof days[number])]}`), weekly: true, varying: true, weekday };
  }
  // Ambiguous or incomplete weekly text stays available in full, rather than
  // displaying another day's hours or a truncated list of several weekdays.
  if (dayWord.test(text) && /[\n;:]|\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b.*\b(?:mon|tue|wed|thu|fri|sat|sun)/i.test(text)) {
    return { text: "Schedule varies — see full schedule", weekly: false, varying: true, weekday: null };
  }
  return { text: bounded(text), weekly: false, varying: false, weekday: null };
}

export interface HoursFact { field: string; scope: string; value: string; context?: string }
export interface CardHoursInput {
  reported?: string | null;
  listed?: string | null;
  facts?: readonly HoursFact[];
}
export interface CardHoursPresentation extends HoursPresentation {
  label: string;
  source: "reported-restroom" | "listed-restroom" | "researched-restroom" | "venue" | "unknown";
}

/** Venue fallback is always labeled and cannot replace a known restroom schedule. */
export function cardHoursPresentation({ reported, listed, facts = [] }: CardHoursInput, at: Date | null): CardHoursPresentation {
  const direct = knownHours(reported), original = knownHours(listed);
  if (direct) return { ...compactHours(direct, at), label: "Restroom hours — report", source: "reported-restroom" };
  if (original) return { ...compactHours(original, at), label: "Listed restroom hours", source: "listed-restroom" };
  const chooseFacts = (rows: readonly HoursFact[], venue: boolean): CardHoursPresentation | null => {
    const known = rows.filter(row => knownHours(row.value));
    if (!known.length) return null;
    const label = venue ? "Venue hours — restroom hours unconfirmed" : "Restroom hours — source";
    const schedules = new Set(known.map(row => row.value.trim()));
    if (schedules.size > 1 || known.some(row => row.context?.trim())) {
      return { text: "See full schedules", label, source: venue ? "venue" : "researched-restroom", weekly: false, varying: true, weekday: null };
    }
    return { ...compactHours(known[0].value, at), label, source: venue ? "venue" : "researched-restroom" };
  };
  return chooseFacts(facts.filter(row => ["hours", "restroomHours"].includes(row.field) && ["restroom", "route"].includes(row.scope)), false)
    ?? chooseFacts(facts.filter(row => row.field === "venueHours" && row.scope === "venue"), true)
    ?? { ...compactHours(null, at), label: "Hours", source: "unknown" };
}

/** Find the real next New York date boundary, including 23/25-hour DST days. */
export function millisecondsUntilNextNewYorkDay(at: Date): number {
  const start = at.getTime();
  if (!Number.isFinite(start)) return 60_000;
  const day = dateFormatter.format(at);
  let low = start, high = start + 36 * 60 * 60 * 1_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dateFormatter.format(new Date(middle)) === day) low = middle;
    else high = middle;
  }
  return Math.max(1, high - start);
}
