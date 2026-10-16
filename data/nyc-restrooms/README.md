# NYC public restroom snapshot

`restrooms.json` contains **1,064 actual source listings across NYC**, imported from all 1,066 rows in the saved [NYC Open Data Public Restrooms dataset](https://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku). Every source row has valid coordinates; two exact duplicate rows are merged. The coordinates and published facility details come from the official source, not generated examples. This is the full coordinate-bearing citywide source snapshot, not a claim that the dataset includes every restroom in NYC.

The source was retrieved on **October 15, 2026, New York time** (`2026-10-16T00:04:14Z`). The dataset's published data-update timestamp is **June 27, 2025**. Its metadata-update timestamp is November 5, 2025. None of these timestamps is a visit or an inspection date for an individual restroom.

## Files

- `restrooms.json`: portable app bundle with `{ schemaVersion, source, restrooms }`.
- `source-records.json`: the complete 1,066-row public SODA response used for this import, including official row identifiers. All 1,066 rows pass coordinate validation; no geographic crop is applied.
- `source-metadata.json`: official dataset metadata and field descriptions as returned by the NYC metadata API.
- `provenance.json`: source URLs, timestamps, actual imported coordinate extents, validation and type/status counts, SHA-256 hashes, skipped-coordinate reasons, and duplicate row identifiers.

The importer merges only rows whose entire source payload matches after removing the source row ID and automatic computed-region fields. Both original IDs are preserved in `sourceRecordIds`. This merges one pair at Ancient Playground and one pair at Heckscher Playground. Same-name listings with different coordinates or different published details remain separate. The primary ID remains the lexicographically smallest official row ID, so all **55 previously imported Upper Manhattan listing IDs are unchanged**, including the merged Ancient Playground listing. Saved places and notes retain the same venue identifiers.

Socrata row IDs are identifiers for this source snapshot; the publisher does not provide a separate persistent facility identifier. A future publisher reimport could change source row IDs, so review identifier changes before replacing the snapshot.

The citywide listing types are **822 Park, 216 Library, 14 Privately Owned Public Space, 7 Public Plaza, and 5 Transit**. The dataset does not structurally identify borough or neighborhood; this import does not infer either from coordinates.

## Portable record schema

All object keys are camelCase. Coordinates are JSON numbers; IDs are strings. Every record includes every key. Unknown values are JSON `null`, not missing keys or guessed defaults.

| Keys | JSON type | Meaning |
| --- | --- | --- |
| `id` | string | Dataset ID plus the primary official source row ID. |
| `name` | string | Published facility name. |
| `latitude`, `longitude` | number | WGS84 coordinates from the official source. |
| `locationType`, `operator` | string or null | Published location category and operator. |
| `publishedStatus`, `seasonality`, `hours` | string or null | Published source text; no schedule parsing or current-open calculation. |
| `facilityAccessibility` | string or null | Source ADA accessibility label for the building facility. |
| `restroomType`, `changingStations` | string or null | Source text, including any qualifiers. |
| `accessNotes` | string or null | Source access/location notes; inspect this text before making a specific access claim. |
| `website` | string or null | Facility website supplied by the source. |
| `sourceRecordId`, `sourceUrl` | string | Primary official row ID and public dataset URL. |
| `sourceRecordIds` | array of strings | All original row IDs, including merged duplicate IDs. |
| `address`, `neighborhood` | string or null | Always null in this import: these are not structured source fields. |
| `purchaseRequired` | boolean or null | Always null in this import. Free text is not converted into an inferred purchase rule. |
| `restroomFloor`, `stairsToRestroom`, `cleanliness`, `observationDate` | string or null | Always null in this import: no team observations or structured source claims exist for these fields. |

`source` contains `datasetId`, `title`, `url`, `apiUrl`, `metadataUrl`, `publisher`, `agency`, `attribution`, `officialRestroomInformationUrl`, `retrievedAt`, `dataUpdatedAt`, `metadataUpdatedAt`, `scope`, `bounds`, counts, `liveAvailability`, `teamInspected`, and `limitations`. Timestamps are ISO 8601 UTC strings. Both Boolean flags are false. Apps can decode only the fields they use; the core record schema is suitable for Swift `Decodable` and TypeScript.

Coordinate-validation counts are explicit:

- `sourceRowsFetched`: **1,066** source rows examined.
- `sourceRowsWithCoordinates`: **1,066** rows with numeric, finite coordinates inside latitude -90…90 and longitude -180…180.
- `skippedInvalidCoordinates`: **0** rows excluded for missing/non-numeric values, non-finite values, or values outside WGS84 ranges. `skippedCoordinateReasons` reports reason counts when exclusions occur, and `provenance.json` records each skipped source row ID and reason.
- `duplicateRowsMerged`: **2** otherwise identical rows merged.
- `recordCount`: **1,064** distinct imported listings.
- `sourceRowsInBounds`: deprecated compatibility alias for `sourceRowsWithCoordinates`; it no longer represents a geographic selection window.

`source.bounds` is calculated from the imported records, rather than used to filter them: south **40.50228**, north **40.903731**, west **-74.2517**, east **-73.7096**. Consumers can fit a map to these actual extents.

## Display rules and limitations

- Label the records **“NYC Open Data”** and link to `sourceUrl`.
- Label status as **“Published status”** and display the data-update date. `Operational` does not mean open now. The source includes closed and non-operational listings; retain and label them rather than implying that every pin is usable.
- Hours and notes are historical source text. The city warns that availability changes due to maintenance, construction, and other factors. Use the facility's source website to seek current information when one is provided.
- The source's accessibility definition concerns the building facility. **“Fully Accessible” does not establish a step-free route to a restroom or an accessible stall.** Internal route details remain unknown.
- Display unreported product fields as **“Not reported.”** Do not convert nulls into “No,” “Free,” “Clean,” or “Accessible.”
- This dataset contains no cleanliness observations, team inspection dates, visitor reports, or real-time status. A retrieval date must never become “Last reported” or “Last inspected.”
- The importer preserves source wording without correcting apparent errors, inferring schedules, reverse geocoding neighborhoods, or fabricating addresses. The raw snapshot retains original whitespace; app fields trim surrounding whitespace only.

## Reproduce or refresh

From the product repository root, refresh from the public NYC APIs with Python 3 and an Internet connection:

```sh
python3 scripts/import-nyc-restrooms.py
```

No API key, account, or private credentials are required. The script uses paginated SODA requests and validates the dataset, identifiers, names, and finite WGS84 coordinates. Invalid coordinates are counted and recorded; there is no arbitrary NYC or neighborhood bounding-box filter. A record with valid coordinates but no name or official ID stops the import for review rather than silently disappearing.

Reproduce this saved import without a network request:

```sh
python3 scripts/import-nyc-restrooms.py \
  --rows data/nyc-restrooms/source-records.json \
  --metadata data/nyc-restrooms/source-metadata.json \
  --retrieved-at 2026-10-16T00:04:14Z \
  --output /tmp/restroom-ready-data-reproduction
```

The source retains control of published updates; refresh and then review the resulting diff before shipping a new snapshot. Expanding this saved snapshot did not change the raw source response, metadata, retrieval timestamp, or published update timestamps.
