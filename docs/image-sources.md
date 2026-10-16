# Marketing photography

Source and license pages checked October 16, 2026. These are real photographs of New York City used for context. They are separate from the illustrative café listing and do not establish a restroom's present entry policy, condition, hours, or accessibility. No photographer or person pictured is presented as a customer or as endorsing Restroom Ready.

All four photographs are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The visible caption on each marketing page names the place, photograph date, creator, linked source page, license, and changes. The license applies to the photographs; it does not change the license of the application.

| Route | Photograph and creator | Photograph date | Source / license | Local filename prefix |
| --- | --- | --- | --- | --- |
| `/` | Bryant Park from One Vanderbilt — © Larry D. Moore | May 26, 2022 | [Commons file and attribution request](https://commons.wikimedia.org/wiki/File:Bryant_Park_from_One_Vanderbilt_New_York_City_2022.jpg) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `bryant-park` |
| `/conditions/` | New York Public Library Main Branch exterior — Kidfly182 | July 31, 2024 | [Commons file](https://commons.wikimedia.org/wiki/File:New_York_Public_Library_Main_Branch_Exterior.jpg) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `nypl-exterior` |
| `/entry-route/` | Bryant Park Restroom 2023, side from 42nd Street — SnowFire | December 28, 2023 | [Commons file](https://commons.wikimedia.org/wiki/File:Bryant_Park_Restroom_2023_side.jpg) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `bryant-restroom-side` |
| `/dated-reports/` | Bryant Park Restroom 2023, back — SnowFire | December 28, 2023 | [Commons file](https://commons.wikimedia.org/wiki/File:Bryant_Park_Restroom_2023_back.jpg) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `bryant-restroom-back` |

## Local files and changes

The browser uses local files under `public/images/nyc/`, with 640 px and 1280 px responsive widths. Original JPEGs were downloaded from the file pages' Wikimedia upload URLs. They were oriented according to EXIF, converted to RGB WebP, resized with Lanczos, and recompressed at quality 78–80 using Pillow. EXIF and GPS metadata were not retained. The page displays a centered 16:9 crop using CSS; the full resized composition remains in the local file. No objects or people were added or removed, and no synthetic imagery was used.

| Asset | Dimensions | Bytes |
| --- | --- | ---: |
| `bryant-park-640.webp` | 640 × 427 | 87,280 |
| `bryant-park-1280.webp` | 1280 × 853 | 336,654 |
| `nypl-exterior-640.webp` | 640 × 288 | 20,124 |
| `nypl-exterior-1280.webp` | 1280 × 576 | 67,022 |
| `bryant-restroom-side-640.webp` | 640 × 480 | 84,270 |
| `bryant-restroom-side-1280.webp` | 1280 × 960 | 311,872 |
| `bryant-restroom-back-640.webp` | 640 × 480 | 98,002 |
| `bryant-restroom-back-1280.webp` | 1280 × 960 | 353,774 |

The images are lazy loaded below the hero. Width and height attributes, a fixed aspect-ratio frame, and `srcset`/`sizes` reserve layout space and avoid loading the large image when a small one suffices. Descriptive alt text identifies the scene; credits remain readable text below each image. The existing signup, map preview, and actual finder behavior are unchanged.
