import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import test from "node:test";

const source = await readFile(new URL("../lib/source-reports.ts", import.meta.url), "utf8");
const isolated = source.replace(/^import bundledRegistry from [^;]+;/m,
  'const bundledRegistry = {cutoff:"2026-10-21",sources:[],reports:[]};');
const model = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(isolated)).toString("base64")}`);
const fixture = () => ({
  cutoff: "2026-10-21",
  sources: [{ id: "source-one", title: "A dated public account", url: "https://example.com/restroom#details", publishedOn: "2026-03-01", dateKind: "post", sourceType: "discussion", dateEvidence: "Visible post date: March 1, 2026.", limitations: "Visit date absent." }],
  reports: [{ id: "report-one", placeID: "city-one", sourceID: "source-one", venueLabel: "Example branch", reportedOn: "2026-04-02", observedOn: null, facts: [{ field: "stairsToRestroom", value: "Not reported" }, { field: "elevatorAccess", value: "Building elevator reported; restroom route unknown." }], limitations: "No visit date provided." }],
});

test("source and report dates reject impossible dates, timestamps, other years and dates beyond cutoff", () => {
  for (const value of ["2025-12-31", "2027-01-01", "2026-02-29", "2026-04-31", "2026-10-22", "2026-3-1", "2026-03-01T00:00:00Z", "", null]) {
    const data = fixture(); data.sources[0].publishedOn = value;
    assert.throws(() => model.validateSourceRegistry(data));
  }
  for (const value of ["2026-02-30", "2026-10-22", "2025-12-31", "2026-03-01T12:00:00Z"]) {
    const data = fixture(); data.reports[0].reportedOn = value;
    assert.throws(() => model.validateSourceRegistry(data));
  }
  for (const value of ["2026-01-01", "2026-10-21"]) {
    const data = fixture(); data.sources[0].publishedOn = value;
    assert.equal(model.validateSourceRegistry(data).sources[0].publishedOn, value);
  }
  const data = fixture(); data.cutoff = "2026-10-22";
  assert.throws(() => model.validateSourceRegistry(data));
});

test("safe public source links reject executable, credentialed, local and malformed URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://u:p@example.com/", "https://localhost/", "https://127.0.0.1/", "https://127.1/", "https://[::1]/", "https://host.local/", "https://example.com:8443/", "https:\\example.com", "https://example.com/\n", "https://example.com/a b"]) {
    const data = fixture(); data.sources[0].url = value;
    assert.throws(() => model.validateSourceRegistry(data));
  }
  assert.equal(model.validateSourceRegistry(fixture()).sources[0].url, "https://example.com/restroom#details");
});

test("unreported facts and observation dates remain unknown without inference from an elevator or date", () => {
  const data = model.validateSourceRegistry(fixture());
  const [report] = model.sourceReportsForPlace("city-one", data);
  assert.equal(report.observedOn, null);
  assert.equal(report.reportedOn, "2026-04-02");
  assert.equal(report.source.publishedOn, "2026-03-01");
  assert.deepEqual(report.facts, fixture().reports[0].facts);
  assert.equal(report.facts.some((fact) => fact.field === "stepFreeAccess"), false);
  assert.deepEqual(model.sourceReportsForPlace("city-two", data), []);
  assert.deepEqual(model.sourceReportsForPlace("city-one-extra", data), []);
  const invented = fixture(); invented.reports[0].observedOn = "2026-04-02";
  assert.throws(() => model.validateSourceRegistry(invented));
});

test("conflicting accounts stay separate and repeated field values are not voted or overwritten", () => {
  const data = fixture();
  data.reports[0].facts = [{ field: "restroomFloor", value: "Ground floor." }, { field: "entryRule", value: "Unknown." }];
  data.reports.push({ ...data.reports[0], id: "report-two", facts: [{ field: "restroomFloor", value: "Basement." }] });
  const registry = model.validateSourceRegistry(data);
  const reports = model.sourceReportsForPlace("city-one", registry);
  assert.deepEqual(reports.map((report) => report.facts[0].value), ["Ground floor.", "Basement."]);
  assert.equal(model.groupSourceFacts(reports[0].facts)[0].label, "Entry");
  assert.equal(model.groupSourceFacts(reports[0].facts)[1].label, "Route inside");
  assert.equal(reports[0].facts[1].value, "Unknown.");
});

test("registry identities, references, facts and bounded text reject malformed or private data", () => {
  const mutations = [
    (data) => data.sources.push({ ...data.sources[0] }),
    (data) => data.reports.push({ ...data.reports[0] }),
    (data) => { data.reports[0].sourceID = "missing"; },
    (data) => { data.reports[0].placeID = "../private"; },
    (data) => { data.reports[0].facts[0].field = "passcode"; },
    (data) => { data.reports[0].code = "private-example"; },
    (data) => { data.reports[0].facts[0].value = " "; },
    (data) => { data.reports[0].facts[0].value = "x".repeat(1001); },
    (data) => { data.reports[0].facts[0].value = "bad\u0000value"; },
    (data) => { data.sources[0].dateEvidence = ""; },
    (data) => { data.sources[0].dateKind = "crawled"; },
    (data) => { data.sources[0].sourceType = "private-note"; },
    (data) => { data.reports[0].facts = []; },
  ];
  for (const mutate of mutations) {
    const data = fixture(); mutate(data);
    assert.throws(() => model.validateSourceRegistry(data));
  }
});

test("all researched field types have literal labels and stable groups; dates do not shift by time zone", () => {
  const facts = model.SOURCE_FACT_FIELDS.map((field) => ({ field, value: "Not reported" }));
  const groups = model.groupSourceFacts(facts);
  assert.equal(groups.flatMap((group) => group.facts).length, facts.length);
  assert.equal(facts.every((fact) => Boolean(model.SOURCE_FACT_LABELS[fact.field])), true);
  assert.equal(groups.find((group) => group.label === "Route inside").facts.some((fact) => fact.field === "restroomAccessibility"), true);
  assert.equal(groups.find((group) => group.label === "Conditions & availability").facts.some((fact) => fact.field === "genderDesignation"), true);
  assert.equal(model.formatSourceDate("2026-10-21"), "Oct 21, 2026");
});

test("real city IDs retain tilde separators, and the actual bundled release validates", async () => {
  const placeID = "i7jb-7jku:row-u4w2~sxrz_579e";
  const data = fixture(); data.reports[0].placeID = placeID;
  assert.equal(model.sourceReportsForPlace(placeID, model.validateSourceRegistry(data))[0].placeID, placeID);
  const bundled = JSON.parse(await readFile(new URL("../data/research-2026/reports.json", import.meta.url), "utf8"));
  const registry = model.validateSourceRegistry(bundled);
  assert.ok(registry.reports.length > 0);
  for (const report of registry.reports) {
    assert.ok(model.sourceReportsForPlace(report.placeID, registry).some((item) => item.id === report.id));
    assert.equal(report.observedOn, null);
    assert.equal(report.facts.some((fact) => fact.field === "passcode"), false);
  }
});

test("rendered discussion reports distinguish start, comment and unknown visit dates, and escape source text", async () => {
  const data = fixture();
  data.sources[0].dateKind = "published";
  data.sources[0].title = "<script>source title</script>";
  data.reports.push({ ...data.reports[0], id: "undated-comment", reportedOn: null });
  const modelJS = stripTypeScriptTypes(source.replace(/^import bundledRegistry from [^;]+;/m, `const bundledRegistry = ${JSON.stringify(data)};`));
  const modelURL = `data:text/javascript;base64,${Buffer.from(modelJS).toString("base64")}`;
  const require = createRequire(import.meta.url);
  const component = await readFile(new URL("../components/finder/source-reports.tsx", import.meta.url), "utf8");
  await loadBindings();
  const compiled = await transform(component, { filename: "source-reports.tsx", jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "es6" } });
  const componentJS = compiled.code
    .replace(/import \{ ArrowUpRight, FileText \} from "lucide-react";/, "const ArrowUpRight = () => null, FileText = () => null;")
    .replace('from "@/lib/source-reports"', `from ${JSON.stringify(modelURL)}`)
    .replace('import styles from "./source-reports.module.css";', 'const styles = new Proxy({}, { get: (_, key) => key });')
    .replace('from "react/jsx-runtime"', `from ${JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)}`);
  const { SourceReports } = await import(`data:text/javascript;base64,${Buffer.from(componentJS).toString("base64")}`);
  const html = renderToStaticMarkup(createElement(SourceReports, { placeID: "city-one" }));
  assert.match(html, /Discussion started/);
  assert.match(html, /Comment posted/);
  assert.match(html, /Comment date not reported/);
  assert.match(html, /Observation date not reported/);
  assert.match(html, /&lt;script&gt;source title&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(renderToStaticMarkup(createElement(SourceReports, { placeID: "another-branch" })), "");
});
