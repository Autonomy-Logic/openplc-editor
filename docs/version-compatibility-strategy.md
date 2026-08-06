# Editor + Runtime + VPP Version Compatibility — Strategy

> Status: **agreed design** (Marcone + Thiago Alves, 2026-08-05)
> Jira: [DOPE-448](https://autonomylogic.atlassian.net/browse/DOPE-448) (epic DOPE-317 — VPP in the Editor)
> Scope: `openplc-editor` + `openplc-web` (shared surface — byte-identical),
> `openplc-runtime`, `openplc-packages`

## 1. The decision

Three declarations, one comparer.

| Component   | Declares                                 | Where it lives                                 |
| ----------- | ---------------------------------------- | ---------------------------------------------- |
| **VPP**     | `minEditorVersion` + `minRuntimeVersion` | `manifest.json` → `package` (openplc-packages) |
| **Runtime** | `minEditorVersion`                       | new `GET /api/capabilities` (openplc-runtime)  |
| **Editor**  | `minRuntimeVersion`                      | global constant in the shared surface          |

**The editor is the only component that compares.** The runtime publishes what it
requires and never enforces it; there is no editor→runtime advertising handshake
and nothing new travels inside the upload bundle.

Two consequences of that choice, both good:

- **No release-ordering constraint between phases.** A runtime that starts
  publishing `minEditorVersion` changes nothing for editors that don't read it
  yet. Every phase below is independently shippable in any order, and none can
  break a device already in the field.
- **One place to debug.** When an upload is refused, the decision was made in the
  editor, with both version strings in hand.

The accepted trade-off: the runtime _advertises_ rather than _enforces_, so a
client that skips the check can still upload. This protects the real case (our
editor against our runtime) and is not a security boundary — see §7.

## 2. What is missing today, per declaration

### 2.1 VPP — the field exists, nothing checks it

`schema/manifest.schema.json` already makes `package.minEditorVersion`
**required**, and `openplc-packages/docs/package-format.md:69` already promises:

> `minEditorVersion`: Editor will refuse to install packages requiring a newer version.

**That promise is not implemented.** The only consumer is the remote catalog UI —
`catalog-browser.tsx:272` uses `isCompatibleEditorVersion(v.minEditorVersion, APP_VERSION)`
to render an "Editor outdated" button state.

`package-manager-module.ts::install` — the single trust boundary that _both_ the
remote install and the local "Add from file…" flow pass through, which already
validates the manifest schema, verifies the package signature and hardens the
path — **never looks at `minEditorVersion`**. So today:

- installing a `.vpp` from disk ignores it entirely;
- a package installed before an editor downgrade keeps loading;
- compiling against an incompatible package is never blocked.

This matters more than a missing field would, because the agreed design _relies_
on this mechanism: a VPP that needs a UI engine only present from editor 4.2.1
onward is expected to be unable to install on 4.2.0. Making that true is the
first piece of work.

`minRuntimeVersion` does not exist in the schema at all. It is needed because a
`runtime-v4-plugin` HAL is code that runs **inside the runtime process** —
`apply_vpp_plugin_conf()` installs its conf on every upload — so a package built
against a newer runtime plugin API currently installs cleanly and fails at load
or scan time.

### 2.2 Runtime — publishes a version, requires nothing

`webserver/version.py` resolves `RUNTIME_VERSION` (baked in at image build time
via `ARG RUNTIME_VERSION`), exposed at `GET /api/version` and on the
`X-OpenPLC-Runtime-Version` header (`webserver/restapi.py:46`).

There is no endpoint where the runtime states what it needs from an editor.
`handle_upload_file` accepts any ZIP that passes `analyze_zip` (path traversal,
size, ZIP-bomb ratio, denylisted executable extensions).

### 2.3 Editor — the constant exists under a narrower name

`src/backend/shared/firmware/runtime-version-gate.ts` (shared surface) already
holds the editor's floor:

```ts
export const MIN_STRUCPP_RUNTIME_VERSION = '4.1.0'
```

This _is_ the global `minRuntimeVersion` the design calls for — it blocks upload
to any runtime below it. It only needs a name that says so.

**It must not absorb the per-feature gates.** The same file also holds:

```ts
export const MIN_USER_MANAGEMENT_RUNTIME_VERSION = '4.1.9'
```

That one hides a UI screen; it does not block upload. Collapsing the two into one
number forces a bad choice: declare `4.1.0` and the User Management screen breaks
on a 4.1.7 runtime; declare `4.1.9` and upload is blocked on a 4.1.7 runtime that
handles upload perfectly. They stay separate.

### 2.4 Two semver parsers with divergent semantics

The whole design rests on comparing version strings, and the codebase currently
answers "is X at least Y" two different ways:

|                         | `frontend/utils/semver.ts` | `firmware/runtime-version-gate.ts` |
| ----------------------- | -------------------------- | ---------------------------------- |
| Consumers               | VPP catalog                | runtime gates                      |
| `"v4"`                  | `4.0.0`                    | `null` (rejected)                  |
| `"4.1"`                 | `4.1.0`                    | `null` (rejected)                  |
| `"garbage"`             | `0.0.0` (lowest)           | `null` (rejected)                  |
| `4.1.0-rc.3` vs `4.1.0` | equal (suffix stripped)    | equal, **deliberately**            |
| Failure mode            | degrade to lowest          | fail closed                        |

Both are individually well-reasoned. Together they mean the three comparisons in
§1 could disagree depending on which helper a call site happened to import —
exactly on the malformed and pre-release inputs that show up in the field.
Unifying them is cheap and is a precondition for everything else.

## 3. How it works

### 3.1 Runtime → Editor

Scenario: editor **4.2.10**, Raspberry Pi at **192.168.1.50** running runtime **4.2.0**.

```
GET http://192.168.1.50/api/capabilities
```

```json
{
  "runtimeVersion": "v4.2.0",
  "minEditorVersion": "4.2.1"
}
```

The editor compares, both directions, locally:

```
runtime 4.2.0  >= editor's MIN_RUNTIME_VERSION (4.1.0)?   yes  → ok
editor 4.2.10  >= runtime's minEditorVersion  (4.2.1)?    yes  → ok
→ upload proceeds
```

Reverse case — editor **4.2.0** against the same runtime:

```
editor 4.2.0   >= runtime's minEditorVersion (4.2.1)?     NO   → blocked
```

Nothing is sent. This is the "and vice-versa" direction from the card, and it is
what does not exist today.

**Legacy runtime** — `GET /api/capabilities` returns `404`:

```
GET /api/version  →  {"version": "v4.1.7"}

runtime declares no floor         → nothing to check in that direction
runtime 4.1.7 >= MIN_RUNTIME_VERSION (4.1.0)?  yes  → upload proceeds
user-management needs 4.1.9?      no  → screen hidden
```

Identical to today's behaviour, plus one console warning that the runtime does
not publish its requirements.

### 3.2 VPP → Editor, at install time

```json
{
  "package": {
    "id": "com.automationdirect.p1am",
    "version": "2.0.0",
    "minEditorVersion": "4.2.1",
    "minRuntimeVersion": "4.1.9"
  }
}
```

`package-manager-module.ts::install`, right after the signature check:

```
manifest schema valid?                              ok
signature verified?                                 ok
package.id safe as a path component?                ok
APP_VERSION (4.2.0) >= minEditorVersion (4.2.1)?    NO  → install rejected
```

Covers both entry paths — remote catalog install and local "Add from file…" —
because both converge here. `catalog-browser.tsx` keeps its "Editor outdated"
state but derives it from the shared helper rather than owning the decision.

This is the mechanism that answers "what about a VPP that needs a UI engine the
editor may not have": the engine landed in some editor release, the package
declares that release as its floor, and an older editor cannot install it.

### 3.3 VPP → Runtime, at compile time

`minRuntimeVersion` cannot be checked at install — the target runtime is unknown
until you connect to a device. So it is checked in the compile pipeline, when the
selected board comes from a VPP whose target type is `runtime-v4`:

```
VPP requires runtime >= 4.1.9
connected runtime reports v4.1.7
→ compile blocked
```

## 4. Where each check lives

| Check                              | Gate                                                              | Failure surface                    |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| runtime new enough for this editor | `probe-runtime-version.ts` + `MIN_RUNTIME_VERSION`                | upload blocked pre-compile         |
| editor new enough for this runtime | `probe-runtime-version.ts` + `minEditorVersion` from the endpoint | upload blocked pre-compile         |
| editor new enough for this VPP     | `package-manager-module.ts::install` (+ on load)                  | install rejected; package unusable |
| runtime new enough for this VPP    | compile pipeline, `runtime-v4` targets                            | compile blocked                    |
| per-feature runtime capability     | existing predicates in `runtime-version-gate.ts`                  | UI surface hidden                  |

Every row is decided in the editor. The runtime and the VPP only declare.

## 5. Error messages

A gate that fires is a support ticket unless the message is complete. Following
the existing `describeIncompatibleRuntime`, every rejection names **what** was
refused, **which two versions** disagree, **which side** is stale, and **the one
action** that fixes it.

```
Runtime v4.2.0 requires OpenPLC Editor 4.2.1 or newer.
This editor is 4.2.0.
Update the editor, or connect to a runtime that accepts 4.2.0.
```

```
Package "AutomationDirect P1AM" 2.0.0 requires OpenPLC Editor 4.2.1 or newer.
This editor is 4.2.0.
Update the editor, or install package version 1.4.2.
```

```
Package "AutomationDirect P1AM" 2.0.0 requires runtime v4.1.9 or newer.
The runtime at 192.168.1.50 reports v4.1.7.
Upgrade the runtime on that device.
```

Rules: always name the device when one is involved; always state the direction —
never "incompatible versions".

## 6. Peers that declare nothing

Everything already in the field predates this work, so absence must be a
supported state rather than an error.

| Peer state                                               | Behaviour                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Runtime without `/api/capabilities`                      | no editor floor to check; existing `MIN_RUNTIME_VERSION` gate still applies; console warning |
| Runtime version unparseable (`"v4"`, `"dev"`)            | fail closed — current behaviour, unchanged                                                   |
| VPP without `minRuntimeVersion` on a `runtime-v4` target | install allowed, runtime match unverifiable, console warning at install                      |

Because the runtime never enforces, no closing window is needed on the upload
path: an old runtime simply contributes no constraint. The only future tightening
worth scheduling is making `minRuntimeVersion` mandatory for `runtime-v4`
packages, which is enforced at **package build time** (`scripts/validate.ts`) and
so never breaks an installed package.

## 7. Accepted limitation

The runtime advertises its requirement; it does not enforce it. A client that
does not implement the check — an older editor, or any other tool speaking the
upload API — can still push a program.

This was decided deliberately: it keeps the upload path untouched, requires no
new metadata inside the bundle, and removes any possibility of a runtime release
locking out editors already installed. It is not a security control, and should
not be described as one. If enforcement is ever needed, the natural follow-up is
for the editor to send its version on upload and for the runtime to compare —
additive, and not required by anything in this plan.

## 8. Delivery phases

No ordering constraint between phases: the runtime never blocks, so a phase
shipping early cannot break a peer. Ordered by value delivered.

**Phase 1 — one semver parser.** Unify `frontend/utils/semver.ts` and
`parseRuntimeVersion` into a single shared helper with one explicit policy for
malformed and pre-release inputs. Existing call sites keep their current
functions as thin wrappers so no behaviour changes and existing tests pass
untouched. Precondition for phases 2–4, which all compare version strings.
_Repos: editor + web (byte-identical) · ~half a day._

**Phase 2 — VPP install gate.** `package-manager-module.ts::install` checks
`minEditorVersion` against `APP_VERSION`, next to the signature verification;
same check when loading an already-installed package. `catalog-browser.tsx`
derives its state from the shared helper. Correct
`openplc-packages/docs/package-format.md:69` — it becomes true.
_Repos: editor + web · ~1 day._

**Phase 3 — `minRuntimeVersion` in the manifest.** Add the field to
`schema/manifest.schema.json`, conditionally required when any device targets
`runtime-v4`; enforce in `scripts/validate.ts` so a malformed package never
reaches a user; check it in the compile pipeline against the connected runtime.
_Repos: packages + editor + web · ~1 day._

**Phase 4 — `GET /api/capabilities`.** New unauthenticated endpoint returning
`runtimeVersion` + `minEditorVersion`, with the constant living beside
`RUNTIME_VERSION` in `webserver/version.py`.
_Repo: runtime · ~half a day._

**Phase 5 — editor consumes it.** `probe-runtime-version.ts` reads the endpoint,
treats `404` as "declares nothing", and blocks upload when
`APP_VERSION < minEditorVersion`. Rename `MIN_STRUCPP_RUNTIME_VERSION` to
`MIN_RUNTIME_VERSION` (keeping the old name as an alias) so the global reads as
what it is.
_Repos: editor + web · ~1 day._

**Phase 6 — tests.** Table of `(editorVersion, runtimeVersion, vppManifest) →
allow | block | warn` covering each of the four comparisons plus the
declares-nothing and unparseable rows.
_Repos: editor + web · ~half a day._

Total: **~4,5 days**.

## 9. Explicitly out of scope

Considered and dropped, so nobody re-derives them:

- **Monotonic integer contracts** (`PROGRAM_CONTRACT_VERSION` and friends).
  Would decouple the release trains and isolate a debug-protocol change from the
  upload path, at the cost of a second versioning concept to maintain. Human
  semver is the agreed key.
- **`bundle-manifest.json` inside the upload ZIP.** Not needed once the runtime
  publishes its floor and the editor compares locally.
- **Editor→runtime advertising handshake** (`/api/adv` or similar). Decided
  against: the editor validates.
- **`maxEditorVersion` / `maxRuntimeVersion`.** An upper bound pointing at
  releases that do not exist yet is unknowable — any value either blocks
  compatible future peers or does nothing.

## 10. Open questions

1. **What value does the runtime publish as `minEditorVersion` today?** Needs a
   concrete audit of when the current bundle layout stabilised. Publishing a
   floor that is too high locks out working editors; too low makes the field
   decorative. Safest start is the oldest editor known to work with the strucpp
   pipeline.
2. **Does an installed-but-incompatible VPP get hidden or shown-as-unusable?**
   Hiding is cleaner; showing explains why a board disappeared after an editor
   downgrade.
3. **Warning surface for peers that declare nothing** (§6) — console only, or a
   one-time notice in the UI?
