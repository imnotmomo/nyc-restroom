#!/usr/bin/env python3
"""Copy reviewed accessibility claims into a bounded discovery-time native index.

This never labels prose by keyword, edits venue records, or infers a restroom route.
The Swift resolver accepts only explicit reviewed phrases and retains conflicts.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/research-map-2026-10-24/public-card-profiles.json"
DESTINATION = ROOT / "ios/Restroom Ready/Resources/reviewed-accessibility.json"


def build():
    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    assert source["schemaVersion"] == 1
    entries = []
    fields = {"buildingAccessibility", "restroomAccessibility", "facilityAccessibility"}
    for profile in source["profiles"]:
        # Directory-only accessibility is already present in Place. Include its
        # claim when there is independent evidence so conflicts stay visible.
        if not any(fact["field"] in {"buildingAccessibility", "restroomAccessibility"}
                   for fact in profile["facts"]):
            continue
        claims = [{key: fact[key] for key in ("id", "field", "scope", "value", "sourceID")}
                  for fact in profile["facts"] if fact["field"] in fields]
        entries.append({"placeID": profile["placeID"], "claims": claims})
    assert len(entries) <= 1200
    assert len({row["placeID"] for row in entries}) == len(entries)
    result = {"schemaVersion": 1, "manifestSHA256": source["manifestSHA256"],
              "sourceSHA256": hashlib.sha256(source_bytes).hexdigest(),
              "entries": sorted(entries, key=lambda row: row["placeID"])}
    DESTINATION.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(entries)} reviewed accessibility entries to {DESTINATION.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
