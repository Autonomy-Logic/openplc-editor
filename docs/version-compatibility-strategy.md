# Editor + Runtime + VPP Version Compatibility — Strategy

> Status: **agreed design, implemented** (Marcone + Thiago Alves, 2026-08-05)
> Jira: [DOPE-448](https://autonomylogic.atlassian.net/browse/DOPE-448) (epic DOPE-317 — VPP in the Editor)
> Scope: `openplc-editor` + `openplc-web` (shared surface — byte-identical),
> `openplc-runtime`, `openplc-packages`
> Shipped in: openplc-editor#993 · openplc-runtime#163 · openplc-packages#28 ·
> openplc-web#652 — see §8 for what each one covers.

**Reading this later:** §1 is the design and stays true. **§2 is a snapshot of
the state _before_ this work, dated 2026-08-05** — it describes gaps the PRs
above have since closed, and is kept because the reasoning only makes sense
against what it was fixing. §8 marks what landed. Do not read §2 as a to-do
list.

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

## 2. What was missing, per declaration — baseline as of 2026-08-05

_Historical. Every gap below is closed by the PRs listed at the top; §8 says
which. Kept verbatim because the design decisions in §1 and §3 only make sense
against the state they were correcting._

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

At the time of writing there was no endpoint where the runtime stated what it
needs from an editor, and `handle_upload_file` accepted any ZIP that passed
`analyze_zip` (path traversal, size, ZIP-bomb ratio, denylisted executable
extensions). `GET /api/capabilities` (§3.1) closes this in openplc-runtime#163;
the upload path itself is deliberately left untouched — see §7.

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

Nothing is sent. This is the "and vice-versa" direction from the card — the one
that had no enforcement at all before this work.

**Legacy runtime** — `GET /api/capabilities` fails. In practice with **401**,
not 404: the runtime's `restapi.py` ends in a
`@restapi_bp.route("/<command>")` catch-all behind `@jwt_required()`, so an
unknown path under `/api/` falls into it and comes back "Missing Authorization
Header". Verified against a real pre-change container. The probe treats any
unreadable answer the same way, so both shapes fall back identically:

```
GET /api/capabilities  →  401 (or 404)
GET /api/version       →  {"version": "v4.1.7"}

runtime declares no floor         → nothing to check in that direction
runtime 4.1.7 >= MIN_RUNTIME_VERSION (4.1.0)?  yes  → upload proceeds
user-management needs 4.1.9?      no  → screen hidden
```

Identical to the previous behaviour. The fallback is deliberately **silent** —
that 401 is the normal answer from every runtime already deployed, so warning on
it would nag on every upload.

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

| Check                              | Gate                                                              | Failure surface                       |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| runtime new enough for this editor | `probe-runtime-version.ts` + `MIN_RUNTIME_VERSION`                | upload blocked pre-compile            |
| editor new enough for this runtime | `probe-runtime-version.ts` + `minEditorVersion` from the endpoint | upload blocked pre-compile            |
| editor new enough for this VPP     | `package-manager-module.ts::install`                              | install rejected, both versions named |
| runtime new enough for this VPP    | compile pipeline, `runtime-v4` targets                            | compile blocked                       |
| per-feature runtime capability     | existing predicates in `runtime-version-gate.ts`                  | UI surface hidden                     |

Every row is decided in the editor. The runtime and the VPP only declare.

**Not covered: an already-installed package after an editor downgrade.** The
gate runs at install, so a package installed under 4.3 keeps loading on 4.2.
Re-checking on load would close it — see §10 for why it is still open.

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

| Peer state                                               | Behaviour as implemented                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Runtime without `/api/capabilities`                      | no editor floor to check; `MIN_RUNTIME_VERSION` gate still applies; **silent** — see below     |
| Runtime version unreadable (`"dev"`, junk)               | fail closed — previous behaviour, unchanged                                                    |
| Runtime declares a partial floor (`"4.3"`, `"4"`)        | enforced as `4.3.0` / `4.0.0` — a missing component is zero everywhere                         |
| Runtime declares an _unreadable_ floor (junk)            | floor ignored, upload proceeds, **warning logged** to the compile console                      |
| VPP without `minRuntimeVersion` on a `runtime-v4` target | install allowed, runtime match unverifiable, no warning; blocked at package build time instead |
| VPP with an _unreadable_ floor                           | manifest rejected at install — the schema refuses a floor it cannot parse                      |

The first row is silent **on purpose**: a runtime with no `/api/capabilities` is
every device currently deployed, so warning there would fire on every upload from
every editor. The fourth row is different — a floor that is present but malformed
is a mistake someone made, and swallowing it means a constraint the runtime
believes it is enforcing silently is not. That one now warns.

Note the third row: `"4.3"` is **not** an unreadable floor. A missing component
is zero throughout the codebase, so a hand-written shorthand is enforced exactly
as its zero-filled equivalent. Only genuine junk reaches the fourth row, which is
why refusing it in a manifest costs nothing.

Because the runtime never enforces, no closing window is needed on the upload
path: an old runtime simply contributes no constraint. Making `minRuntimeVersion`
mandatory for `runtime-v4` packages already ships, enforced at **package build
time** (`scripts/validate.ts`), so it never breaks an installed package. The
remaining gap is install-time enforcement for sideloaded packages, which never
pass through that validator — see §10.

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

## 8. Delivery — what landed where

**All six phases are implemented.** There was deliberately no ordering
constraint between them: the runtime never blocks, so a phase shipping early
cannot break a peer.

| #   | Phase                               | Repos             | Landed in                                |
| --- | ----------------------------------- | ----------------- | ---------------------------------------- |
| 1   | One semver parser                   | editor + web      | openplc-editor#993 · openplc-web#652     |
| 2   | VPP install gate                    | editor + web      | openplc-editor#993 · openplc-web#652     |
| 3   | `minRuntimeVersion` in the manifest | packages + editor | openplc-packages#28 · openplc-editor#993 |
| 4   | `GET /api/capabilities`             | runtime           | openplc-runtime#163                      |
| 5   | Editor consumes the endpoint        | editor + web      | openplc-editor#993 · openplc-web#652     |
| 6   | Tests                               | editor + web      | openplc-editor#993 · openplc-web#652     |

**Phase 1 — one semver parser.** `frontend/utils/semver.ts` owns the parse and
the ordering; `parseRuntimeVersion` and `compareSemver` are thin wrappers over
it. It lives in `frontend/utils/` rather than `backend/shared/` because the layer
rules allow `backend-shared → utils` and not the reverse.

The first cut of this kept _two_ parsers — a strict one and a lenient one, chosen
by name at the call site — which review showed was still one too many: the same
string meant different things depending on which a caller reached for, and that
is the defect the phase existed to remove (see §10 items 3 and 6). There is now
exactly one `parseVersion`, applying one rule: a `v` prefix is decoration, a
missing component is zero, anything else is UNKNOWN (`null`). Unknown never
becomes `0.0.0` behind a caller's back, so a gate can still distinguish "I cannot
read this" from "this is old" and fail closed on the first. The one place a total
order is genuinely required — sorting catalog rows — coerces unknown to `0.0.0`
explicitly, inside `compareSemver`, where nothing is gated on the result.

Consequence worth recording: the legacy `"v4"` header now parses as `4.0.0`
instead of being rejected as unreadable. No gate's answer changes — `4.0.0` is
below `MIN_RUNTIME_VERSION` either way — but it is refused because it is old,
not because the string looked odd.

**Phase 2 — VPP install gate.** `package-manager-module.ts::install` compares
`minEditorVersion` against `APP_VERSION`, next to the signature verification, so
one gate covers both the catalog and the "Add from file…" path.
`openplc-packages/docs/package-format.md:69` is now true. Reading an installed
package's manifest back off disk goes through `parseInstalledPackageManifest`
instead, which tolerates a floor it cannot compare — see §10 item 4.

**Phase 3 — `minRuntimeVersion` in the manifest.** Field added to the schema,
conditionally required when any device targets `runtime-v4` and rejected
otherwise, enforced in `scripts/validate.ts`; compared in the compile pipeline
against the connected runtime.

**Phase 4 — `GET /api/capabilities`.** Unauthenticated endpoint returning
`runtimeVersion` + `minEditorVersion`, constant beside `RUNTIME_VERSION` in
`webserver/version.py`.

**Phase 5 — editor consumes it.** `probe-runtime-version.ts` prefers the
endpoint and falls back to `/api/version`. Note the correction to the original
plan: a runtime predating the endpoint answers **401**, not 404 — its
`restapi.py` ends in a `@restapi_bp.route("/<command>")` catch-all behind
`@jwt_required()`, so an unknown path lands there. Verified against a real
pre-change container. The probe therefore keys off "can I read a version out of
this answer" rather than off a status code, and covers both shapes.
`MIN_STRUCPP_RUNTIME_VERSION` renamed to `MIN_RUNTIME_VERSION`, old name kept as
an alias.

**Phase 6 — tests.** Automated coverage of all four comparisons plus the
declares-nothing and unparseable rows. Also verified manually end-to-end with
negative controls, including against a real Raspberry Pi reporting `v4.1.9`.

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

## 10. Open questions and known gaps

**Decided**

1. ~~**What value does the runtime publish as `minEditorVersion`?**~~ →
   **`4.1.0`**, set in `webserver/version.py`. That is where the STruC++
   pipeline landed, so it locks out nobody who works today; 4.0.x editors
   emitted MatIEC artefacts the runtime cannot build at all. The rule for
   raising it is stated on the constant itself: only when an older editor
   genuinely produces a bundle this runtime would mis-compile. It is not a build
   counter.
2. ~~**Warning surface for a runtime that declares nothing?**~~ → **silent**, for
   the reason in §6: that is every deployed device.

3. ~~**An unreadable floor is discarded with no signal.**~~ → **fixed**
   (openplc-editor#993 · openplc-web#652). Two halves. The one that mattered in
   practice was that `"4.2"` was not "unreadable" in one gate and was in another:
   the install gate honoured it as 4.2.0 while `isVersionAtLeast` dropped it. A
   missing component is now zero everywhere, so a partial floor is enforced
   exactly as its zero-filled equivalent, and `isCompatibleEditorVersion`
   delegates to `isVersionAtLeast` so the two gates cannot disagree at all. What
   remains genuinely unreadable is junk, and `probe-runtime-version.ts` logs a
   warning when a runtime publishes it. The upload still proceeds — refusing a
   device over a typo in its metadata would be worse — but a constraint the
   runtime believes it is enforcing can no longer go missing in silence.
4. ~~**A malformed floor in a VPP manifest becomes "no floor".**~~ → **fixed**
   (openplc-editor#993 · openplc-web#652). `package-manifest-schema.ts` refuses a
   `minEditorVersion` / `minRuntimeVersion` it cannot parse, naming the field in
   the error. As predicted, the cost is nil: `"4.3"`, `"4"`, `"v5"` and
   pre-release suffixes all pass, so only genuine junk changes behaviour. This is
   the only boundary a sideloaded `.vpp` crosses, which is the entry path the
   install gate exists for.

   Second-order effect, raised in re-review and fixed with it: the same schema is
   also used to read the `manifest.json` of an **already-installed** package, so
   the new format rule would have made a package installed before this change —
   carrying a floor only genuine junk could produce — stop resolving on load, and
   its boards disappear from the board lookup with no message, on an upgrade
   where the user did nothing. The rule is therefore strict where the artefact
   **enters** and tolerant where we are only **reading** what is already on disk:
   `parseInstalledPackageManifest` drops an uncomparable floor and logs it, the
   install path still refuses it. Dropping costs nothing that was not already
   lost — an unreadable floor never gated anything — and refusing stays where
   refusing belongs.

5. ~~**Hand-rolled comparators remain**~~ → **fixed** (openplc-editor#993 ·
   openplc-web#652). `isStrucppCompatibleRuntime` and
   `isUserManagementCapableRuntime` are now `isVersionAtLeast(raw, <constant>)`.
   (The item said "three" and named two — there were two.) The equivalence was
   verified exhaustively before the swap, but the reason to do it turned out to
   be sharper than duplication: the hand-rolled bodies hardcoded the _shape_ of
   the constant beside them. `return v.minor >= 1` is correct only because the
   floor ends in `.0`; raise `MIN_RUNTIME_VERSION` to `4.1.5` and it keeps
   admitting 4.1.0 while every behavioural test still passes, because those tests
   were written against the old floor too. Guard tests now derive their
   expectations from the constants, so a re-inlined comparison fails immediately.

**Still open**

5. **An installed-but-incompatible VPP keeps loading after an editor downgrade**
   (§4). Re-checking `minEditorVersion` on load would close it. Open sub-question
   if we do: hide the package, or show it as unusable? Hiding is cleaner; showing
   explains why a board disappeared.
6. **`minRuntimeVersion` is not enforced at install time for sideloaded
   packages.** `scripts/validate.ts` requires it for `runtime-v4` packages at
   authoring time, and the compile pipeline compares it against the connected
   runtime — but a `.vpp` added from disk declaring no floor installs and only
   fails later, at compile. Lower priority than 5: the compile-time gate catches
   the mismatch before anything reaches a device.

Items 3–6 were raised in review of openplc-editor#993; 3, 4 and 6 were fixed in
the same PR (mirrored in openplc-web#652, both on shared-surface files). Item 7
was split out of CodeRabbit's read of §6. Items 5 and 7 need their own tickets.
