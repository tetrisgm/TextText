# Reconnect and account management verification

Source `889bac73`; Oracle `texttext-oracle-20261008T020052Z-889bac73`.

## Fixes

- `fb54a2d5`: restart the web long poll after a rapid offline/online transition abort settles; one poll at a time, bounded retry and disposed-session suppression.
- `6473f364`, `2c9d773c`, `6a2dd40e`, `89e5076a`: bind OAuth linking to the incoming authenticated session, reject invalid intents without falling through to sign-in, resume Apple cross-site POST on the same origin, and atomically audit identity linking.
- `a74cff92`: Chromium and WebKit prove Lax cookies absent on the cross-site Apple POST and present on the same-origin resume. This regression runs in default tests.
- `59a7c332`, `889bac73`: shared Settings opens account-bound management without navigating the editor. Server actions recheck the expected owner; mismatched accounts expose no linking actions.

## Evidence

- Final source: TypeScript, focused management tests and shared browser suite passed. Sync core **243 tests** and native gate passed from physical clean snapshot `/private/tmp/texttext-web-346ddf0d`.
- Oracle deployment authenticated session, origin enforcement, workspace read, note creation/edit/read, canonical storage and audit smoke passed; scratch workspace removed.
- Predeployment backup: `texttext-20261008T020156Z-3323c000.dump`. Previous release retained. TextText and all three Algorave services active; HAProxy mtime remains `2026-10-01 00:11:31.941901734 +0000`.
- Actual Safari after reload: signed-in account, existing verification note and all nine markers retained. Settings shows Apple Connected, with no logout or Finder/sync controls. Manage opens a new tab for the same account, showing Apple Connected and Connect GitHub. Closing it returns to the existing note. Google is not configured on this server. No real provider was added or removed.
- Screenshot `/tmp/texttext-sign-in-methods-live.png`; logs `/tmp/texttext-manage-{sync,deploy,browser,tsc}.log`.

Native install receipts record the corresponding Mac and Windows acceptance. These checks do not claim a live end-to-end addition of a second provider, physical power-loss safety or a second Apple-device iCloud delivery test.
