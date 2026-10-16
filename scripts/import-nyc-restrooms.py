#!/usr/bin/env python3
"""Import all coordinate-bearing records in NYC's public restroom snapshot."""

import argparse
import collections
import datetime
import hashlib
import json
import math
import pathlib
import urllib.parse
import urllib.request


DATASET_ID = "i7jb-7jku"
DATASET_URL = f"https://data.cityofnewyork.us/City-Government/Public-Restrooms/{DATASET_ID}"
API_URL = f"https://data.cityofnewyork.us/resource/{DATASET_ID}.json"
METADATA_URL = f"https://data.cityofnewyork.us/api/views/{DATASET_ID}.json"
ROOT = pathlib.Path(__file__).resolve().parents[1]


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "RestroomReady-OfficialDataImport/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def load_rows(path):
    if path:
        return json.loads(path.read_text())
    rows = []
    while True:
        query = urllib.parse.urlencode({"$select": "*, :id as source_row_id", "$order": ":id", "$limit": 2000, "$offset": len(rows)})
        page = fetch_json(f"{API_URL}?{query}")
        rows.extend(page)
        if len(page) < 2000:
            return rows


def text(value):
    return value.strip() or None if isinstance(value, str) else None


def timestamp(value):
    if value is None:
        return None
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=pathlib.Path, help="Use a saved SODA response instead of downloading rows.")
    parser.add_argument("--metadata", type=pathlib.Path, help="Use saved source metadata instead of downloading it.")
    parser.add_argument("--retrieved-at", help="UTC snapshot timestamp; use the original timestamp when reproducing an import.")
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "data" / "nyc-restrooms")
    args = parser.parse_args()

    metadata = json.loads(args.metadata.read_text()) if args.metadata else fetch_json(METADATA_URL)
    rows = load_rows(args.rows)
    if metadata.get("id") != DATASET_ID or not isinstance(rows, list):
        raise ValueError("Unexpected source dataset or response shape")
    retrieved = args.retrieved_at or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    datetime.datetime.fromisoformat(retrieved.replace("Z", "+00:00"))

    selected = []
    skipped = []
    for row in rows:
        reason = None
        try:
            if isinstance(row.get("latitude"), bool) or isinstance(row.get("longitude"), bool):
                raise ValueError("Boolean coordinates are not numeric locations")
            latitude, longitude = float(row["latitude"]), float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            reason = "missing_or_non_numeric"
        if reason is None and not (math.isfinite(latitude) and math.isfinite(longitude)):
            reason = "non_finite"
        if reason is None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            reason = "outside_wgs84_range"
        if reason is not None:
            skipped.append({"sourceRecordId": row.get("source_row_id"), "name": text(row.get("facility_name")), "reason": reason})
            continue
        if not row.get("source_row_id") or not text(row.get("facility_name")):
            raise ValueError("A source record with valid coordinates is missing its name or official row identifier")
        selected.append(row)
    selected.sort(key=lambda row: row["source_row_id"])
    if not selected:
        raise ValueError("No source records contain valid WGS84 coordinates")

    groups = {}
    for row in selected:
        comparable = {key: value for key, value in row.items() if key != "source_row_id" and not key.startswith(":@computed_region_")}
        fingerprint = json.dumps(comparable, ensure_ascii=False, sort_keys=True)
        groups.setdefault(fingerprint, []).append(row)

    restrooms = []
    for group in groups.values():
        row = group[0]
        source_ids = sorted(item["source_row_id"] for item in group)
        site = row.get("website", {})
        restrooms.append({
            "id": f"{DATASET_ID}:{source_ids[0]}",
            "name": text(row.get("facility_name")),
            "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]),
            "locationType": text(row.get("location_type")),
            "operator": text(row.get("operator")),
            "publishedStatus": text(row.get("status")),
            "seasonality": text(row.get("open")),
            "hours": text(row.get("hours_of_operation")),
            "facilityAccessibility": text(row.get("accessibility")),
            "restroomType": text(row.get("restroom_type")),
            "changingStations": text(row.get("changing_stations")),
            "accessNotes": text(row.get("additional_notes")),
            "website": text(site.get("url")) if isinstance(site, dict) else text(site),
            "sourceRecordId": source_ids[0],
            "sourceRecordIds": source_ids,
            "sourceUrl": DATASET_URL,
            "address": None,
            "neighborhood": None,
            "purchaseRequired": None,
            "restroomFloor": None,
            "stairsToRestroom": None,
            "cleanliness": None,
            "observationDate": None,
        })
    restrooms.sort(key=lambda row: (row["name"].casefold(), row["id"]))
    bounds = {
        "south": min(row["latitude"] for row in restrooms),
        "north": max(row["latitude"] for row in restrooms),
        "west": min(row["longitude"] for row in restrooms),
        "east": max(row["longitude"] for row in restrooms),
    }

    source = {
        "datasetId": DATASET_ID,
        "title": metadata["name"],
        "url": DATASET_URL,
        "apiUrl": API_URL,
        "metadataUrl": METADATA_URL,
        "publisher": "NYC Open Data",
        "agency": metadata.get("metadata", {}).get("custom_fields", {}).get("Dataset Information", {}).get("Agency"),
        "attribution": metadata.get("attribution"),
        "officialRestroomInformationUrl": metadata.get("attributionLink"),
        "retrievedAt": retrieved,
        "dataUpdatedAt": timestamp(metadata.get("rowsUpdatedAt")),
        "metadataUpdatedAt": timestamp(metadata.get("viewLastModified")),
        "scope": "All source rows in this citywide NYC public restroom snapshot with valid WGS84 coordinates; not a complete inventory of every restroom in NYC.",
        "bounds": bounds,
        "sourceRowsFetched": len(rows),
        "sourceRowsWithCoordinates": len(selected),
        "skippedInvalidCoordinates": len(skipped),
        "skippedCoordinateReasons": dict(collections.Counter(row["reason"] for row in skipped)),
        "sourceRowsInBounds": len(selected),
        "duplicateRowsMerged": len(selected) - len(restrooms),
        "recordCount": len(restrooms),
        "liveAvailability": False,
        "teamInspected": False,
        "limitations": [
            "The official dataset says availability can change and may not reflect real-time conditions.",
            "Published status and hours are historical source text, not a prediction that a restroom is open now.",
            "Facility accessibility describes the building facility and does not establish a step-free route or accessible restroom stall.",
            "Source text is preserved without correcting apparent errors or deriving schedules.",
            "Address, neighborhood, purchase requirement, restroom floor, internal stairs, cleanliness, and observation date are not structurally reported by this source and remain null; free-text access notes may contain additional information.",
            "The retrieval timestamp is not an inspection, visitor report, or per-facility update date.",
        ],
    }
    bundle = {"schemaVersion": 1, "source": source, "restrooms": restrooms}
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "restrooms.json", bundle)
    write_json(args.output / "source-records.json", rows)
    write_json(args.output / "source-metadata.json", metadata)
    hashes = {name: hashlib.sha256((args.output / name).read_bytes()).hexdigest() for name in ["restrooms.json", "source-records.json", "source-metadata.json"]}
    write_json(args.output / "provenance.json", {"schemaVersion": 1, "source": source, "sha256": hashes, "statusCounts": dict(collections.Counter(row["publishedStatus"] for row in restrooms)), "locationTypeCounts": dict(collections.Counter(row["locationType"] for row in restrooms)), "skippedCoordinateRows": skipped, "duplicateSourceIds": [row["sourceRecordIds"] for row in restrooms if len(row["sourceRecordIds"]) > 1]})
    print(f"Imported {len(restrooms)} venue records from {len(selected)} valid-coordinate source rows; skipped {len(skipped)} invalid-coordinate rows and merged {len(selected) - len(restrooms)} identical duplicate rows.")


if __name__ == "__main__":
    main()
