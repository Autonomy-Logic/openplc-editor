# A cloud project writing into the working directory

How the EtherCAT ESI repository ended up inside the git checkout, what it cost,
and why the fix does not reuse the scratch directory built for compilation.

Found on 2026-09-17 during an exploratory QA pass over the cloud-project feature
(openplc-editor#1056 / openplc-web#711), driving the app against
`api-staging.autonomylogic.com`.

---

## 1. The defect

A cloud project is addressed by its Autonomy Edge id, not by a directory.
`ProjectMeta.path` for one is a bare string like `cmu37i2a503br06juf5gim9ub`, and
`isRemoteProjectPath` (`middleware/shared/ports/types.ts`) is defined as
"this identifier is not an absolute path" — that is what the whole cloud feature
keys off.

`ESIService.getEsiDir` joined straight onto it:

```ts
// src/backend/editor/ethercat/esi-service.ts, before
private getEsiDir(projectPath: string): string {
  const basePath = basename(projectPath) === 'project.json' ? dirname(projectPath) : projectPath
  return join(basePath, this.ESI_DIR)   // ESI_DIR = 'devices/esi'
}
```

For a project on disk `basePath` is absolute and this is correct. For a cloud
project it is `join('cmu37i2a503br06juf5gim9ub', 'devices/esi')` — a **relative**
path, which Node resolves against `process.cwd()`.

The reachable user path is Remote Devices → an EtherCAT device → upload an ESI
file. `esi-adapter.ts:62` passes `projectPath` through unchanged to
`bridge.esiParseAndSaveFile`, which reaches `ensureEsiDir` → `mkdir` and then
writes `repository.json` and one XML per uploaded file.

### What it costs

- **In development**, `cwd` is the repository root, so uploading an ESI file
  creates `<repo>/<edge-project-id>/devices/esi/` inside the git checkout.
- **Packaged**, `cwd` is wherever the app was launched from. Opened from the
  Finder on macOS that is `/`, so the write either fails on permissions or lands
  somewhere arbitrary. The failure is not consistent, which is worse than being
  consistently blocked.

This is the same defect class as the compile pipeline writing `build/` into the
working directory, fixed separately in `cloud-build-workspace.ts`. That fix
covered the compiler's two entry points and the two debug-map readers; it did not
cover ESI, which reaches disk through its own service.

---

## 2. How it was found, step by step

The pass targeted one question: **which features assume a real directory, and what
do they do when the project's path is an id?**

1. Read every place that derives a filesystem path from `projectPath` outside the
   compiler. Two candidates: `esi-service.ts` (writes) and
   `desktop-library-build-port.ts` (reads project sources, so it degrades rather
   than polluting).
2. Started the editor against staging, signed in, opened the cloud project
   `E2E Round5`, and confirmed it really was a cloud project — the Source Control
   panel is gated on `isRemoteProjectPath`, so its presence is the check.
3. Recorded the repository root: no directory matching an Edge id.
4. Called `bridge.esiSaveXmlFile` with the project's id. A directory appeared in
   the repository root. `git status` reported nothing, because `mkdir` alone
   leaves no tracked file.
5. Re-ran it through `bridge.esiParseAndSaveFile` — the call the upload screen
   actually makes — with a real ESI XML, which produced files rather than empty
   directories:

```
<repo>/cmu37i2a503br06juf5gim9ub/devices/esi/repository.json                  649 bytes
<repo>/cmu37i2a503br06juf5gim9ub/devices/esi/e3652273-…-463745a9987d.xml      358 bytes
```

With real files, `git status` **does** show it (`?? cmu37i2a503br06juf5gim9ub/`).
An earlier note in this investigation said the opposite; that was generalised
from the empty-directory case and is corrected here.

### What could not be driven

Creating the EtherCAT device through the UI needs the Remote Device submenu,
a Radix submenu that does not open under synthetic pointer or keyboard events.
The reproduction therefore invokes the same bridge call
`esi-adapter.ts:62` makes, with the project path the adapter would supply. The
service code under test is identical; only the click that reaches it is not.

---

## 3. The fix

Two files, plus tests.

### 3.1 A second scratch root, deliberately not the build one

```ts
// src/backend/editor/project/cloud-project-data.ts  (new)
export function cloudProjectDataRoot(): string {
  return join(app.getPath('userData'), 'cloud-projects')
}

export function resolveProjectDataDir(projectPath: string): string {
  if (projectPath.length > 0 && isAbsolute(projectPath)) {
    return projectPath
  }
  return join(cloudProjectDataRoot(), segmentFor(projectPath))
}
```

**Why not reuse `resolveBuildWorkspace`.** That was the obvious move and it would
have introduced a worse bug. `cloud-build-workspace` is emptied at every boot
(`clearCloudBuildRoot`, called from `app.whenReady`), which is correct for build
output: the cloud is the source of truth and the artifacts are regenerable.

ESI is neither. Checked before writing any code:

- `esi` appears nowhere in `backend/shared/project/api-envelope.ts`, so the ESI
  repository is not part of what a cloud project stores.
- It appears nowhere in `edge-projects/index.ts` or in the upload snapshot, so it
  never travels to Edge by another route.

The files are uploaded by hand and exist only on this machine. Putting them under
the boot-wiped root would have deleted the user's ESI repository on every
restart — trading a misplaced write for silent data loss. Hence a separate,
persistent root.

The two roots are asserted to be different in the tests, so a later refactor
cannot quietly merge them.

### 3.2 An absolute path is returned unchanged

`resolveProjectDataDir` is a no-op for a project on disk. A local project keeps
its ESI files beside its sources, where the user can find them and where they
travel with the project folder. Only the case that had nowhere valid to write is
redirected.

### 3.3 The id becomes one safe path segment

```ts
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,120}$/
function segmentFor(projectId: string): string {
  return SAFE_SEGMENT.test(projectId) ? projectId : createHash('sha256').update(projectId).digest('hex').slice(0, 32)
}
```

An Edge id is already safe, so the common case reads as itself under
`~/Library/Application Support/open-plc-editor/cloud-projects/<id>/`. Anything
else is hashed, so no value of `projectPath` can escape the root with `..` or a
separator. A test asserts this for `../../etc`, `a/b`, `..`, `.` and `x\y`.

This duplicates `segmentFor` from `cloud-build-workspace.ts`. Sharing it would
couple a persistent root to a wiped one for four lines; the duplication is
deliberate and the tests pin both.

### 3.4 The call site

```ts
// src/backend/editor/ethercat/esi-service.ts
private getEsiDir(projectPath: string): string {
  const basePath = basename(projectPath) === 'project.json' ? dirname(projectPath) : projectPath
  // A cloud project is an Edge id, not a directory: joining on it directly wrote
  // the repository into `process.cwd()`. ESI is never part of the project
  // envelope, so its copy has to outlive a restart on this machine.
  return join(resolveProjectDataDir(basePath), this.ESI_DIR)
}
```

One line of behaviour. Every other ESI path (`getRepositoryPath`, `getXmlPath`,
`ensureEsiDir`) is derived from `getEsiDir`, so they all follow from this. The
existing `project.json` trimming and the UUID check in `getXmlPath` are untouched.

---

## 4. Verification, step by step

Run from a fully cold start, to rule out a stale bundle — the first attempt at
the `build/` fix appeared to fail for exactly that reason.

1. Killed every `electronmon`, Electron and `webpack serve` process; confirmed
   ports 1313 and 9222 free.
2. Deleted `configs/dll`, `node_modules/.cache`, and the Electron `Cache`,
   `Code Cache` and `GPUCache` directories under `userData`.
3. Rebuilt the DLL cache and the main bundle, and confirmed the new bundle
   contains the fix (`grep -c "cloud-projects" configs/dll/main.js` → 1).
4. Started the renderer and Electron against `api-staging`, opened the cloud
   project, and recorded the starting state: repository root clean,
   `userData/cloud-projects` absent.
5. Performed the same upload as in §2.

**Result**

| Check           | Outcome                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| Repository root | clean, nothing written                                                    |
| ESI files       | `~userData/cloud-projects/<id>/devices/esi/{repository.json, <uuid>.xml}` |
| `git status`    | no untracked project directory                                            |

6. Repeated the upload against a **local** project
   (`~/www/autonomy-logic/workshop/E2E-Round5`). The files landed in
   `<project>/devices/esi/`, beside the sources, and nothing appeared under
   `userData` for it — the no-op branch behaves.
7. Restarted the app and checked both roots:
   - `cloud-projects/<id>/devices/esi/repository.json` — **still there**, which is
     the property that ruled out reusing the build root.
   - `cloud-builds` — **empty**, as designed.

**Gates**: 453 suites / 9,473 tests (5 new), ESLint clean, `validate:arch` clean,
`compare-surfaces.py` at `total_diffs: 0`. Nothing here touches the shared
surface; all three files are editor-only.

---

## 5. Still open, same defect class

Named so they are not rediscovered one at a time. Each derives a path from
`projectPath` and is wrong for a cloud project:

| Site                                                          | Effect                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compiler-module.ts:3545` `compileLibrary`                    | reads `library.json` and writes `build/*.stlib` relative to `cwd`                                                                                    |
| `desktop-library-build-port.ts:118`                           | same, plus an `fs.rm` of the build subtree                                                                                                           |
| `compiler-module.ts:2975`, `:3068`, `:3096`, `:2235`, `:2258` | read pin mapping, VPP screen data and retention config; all return empty for a cloud project, so the firmware is built without IO and without Modbus |
| `compiler-module.ts:1959` `createXmlFile`                     | the export dialog's `defaultPath` is relative, so it opens in the wrong folder                                                                       |

The reads degrade silently rather than polluting the filesystem, which makes them
harder to notice and, for the firmware ones, more damaging. They are not fixed
here.

---

## 6. Files changed

| File                                                              | Change                                             |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `src/backend/editor/project/cloud-project-data.ts`                | new — persistent per-project root                  |
| `src/backend/editor/project/__tests__/cloud-project-data.test.ts` | new — 5 cases                                      |
| `src/backend/editor/ethercat/esi-service.ts`                      | `getEsiDir` routes through `resolveProjectDataDir` |
