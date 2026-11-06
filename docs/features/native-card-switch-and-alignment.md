# Restroom card replacement height and text alignment

Status: shipped — build 1.0 (16), Testing in Team only — November 5, 2026.

Selecting a different map pin while a restroom card is half open can replace it at full height. Each new restroom selection must begin at medium height, retain the ability to pull up, and preserve the current height during nested navigation, sign-in and form dismissal.

The main-card Hours, Amenities and Condition values and supporting text must align to the left, matching their labels and icons. Preserve the existing available text width, wrapping, typography and evidence text. The user corrected an earlier right-alignment typo; expanded views keep their build15 layout.

NativeRootView and its simulator regression are owned by the native implementation agent. PlaceDetailSheet’s shared summaryFact alignment is owned by the coordinator. An independent reviewer checks the final source and runtime evidence. This is a focused correction; unrelated audit recommendations remain pending.

Acceptance: switch between distinct map pins with the existing sheet at half height; the selected new restroom must start at half height. A previously expanded card can be dismissed and a fresh selection must also start at half height. Pull-up, nested destinations and protected-action cancellation keep their established behavior. Inspect normal and largest-text main-card screenshots for the three left-aligned value rows. Expanded Hours, Amenities, Condition and Sources & dates retain their previous layouts. After verification, archive and upload the next internal build, and assign only the existing Team group with no tester-membership changes.

The amenity list also omits the men’s/women’s room designation while retaining supported All-gender, changing-station and other facility labels. The original restroom type stays visible in Sources & dates. This changes presentation normalization only; original records and room-specific source context stay intact.

Verification: all 171 model checks passed. Four focused signed-simulator UI cases passed on the final product source: normal/largest main-card text and real MapKit pin replacement, expansion, Sources navigation and reopen. A final stronger largest-text screenshot case also passed, showing the entire Condition value and source/date above Directions. Only the UI screenshot assertion helper differed between those final runs; all product/model/config/resource hashes matched. Root and independent review accepted the screenshots in screenshots/native-card16/ and all 129 final source pins.

The actual pin regression uses two existing NYC venues and the real cluster-tap zoom and MapKit didSelect path. Its fixture and accessibility identifiers are DEBUG-only and must be absent from the Release app. No authentication or contribution/deletion write was performed for these checks. The isolated simulator was shut down.

Build [1.0 (16)](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/72ff25de-b757-4376-96fe-482b0460f2fd) completed Apple processing and is Testing in exactly the existing Team internal group with two testers. What to Test is saved; no testers or other build assignments were added. The signed package, source/payload guards and exact temporary job cleanup passed independent readback. See native-build16-review.json and native-build16-distribution.json. Physical installation remains unverified; unrelated usability audit findings remain pending.
