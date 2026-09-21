# Personal workspace verification

Unreleased work. The [build plan](plans/personal-workspace.md) remains the
acceptance contract; this receipt does not mark it complete.

## Destination timing baseline

Production preview localhost:3108, deployment `personal-restore`, application
code at 81e787cf. Local Postgres, visual-demo workspace, desktop browser with
both navigation and AI rails. This fixture has 17 personal timeline items and
one deliberately saved bookmark; it is not a large-workspace benchmark.

CUA drove normal navigation clicks. Temporary CDP instrumentation measured from
capture-phase click dispatch to the animation frame after the destination's
content was present. Tool latency is excluded. Writing requires a writing row;
Bookmarks requires a saved row; News requires a feed row; Home requires its
initial timeline and headlines to have settled. This measures DOM readiness
across frame boundaries, not compositor presentation or image decode completion.

| Destination | First measured visit, ms | Repeat 1, ms | Repeat 2, ms |
| --- | ---: | ---: | ---: |
| Writing | 89.0 | 46.8 | 45.0 |
| Bookmarks | 306.9 | 377.0 | 126.9 |
| News | 327.8 | 110.3 | 89.0 |
| Home | 69.0 | 88.8 | 58.7 |

The first measured visit is not a cold application launch. Initial Bookmarks
shell appeared at 128.1ms and News shell at 43.7ms, before their content was
ready. A longer sampling batch exceeded the tool execution deadline and its
unreturned results were discarded. The two repeat cycles above were collected
after reconnecting. No p95 claim is supported by this sample count.

Code inspection confirms SavedArticles initializes its rows/cursor empty on
every mount and waits for fetchReadingPage; its session stores filters but not
loaded pages. News and Home already retain in-memory snapshots. Next work:
retain a bounded, workspace-scoped saved-library snapshot with revalidation and
access invalidation, preserve loaded-page return position, then repeat the full
navigation benchmark. Cold loading and all other performance gates remain open.

All temporary measurement listeners, timers and probe properties were removed.

## Saved-library return cache

Bookmarks now retains up to four in-memory views of at most 500 rows each,
separated by workspace handle, folder, query and saved state. Returning renders
the retained rows immediately and revalidates the entire loaded window. Focus
and reading-state changes also refresh it. Access/scope failures clear retained
rows; transient failures keep them available with a retry. Pagination and
refresh responses are fenced when the view changes or unmounts.

The Home test directory passes 32 tests; the new saved-library client suite
passes three tests, including denial on a later refresh page. Type checking
passes. Targeted lint has no errors and three existing image warnings.
The isolated local production build passes. Browser timing verification of this
change remains pending; the measurements above describe the previous implementation.
