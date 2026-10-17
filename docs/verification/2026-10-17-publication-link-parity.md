# Published links and truthful presence

October 17 source work after `0408e057`. Not installed or deployed.

The Windows publication response supplied a relative public path, but the dialog resolved it against its synthetic `texttext.local` page. The shared dialog now derives the origin from the verified native workspace connection, while retaining the public `/v/` route. Mac's explicit native public URL and the hosted website use the same validation. Invalid origins or mismatched paths hide Copy/Open actions and show an actionable message. Windows also preserves its actual configured connection URL instead of replacing it with a hardcoded production address.

The static “You are editing” avatar was removed from the item agent controls. Opening an item does not prove an editing session. Existing collaboration awareness remains the source of actual participant presence; Add agent remains available.

## Verification

- 36 focused publication, Windows transport and participant tests passed: `/private/tmp/texttext-publication-link-unit.log`.
- Production Publish component checks passed for file/native, synthetic Windows and hosted website contexts. Copy payloads and observed Open-page navigation match the public route; invalid native addresses hide the actions. `/private/tmp/texttext-publication-link-browser.log`. Clipboard is stubbed, popup navigation is observed, and no publication mutation occurs.
- Full client gate passed 494 tests, TypeScript and exact-source fingerprint: `/private/tmp/texttext-publication-scheduler-final-client.log`. Concurrent scheduler tests are included in that total.

These checks do not replace installed publish/unpublish, system clipboard or multi-account presence acceptance. The full T19/T23 matrices remain open.
