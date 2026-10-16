# NYC public restroom snapshot

`restrooms.json` contains **55 actual source listings** within an upper-Manhattan bounding box near Columbia, Harlem, and northern Central Park. The coordinates and published facility details come from [NYC Open Data's Public Restrooms dataset](https://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku), not generated examples. This is a geographic sample, not complete coverage of those neighborhoods or NYC.

The source was retrieved on **October 15, 2026, New York time** (`2026-10-16T00:04:14Z`). The dataset's published data-update timestamp is **June 27, 2025**. Its metadata-update timestamp is November 5, 2025. None of these timestamps is a visit or an inspection date for an individual restroom.

## Files

- `restrooms.json`: portable app bundle with `{ schemaVersion, source, restrooms }`.
- `source-records.json`: the complete 1,066-row public SODA response used for this import, including official row identifiers. Only 56 source rows fall inside the chosen bounds.
- `source-metadata.json`: official dataset metadata and field descriptions as returned by the NYC metadata API.
- `provenance.json`: source URLs, timestamps, geographic bounds, counts, SHA-256 hashes, status counts, and the duplicate row identifiers.

The importer merges the two otherwise identical Ancient Playground source rows into one listing, preserving both official IDs in `sourceRecordIds`. Same-name listings with different coordinates or different published details remain separate. Socrata row IDs are identifiers for this source snapshot; the publisher does not provide a separate persistent facility identifier.

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

No API key, account, or private credentials are required. The script uses paginated SODA requests and validates the dataset, identifiers, names, finite coordinates, and geographic bounds.

Reproduce this saved import without a network request:

```sh
python3 scripts/import-nyc-restrooms.py \
  --rows data/nyc-restrooms/source-records.json \
  --metadata data/nyc-restrooms/source-metadata.json \
  --retrieved-at 2026-10-16T00:04:14Z \
  --output /tmp/restroom-ready-data-reproduction
```

The configured inclusive bounds are latitude **40.780–40.835**, longitude **-73.980–-73.940**. These are a selection window, not neighborhood boundaries. The source retains control of published updates; refresh and then review the resulting diff before shipping a new snapshot.
