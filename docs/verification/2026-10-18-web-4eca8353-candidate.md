# Web 4eca8353 prepared Oracle candidate

**Prepared and verified locally, not uploaded or deployed.** Exact source `4eca8353f455d5960e5c4cd592bece0aefff70fa` matches the [Windows normal/private candidates](2026-10-18-windows-4eca8353-candidate.md) and genuine Mac 1269 normal build.

Fresh pristine archive proof before/after: **3,158 tracked files**, source input SHA-256 `e100bcf09a1bc9c689ba62610ea88f3aa01328a1563a0497b1c276f577f650f2`, source archive SHA-256 `97985bbecf11b4b8b516fb8739a1d5e5b3c851e649f7606b49c1b720c7adc512`.

## Genuine checks and provenance

The initial attempt against the normal archive was refused by the standard delivery guard: `An active TextText work unit owns the delivery lane.` Its failure and logs remain preserved at `/private/tmp/texttext-web-4eca8353-dry-run-20261018`. That state was not changed or bypassed.

A separate fresh committed archive installed locked npm dependencies and copied **exact, unmodified bytes** of the genuine normal build's full-release and Darwin core/native sync receipts. Only those three receipts and the digest-verified policy fixture were copied into ignored generated paths. No work-unit state was copied. The standard `verify:release --check` and both sync receipt validators accepted the same source, platform and Node version.

The unchanged `npm run deploy:web -- --skip-tests --dry-run` completed with exit 0: matching sync checks, TypeScript, Oracle tests (**25 passed, one optional scratch-HTTP test skipped**), local PostgreSQL bootstrap verification (**46 release steps**), production Next build, Linux ARM64 packaging and package verification. Separately passed web/database tests were reused through the existing skip-tests contract. Generated Next declarations and TypeScript cache were retained reversibly outside source; final strict source proof and Package.resolved remained unchanged.

## Prepared artifact

Archive: `/private/tmp/texttext-web-4eca8353-fresh-20261018/source/.texttext/oracle/texttext-20261019T021712Z-4eca835.tar.gz`.

| Property | Verified value |
| --- | --- |
| Archive bytes | 229,183,897 |
| Archive SHA-256 | `114345193e5bb28ab6b29c3869375c1126f249565e7f549a9aa1f8463697f9dd` |
| Deployment ID | `texttext-oracle-20261019T021551274Z-4eca8353-1c86ff` |
| Target | Linux ARM64, Node 22 |
| Dependency lock SHA-256 | `cad4944badc1f1379210a4cafd8ffa9fbe5611679f6c49f7fb5a251093c6c830` |
| Regular logical unpack bytes | 649,996,352 |
| Archive entries | 27,612, including 25,054 regular files and 13 links |

An independent read-only archive hash/count pass and the standard package verifier both passed; metadata matches the exact commit, deployment ID, target and lockfile.

## Deployment space remains blocked

Using the Oracle free-space observation at **2026-10-19 02:01 UTC**:

| Bytes | Amount |
| --- | --- |
| Observed free | 7,797,706,752 |
| Archive plus regular logical unpack | 879,180,249 |
| Projected remaining | 6,918,526,503 |
| Unchanged 5 GiB backup reserve plus 2 GiB floor | 7,516,192,768 |
| Shortfall before filesystem overhead | **597,666,265** |

Logical sizes exclude filesystem allocation overhead and further backup/data growth. A fresh pre-deployment space check is still required. The ten October 9 upload archives (**3,119,945,605 bytes**) remain untouched pending approval; the separately approved October 8 uploads are already absent.

Oracle backup/service revalidation: `/private/tmp/texttext-oracle-revalidation-summary-4eca8353-20261018.json`, SHA-256 `67ba317c7879576b26a8c8e1d51fea3d1fec339a6a747a106019355129af9efb`. Latest retained backup validated with PostgreSQL 16 `pg_restore --list`; TextText/Postgres and unrelated Algorave services remained active. No server contact occurred during this build, and no server state, configuration, authentication, backup or service was changed.

## Evidence

`/private/tmp/texttext-web-4eca8353-fresh-20261018/evidence` contains the exact receipt/fixture copy provenance, successful child results and logs, retention record and `web-artifact-receipt.json` (SHA-256 `c1489ad87ccfd95009275e4ae237c9ee56eade94c86b8f4c055cebb5fa5b945f`). Independent package and footprint records: `/private/tmp/texttext-web-4eca8353-package-reverify-20261018.json` and `/private/tmp/texttext-web-4eca8353-footprint-20261018.json`.

No live sign-in, deployed browser behavior or physical collaboration acceptance is claimed.
