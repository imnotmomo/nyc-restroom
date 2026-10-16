import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDirectory = join(root, "data/nyc-restrooms");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const bundle = readJson(join(dataDirectory, "restrooms.json"));
const sourceRows = readJson(join(dataDirectory, "source-records.json"));
const provenance = readJson(join(dataDirectory, "provenance.json"));
const snapshotTimestamp = "2026-10-16T00:04:14Z";

function withImport(rowsPath, metadataPath, inspect) {
  const output = mkdtempSync(join(tmpdir(), "restroom-ready-import-"));
  try {
    const result = spawnSync(process.env.PYTHON ?? "python3", [
      join(root, "scripts/import-nyc-restrooms.py"),
      "--rows", rowsPath, "--metadata", metadataPath,
      "--retrieved-at", snapshotTimestamp, "--output", output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    inspect(output);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test("the saved citywide import is reproducible with unchanged source hashes and dates", () => {
  withImport(join(dataDirectory, "source-records.json"), join(dataDirectory, "source-metadata.json"), (output) => {
    for (const name of ["restrooms.json", "source-records.json", "source-metadata.json", "provenance.json"]) {
      assert.deepEqual(readFileSync(join(output, name)), readFileSync(join(dataDirectory, name)), name);
    }
  });
  assert.equal(bundle.source.retrievedAt, snapshotTimestamp);
  assert.equal(bundle.source.dataUpdatedAt, "2025-06-27T13:37:10Z");
  assert.equal(bundle.source.metadataUpdatedAt, "2025-11-05T20:39:42Z");
  assert.equal(provenance.sha256["source-records.json"], "d914fb61463dd1ee431a0e1ae739beb6bef0120c61d41aa6e3b15b5c1d1d82aa");
  assert.equal(provenance.sha256["source-metadata.json"], "5cccb719ce5d81919592c31dc54932d14baa1e6bcd9f27f3bfc00ce86129c6b6");
  for (const [name, expected] of Object.entries(provenance.sha256)) {
    assert.equal(createHash("sha256").update(readFileSync(join(dataDirectory, name))).digest("hex"), expected);
  }
});

test("every coordinate-bearing source row is represented with truthful unknowns and actual map extents", () => {
  assert.equal(sourceRows.length, 1066);
  assert.equal(bundle.restrooms.length, 1064);
  assert.equal(new Set(bundle.restrooms.map((row) => row.id)).size, 1064);
  assert.deepEqual(new Set(bundle.restrooms.flatMap((row) => row.sourceRecordIds)), new Set(sourceRows.map((row) => row.source_row_id)));
  assert.equal(bundle.source.sourceRowsWithCoordinates, 1066);
  assert.equal(bundle.source.sourceRowsInBounds, 1066);
  assert.equal(bundle.source.skippedInvalidCoordinates, 0);
  assert.equal(bundle.source.duplicateRowsMerged, 2);
  assert.equal(bundle.source.liveAvailability, false);
  assert.equal(bundle.source.teamInspected, false);
  assert.deepEqual(bundle.source.bounds, { south: 40.50228, north: 40.903731, west: -74.2517, east: -73.7096 });
  const originals = new Map(sourceRows.map((row) => [row.source_row_id, row]));
  for (const row of bundle.restrooms) {
    assert.ok(Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90);
    assert.ok(Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180);
    const original = originals.get(row.sourceRecordId);
    assert.equal(row.name, original.facility_name.trim());
    assert.equal(row.latitude, Number(original.latitude));
    assert.equal(row.longitude, Number(original.longitude));
    for (const [key, sourceKey] of [["hours", "hours_of_operation"], ["publishedStatus", "status"], ["accessNotes", "additional_notes"], ["facilityAccessibility", "accessibility"]]) {
      assert.equal(row[key], original[sourceKey]?.trim() || null);
    }
    for (const field of ["address", "neighborhood", "purchaseRequired", "restroomFloor", "stairsToRestroom", "cleanliness", "observationDate"]) {
      assert.equal(row[field], null, `${row.id}: ${field}`);
    }
  }
});

test("all 55 previous listing IDs survive the citywide expansion", () => {
  const oldSourceIds = [
    "row-xb7j_yzsr~cp6w", "row-wd3n_m6af.efra", "row-r4sd-ynz8.qsvg", "row-sgn6-m2jb_a85u", "row-ew5y~kfcp_3ryy",
    "row-tb6f-6jwt~sxs6", "row-fq7z~232e_idkm", "row-id2j_9y39~z9t6", "row-8f7e~ixnh_gbd7", "row-ydta.8p7n.yyyv",
    "row-hd3k.ufaw_6x49", "row-bqbf.aupv_7bh9", "row-5tyc.zhrq~xiy9", "row-ngvw_4mc5.tcmy", "row-7bkt-w46m~mknx",
    "row-6dmp.5j6g.e8zs", "row-cb6h~bh7t.f9ec", "row-qh88-5nme~4g85", "row-hn44_hvw8.6fep", "row-6ze4_yfem.ujs8",
    "row-xrdz~rt5u.4wgu", "row-istc_6g89_5xnr", "row-3tke-8zz3.4z4r", "row-9j2u-a7i7_62ei", "row-smta_5iyt_z6j3",
    "row-yj3w.b6yv.qi8h", "row-mj8p_i8i3-ycam", "row-7vwp.ed74.m94v", "row-b54d_2smb~qdav", "row-hum7-us9n_zhnj",
    "row-ay5g.ig99.78di", "row-4k37_nsj8_gqh5", "row-ibeb_pynv.q9pd", "row-avsr-tsga~d43a", "row-thse-qht4~5d4t",
    "row-8ske_5pf2_akv2", "row-q3wq~4iwg~aqw5", "row-jhbk.qvbm-v88y", "row-wjgv-mxhh_d2x5", "row-kea8_kf3c.r8ca",
    "row-5ahv_369h_v47e", "row-m6b4_csrf_552h", "row-64cr_9r47.v6yj", "row-h6jb.ur3h~mnzw", "row-4ay4.yikz_y58x",
    "row-23tw-52x4~fjrq", "row-vzzz~ckni.myg9", "row-gp52_buh5.zwas", "row-u9nb~bju8-4j24", "row-n4wh-n8eq.gm9g",
    "row-gfpk~xdnj~24d3", "row-na7x~np7y.rvjy", "row-icx8-76x4.hmjd", "row-4kdp.j56x~fgix", "row-62fg-c8qr-sfye",
  ];
  const currentIds = new Set(bundle.restrooms.map((row) => row.id));
  assert.equal(oldSourceIds.length, 55);
  for (const sourceId of oldSourceIds) assert.ok(currentIds.has(`i7jb-7jku:${sourceId}`), sourceId);
  assert.deepEqual(bundle.restrooms.find((row) => row.id === "i7jb-7jku:row-ew5y~kfcp_3ryy").sourceRecordIds, ["row-ew5y~kfcp_3ryy", "row-pvrf_u6zc_s5ja"]);
});

test("invalid coordinates are explained, exact duplicates merge, and different details stay separate", () => {
  const directory = mkdtempSync(join(tmpdir(), "restroom-ready-import-fixture-"));
  try {
    const base = { facility_name: "Fixture facility", latitude: "40.7", longitude: "-74.0", status: "Operational" };
    const rows = [
      { ...base, source_row_id: "row-z", ":@computed_region_test": "1" },
      { ...base, source_row_id: "row-a", ":@computed_region_test": "2" },
      { ...base, source_row_id: "row-detail", additional_notes: "A different published access note" },
      { ...base, source_row_id: "row-missing", latitude: null },
      { ...base, source_row_id: "row-nonnumeric", longitude: "not a coordinate" },
      { ...base, source_row_id: "row-bool", latitude: true },
      { ...base, source_row_id: "row-nan", latitude: "NaN" },
      { ...base, source_row_id: "row-infinity", longitude: "Infinity" },
      { ...base, source_row_id: "row-lat-range", latitude: "90.01" },
      { ...base, source_row_id: "row-lon-range", longitude: "-180.01" },
    ];
    const rowsPath = join(directory, "rows.json");
    const metadataPath = join(directory, "metadata.json");
    writeFileSync(rowsPath, JSON.stringify(rows));
    writeFileSync(metadataPath, JSON.stringify({ id: "i7jb-7jku", name: "Fixture source" }));
    withImport(rowsPath, metadataPath, (output) => {
      const actual = readJson(join(output, "restrooms.json"));
      const record = readJson(join(output, "provenance.json"));
      assert.equal(actual.restrooms.length, 2);
      assert.equal(actual.source.sourceRowsWithCoordinates, 3);
      assert.equal(actual.source.skippedInvalidCoordinates, 7);
      assert.deepEqual(actual.source.skippedCoordinateReasons, { missing_or_non_numeric: 3, non_finite: 2, outside_wgs84_range: 2 });
      assert.equal(actual.source.duplicateRowsMerged, 1);
      assert.deepEqual(actual.restrooms.find((row) => row.id === "i7jb-7jku:row-a").sourceRecordIds, ["row-a", "row-z"]);
      assert.equal(actual.restrooms.find((row) => row.id === "i7jb-7jku:row-detail").accessNotes, "A different published access note");
      assert.equal(record.skippedCoordinateRows.length, 7);
      assert.deepEqual(new Set(record.skippedCoordinateRows.map((row) => row.sourceRecordId)), new Set(rows.slice(3).map((row) => row.source_row_id)));
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
