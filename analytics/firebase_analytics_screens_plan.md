# Native Analytics screen coverage

Source integration plan for the current SwiftUI app. Checked rows have explicit typed screen hooks; runtime verification is recorded separately in the native Analytics feature receipt. Every payload uses the finite contract in `NativeAnalyticsEvent.swift`.

| TaskID | Completed | Title | Description | File path |
| --- | --- | --- | --- | --- |
| 1 | [x] | Finder map | Visible discovery root and return from a sheet | `ios/Restroom Ready/Views/NativeRootView.swift` |
| 2 | [x] | List | Actual map/list transition | `ios/Restroom Ready/Views/NativeRootView.swift` |
| 3 | [x] | Saved places | Saved discovery state, including return to main map | `ios/Restroom Ready/Views/NativeRootView.swift` |
| 4 | [x] | Filters | Actual filter-sheet appearance | `ios/Restroom Ready/Views/NativeRootView.swift` |
| 5 | [x] | Restroom card | Visible card and return from nested navigation | `ios/Restroom Ready/Views/PlaceDetailSheet.swift` |
| 6 | [x] | Passcodes | Detail navigation path | `ios/Restroom Ready/Views/PlaceDetailSheet.swift` |
| 7 | [x] | Rate and Comment | Detail navigation path | `ios/Restroom Ready/Views/PlaceDetailSheet.swift` |
| 8 | [x] | Sources and dates | Detail navigation path | `ios/Restroom Ready/Views/PlaceDetailSheet.swift` |
| 9 | [x] | Account | Account appearance and return from comments/deletion chooser | `ios/Restroom Ready/Views/NativeAccountView.swift` |
| 10 | [x] | Comments by you | Own-contribution destination appearance | `ios/Restroom Ready/Views/NativeAccountView.swift` |
| 11 | [x] | Account deletion chooser | Explicit confirmation-dialog opening | `ios/Restroom Ready/Views/NativeAccountView.swift` |
| 12 | [x] | Sign-in choices | Actual protected-action provider-choice sheet | `ios/Restroom Ready/Views/PlaceDetailSheet.swift` |
| 13 | [x] | Add restroom | Form appearance | `ios/Restroom Ready/Views/NewRestroomForm.swift` |
| 14 | [x] | Add a public note | Unified visit form and retained legacy public-note form | `ios/Restroom Ready/Views/ContributionForms.swift` |
| 15 | [x] | Report an amenity problem | Problem-mode unified visit form | `ios/Restroom Ready/Views/ContributionForms.swift` |
| 16 | [x] | Report a new code | New and retained legacy code forms | `ios/Restroom Ready/Views/ContributionForms.swift` |
| 17 | [x] | Change code visibility | New and legacy visibility forms | `ios/Restroom Ready/Views/ContributionForms.swift` |
| 18 | [x] | Directory unavailable | Actual bundled-directory load-failure appearance; no false Finder event | `ios/Restroom Ready/Restroom_ReadyApp.swift` |
| 19 | [x] | Restroom requests | Account-owned bounded request history, with pending/approved/denied states | `ios/Restroom Ready/Views/OwnRestroomRequestsView.swift` |

Native platform/provider surfaces (Apple authorization, Google authorization, date/choice pickers, external Safari/Maps) do not expose app-owned screen bodies. Provider attempts/cancellation/results are measured at their real service callbacks; accepted URL/Maps handoffs are measured without logging URLs or coordinates. Picker values, drafts and source content are not sent.

Explicit Cancel and confirmed Discard/Leave submission emit `form_cancel`; Keep editing, successful submission, account changes and generic disappearance do not. Clean swipe dismissal is not mislabeled as an explicit Cancel. Form opens are deduplicated locally per presentation. New users and returning logins are measured only from confirmed Firebase results; mutation successes are measured only by NativeStore.

New restroom submissions emit `restroom_request_submit` only after the private queue write is confirmed. Approval happens later on the server and is not counted as a native submission or passcode-publication success. Moderator workspace actions are excluded from product Analytics.
