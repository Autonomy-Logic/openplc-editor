# Release hardening

How a packaged OpenPLC Editor protects the package trust decision, how CI builds and checks it, and how the
installers of a published release are rebuilt. Four parts work together:

- **Electron fuses** stop code from running inside the editor through its own executable.
- **The trust anchor** is a module generated per build that checks every package decision of the desktop editor.
- **`release.yml`** builds every new release from a tag in release mode and checks what it built.
- **`rebuild-release.yml`** rebuilds and replaces the installers of a release that is already published.

## Electron fuses

`electronFuses` in `electron-builder.json` sets five fuses on every packaged build:

| Fuse                                    | Value | Effect                                                    |
| --------------------------------------- | ----- | --------------------------------------------------------- |
| `runAsNode`                             | off   | `ELECTRON_RUN_AS_NODE` does not turn the editor into Node |
| `enableNodeOptionsEnvironmentVariable`  | off   | `NODE_OPTIONS` (`--require`, for example) is ignored      |
| `enableNodeCliInspectArguments`         | off   | `--inspect`, `--inspect-brk` and SIGUSR1 open no debugger |
| `enableEmbeddedAsarIntegrityValidation` | on    | a modified `app.asar` stops the editor at start           |
| `onlyLoadAppFromAsar`                   | on    | an `app` folder next to `app.asar` is never loaded        |

`resetAdHocDarwinSignature: true` is a sixth key of the same block. Writing the fuses changes the Electron
binary, which breaks the signature Electron ships with, so a macOS build made without a signing identity (a local
`npm run package` on Apple silicon) would be killed at load with "Code Signature Invalid". The key re-signs the app
ad hoc right after the fuses are written; it changes no fuse. macOS release builds are signed with Developer ID
afterwards.

Side effects:

- **`NODE_EXTRA_CA_CERTS` is ignored by the main process** of a packaged build: the `NODE_OPTIONS` fuse turns it off
  too. A proxy that needs an extra certificate authority cannot be added that way.
- **No `--inspect` on a release build.** Debug the main process in `npm run dev`, or on a `npm run package:test`
  build.
- **Worker threads.** The clang, simulator and Python workers are started with `new Worker(script)` from the main
  process (`src/backend/editor/wasm-toolchain/`, `simulator/`, `python/`). They pass no `execArgv` and read no
  `NODE_OPTIONS`, so the fuses change nothing in how they start. The packaged checks below do not start them; Play on a
  packaged build is part of the manual test.
- **A tampered `app.asar` terminates the editor at start.** On macOS, a repacked archive (its header hash no longer
  matches the one recorded in the app's `Info.plist`) ends the process with SIGTRAP and
  `FATAL ... Integrity check failed for asar archive`. A byte edited in place in a `dist/main` script ends it with exit
  code 1 and `ASAR Integrity Violation: got a hash mismatch`. A test of this expects either: a non-zero exit code or a
  signal.

### Test-only packaging

`npm run package:test` runs the same steps as `npm run package` with `OPENPLC_TEST_PACKAGE=1` set for every step, and
turns only the inspect fuse back on (`-c.electronFuses.enableNodeCliInspectArguments=true`). Playwright's
`_electron.launch` needs the inspect arguments, so it can drive a packaged build only when it comes from
`package:test`, given through `E2E_PACKAGED_APP`. A release build is checked by spawning it
(`scripts/release/packaged-checks.mjs`). No workflow may name `package:test` or `OPENPLC_TEST_PACKAGE`
(`src/__tests__/electron-fuses-config.test.ts` checks every workflow file), and a release-mode build refuses to run
when `OPENPLC_TEST_PACKAGE` is set.

## The trust anchor

The desktop editor installs a VPP package only when it is signed by a trusted key
(`src/backend/shared/utils/vpp/trusted-keys.ts`). Before the trust anchor, the decision read that key map directly and the
bundle carried the key as PEM text, so one edit of the bundle could add a key. The trust anchor puts a module
generated per build in front of every decision.

### Contract

`src/backend/editor/package-trust/types.ts`:

- `VerifyTrustedPackage = (packageDir, atImport) => TrustVerdict` checks the package in `packageDir` at import
  (`atImport` true) or at use (false): the startup sweep, the rejection reason and the pre-build gate, in the GUI and in
  the CLI.
- `TrustVerdict` is positional: `[true, packageId, version]`, the verified identity read from the signed
  `signature.json` payload, when every check passed, and `[false, reason]` otherwise.
- `TRUST_REFUSAL` (`Package trust check failed`) is the reason of every refusal of the module's own checks; it names
  no check.

The generated module exports one binding, `export default <name>`, under a name chosen by the seed: no other export,
no exported object and no method or property name of the trust path. `index.ts` re-exports it as
`verifyTrustedPackage`, a local binding that the production build renames. The module imports at runtime only
`node:crypto`, `node:fs`, `node:path` and `verifyPackageSignature` from the shared verifier, from
`../../shared/utils/vpp/verify-package-signature` in the committed module and from
`../../src/backend/shared/utils/vpp/verify-package-signature` in a module placed in `release/package-trust/`.

The anchor is desktop-only: it is an exception to the thin-adapter rule, recorded in `CLAUDE.md`, and openplc-web is
not changed.

### One call

1. Build a fresh `keyId -> PEM` map from the module's encoded shares, with no prototype, so a key id such as
   `constructor` resolves to nothing. No key map leaves the call.
2. Call the shared verifier (`verifyPackageSignature`) once with that map. When it refuses, return its reason (for
   example `Untrusted signing key: <key id>`): its refusal reasons keep leading.
3. Run the hook's reader canary, then read the package once with the hook's own reader: a walk that refuses any entry
   that is neither a regular file nor a directory, a safe-path check, the sha256 of every file but `signature.json`,
   and both `signature.json` and `manifest.json` parsed.
4. Run every check site bound to the hook, each once, on that read.
5. When every site passed, return `[true, packageId, version]`; on any failure, `[false, 'Package trust check failed']`.

### Check sites

The generated module binds two to four check sites to each hook, in an order and under neutral function names chosen
by the seed. Each site holds its own copy of every check, emitted from variants chosen by the seed, and calls none of
the shared helpers (`canonicalize`, `parseSignatureFile`, `verifyFileSet`, `verifyManifestIdentity`): stubbing a shared
function no longer disables a check. On the read, a site:

- parses the signature document and builds the canonical JSON of the payload (recursive or with an explicit stack);
- verifies the Ed25519 signature against the key it recombines from its own shares: the signature's key id only picks
  among those keys, and a key id alone never decides (M3);
- compares the files with the signed file list (same count, every file signed with an equal hash, no unsigned file;
  iterated one way or the other, or as sorted pairs) and the manifest's `package.id` and `package.version` with the
  signed identity (M14).

Before the package, each site runs its canaries (M12), in an order chosen by the seed:

- **Ed25519:** a known-invalid signature must fail under the recombined trusted key, and a known-valid signature under
  a throwaway key derived from the seed must pass.
- **sha256:** seeded bytes must hash to an embedded digest, which catches a stubbed `createHash`.
- **Check canary:** the site's own canonical JSON, file-set and manifest code runs on two encoded synthetic cases. The
  matching one must pass; the mismatching one, with a changed hash, an extra or a missing file, another manifest id or
  version, or a payload text whose keys are out of canonical order, must fail.

Each hook also has a **reader canary**: before it reads the package, its reader reads a seeded in-memory tree, and the
result must equal an embedded snapshot. A canary that fails refuses the package.

Each site holds the key and its check-canary cases as shares in its own encoding (an alphabet, base 16 or 32, combined
by XOR or by addition), so the PEM text, its base64 body, the raw key bytes and the key id appear nowhere in the bundle.

### Call sites (O1)

`PackageManagerModule` (`src/backend/editor/package-manager/package-manager-module.ts`) takes a
`VerifyTrustedPackage` as its constructor parameter, `verifyTrustedPackage` by default, and keeps it in a module-local
`WeakMap`, so no field or property name holds it. Each call site needs the verified identity that only a passing check
returns:

- **Import:** the import fails, nothing is installed and the temporary folder is removed, when the call throws, its
  answer is not an array, its first element is not `true`, or its identity is not the manifest's `package.id` and
  `package.version`. The error is `Package signature verification failed: <reason>`. The package is installed under
  the verified id, and the registry records the verified version.
- **Use:** the installed package is refused when the call throws, its answer does not pass, or the verified id is not
  the registry id.

A call patched to return `null` or `undefined`, or to throw, therefore refuses the package instead of trusting it.

### Fingerprint

`scripts/package-trust/fingerprint.ts` (`checkFingerprint(source, keys)`) loads a generated module with a recording
`node:crypto`, a recording shared verifier that accepts everything, and an in-memory package whose signature cannot
verify. Every key of the map handed to the shared verifier, and every key a failing verify call used, must be one of
`keys`; each hook must make at least two failing checks under expected keys, and both hooks must refuse the package.
Every CLI command that writes or places a module runs it and fails on a mismatch (M11).

`scripts/package-trust/load-module.ts` (`loadTrustModule(source, imports)`) evaluates a module in a fresh `vm` context
whose `require` resolves only the specifiers given in `imports`, each to the object given; any other import throws,
naming it.

### Generator and seed

`scripts/package-trust/generator.ts` (`generatePackageTrustModule`) writes the module and its layout (the name of the
entry point, the check sites with the share literals of each site's check-canary cases, and the exact text of every
share literal) from a 32-byte seed. The same seed and keys always give the same module.
The first line of a module names its mode: `from the development seed`, or `for release <version> at commit <sha>`.
`shareLiteralsFromSource(source)` reads the share literals back from a module's source with the TypeScript parser,
without evaluating it: the string literals of every array passed to one of the module's top-level decoders.

- **Release seed:** `deriveReleaseSeed(secret, version, commit)`, HMAC-SHA256 keyed by the secret over
  `<version>+<commit>`. The secret is the GitHub Actions secret `TRUST_SEED_SECRET` (64 hexadecimal characters) of the
  Environment `release-trust`. No seed is stored: CI derives it again for any rebuild, and without the secret it cannot
  be predicted. A byte-exact patch written for one release fits no other; a structural patch can (see "Limits and
  accepted residuals").
- **Development seed:** `DEVELOPMENT_SEED` in `generator.ts`, fixed and public. Every build that is not a release uses
  it, so a development build gives no protection against a patch made for it.
- **Cross-seed probe:** `CROSS_SEED_PROBE` in `generator.ts`, fixed and public, used only by `cross-seed-check`.
- **The committed module** `src/backend/editor/package-trust/package-trust-anchor.ts` is the development module.
  Regenerate it after a change to the generator or to `trusted-keys.ts`:
  `npx ts-node --transpile-only scripts/package-trust/cli.ts write-fallback`.

### Build modes

`npm run build:main` runs `scripts/package-trust/cli.ts prepare`, then webpack, then `cli.ts verify-bundle`. Webpack
replaces the committed module with the one `prepare` placed in `release/package-trust/` (git-ignored), and resolves
the placed module's imports from that folder. Neither
`prepare` nor `verify-bundle` reads `layout.json`: both take the share literals from the module itself
(`shareLiteralsFromSource`), so a `layout.json` beside the module, absent, stale or malformed, changes nothing.

| `OPENPLC_RELEASE_BUILD` | Mode        | `prepare`                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unset or empty          | development | Places the development module and its layout. Fails when `GITHUB_REF` is a `refs/tags/v*` tag: a tag build must be in release mode.                                                                                                                                                                                                                                                                            |
| `1`                     | release     | Places nothing: requires only the module `generate-release` wrote in `release/package-trust/`, as the `trust-module` artifact delivers it. Fails when `OPENPLC_TEST_PACKAGE` is set, when the module is not a release module, when its version differs from `release/app/package.json` or its commit from `HEAD`, on a fingerprint mismatch, or, after the fingerprint, when the module has no share literals. |
| any other value         | (none)      | Fails, naming the variable.                                                                                                                                                                                                                                                                                                                                                                                    |

`verify-bundle` reads `release/app/dist/main/main.js` and every other `.js` beside it (the module lands in a chunk) and
fails when the placed module has no share literal or when any of them is missing. In release mode it also fails when
the bundle holds a share literal of the development module, generated in memory. In both modes it fails, naming the
name and the file, when any file holds a fixed name of the earlier trust path (`FORBIDDEN_TRUST_NAMES` in `cli.ts`):

- `checkAtImport`, `checkAtUse`, `trustedKeys`, `verifyEd25519` and `readSnapshot`, each as a whole identifier, so
  `trustedKeysJson` of the licensing code does not count;
- `verifyFileSet:` and `verifyManifestIdentity:` as object keys; the shared verifier's calls `verifyFileSet(` and
  `verifyManifestIdentity(` pass;
- `.anchor.` read through `this` (`this.anchor.`), so the debugger's `anchor` field does not count.

`cross-seed-check [--root <repo>]` builds the main bundle twice with the production webpack configuration, once with
the module of `DEVELOPMENT_SEED` and once with the module of `CROSS_SEED_PROBE`, both in development mode and never with
the secret. It passes only when:

- the import call site and the use call site are found in both bundles, by the fixed text beside them
  (`Package signature verification failed` and `registry entry has no package path`);
- each call site's minified tokens, within 500 characters of that text, differ between the two bundles;
- neither bundle holds a fixed trust name;
- each bundle holds every share literal of its own module.

It prints a pass or the failed checks, never a seed, and puts `release/package-trust/` and `release/app/dist/main/`
back as they were. The call sites differ because the minifier names identifiers by the character frequency of the
chunk, which the seeded module changes; the check fails a tree where the trust module and `PackageManagerModule` stop
sharing a chunk.

`generate-release --version <v> --commit <sha> --out <file>` writes a release module and its `layout.json`. It reads
the secret from `OPENPLC_TRUST_SEED_SECRET` and fails, writing nothing, when it is absent or is not 64 hexadecimal
characters. The `layout.json` serves only the `trust-module` job's check-site test
(`OPENPLC_TRUST_MODULE_UNDER_TEST`): it is never uploaded, and no build step reads it.

### Environment variables

| Variable                          | Set by                                   | Read by                                                                                                                                     |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENPLC_RELEASE_BUILD`           | the build steps of a release-mode CI run | `cli.ts prepare` and `verify-bundle`: `1` is release mode                                                                                   |
| `OPENPLC_TRUST_SEED_SECRET`       | the one step that needs the secret       | `cli.ts generate-release`, `scripts/release/seed-audit.mjs`                                                                                 |
| `OPENPLC_TEST_PACKAGE`            | `npm run package:test`                   | `cli.ts prepare`, which refuses it in release mode                                                                                          |
| `OPENPLC_TRUST_MODULE_UNDER_TEST` | the `trust-module` job                   | `src/backend/editor/package-trust/__tests__/check-sites.test.ts`: the rows that need only the real trusted key run against that module file |

## `release.yml`: new releases

A `v*` tag push builds in release mode:

- the `trust-module` job runs in the Environment `release-trust`. It installs with `npm ci --ignore-scripts` and no
  cache, and it is the only job that sees the secret, in its generator step
  (`cli.ts generate-release --out release/package-trust/package-trust-anchor.ts`). It runs `check-sites.test.ts` on
  the generated module with `OPENPLC_TRUST_MODULE_UNDER_TEST` and uploads the module as the artifact `trust-module`,
  kept for one day;
- the five build jobs download `trust-module` into `release/package-trust/` and build with `OPENPLC_RELEASE_BUILD=1`;
- the `cross-seed` job runs `cli.ts cross-seed-check` after `npm ci --ignore-scripts` and `npm run setup:strucpp`,
  with `contents: read`, no Environment, no secret and no token.

A dispatch on a branch (`workflow_dispatch`, with its `platforms` and `version` inputs as before) builds with the
development seed: no `trust-module` job, no `OPENPLC_RELEASE_BUILD`, and no release.

Every run, tag or dispatch:

- each build job runs `scripts/release/read-fuses.mjs` on every executable it built and
  `scripts/release/scan-trust-literals.mjs` on its unpacked output, before it uploads anything;
- the `packaged-checks` job runs `scripts/release/packaged-checks.mjs` (positive controls only, no negative control)
  on the macOS arm64 DMG, the Windows x64 installer and the Linux x64 AppImage, on `macos-latest`, `windows-2022` and
  `ubuntu-22.04`, with `--allow-prerelease`.

`create-release` runs on tags only, after `packaged-checks` and `cross-seed`. It runs `scripts/release/check-upload-set.mjs` with
`--allow-prerelease` on the installers before `gh release create` and uploads exactly the six installers: never a
`latest*.yml` and never a `.blockmap` (see `docs/update-notice.md`).

The version of a `release.yml` run may be a prerelease, such as `4.4.0-rc1` for the tag `v4.4.0-rc1`: both checks pass
`--allow-prerelease`, so the installers are named with the full version. `rebuild-release.yml` never passes it and
accepts only `<major>.<minor>.<patch>`.

A dispatch of `release.yml` on a demand branch with `platforms: all` is how a development build of the hardened editor
is produced and checked.

## The release check scripts

`scripts/release/` uses Node built-ins only, so a workflow runs it from its own checkout without installing anything.
Each script exits 0 when its check passes and 1 with the reason otherwise.

| Script                    | Checks                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-ref.mjs`           | `--ref` is `feature/<PROJECT>-<number>-backport-v<version>`, the version taken from `--release`; prints the version                                                                             |
| `check-version.mjs`       | `APP_VERSION` and `release/app/package.json` of `--tree` equal the version of `--release`; prints the version                                                                                   |
| `check-upload-set.mjs`    | a folder holds exactly the six installer names of `--version`, each a regular file                                                                                                              |
| `read-fuses.mjs`          | every executable or `.app` given carries the five fuses, naming each one that does not                                                                                                          |
| `scan-trust-literals.mjs` | no file under the given folders holds a trusted key as PEM, base64 body, raw bytes or key id, nor a PEM BEGIN marker                                                                            |
| `release-digests.mjs`     | `before` records the sha256 of the six installers of a release; `after` checks that each now has the digest the run built. Exit 3 when the only problem is a digest GitHub has not computed yet |
| `release-notes.mjs`       | appends an "Installers rebuilt on <date>" section (commit, previous and new sha256 of each installer) to the release notes                                                                      |
| `seed-audit.mjs`          | the seed of a run appears nowhere in the given files (raw, hex in both cases, base64), printing only `match: <file> offset <n> form <form>` or `no match`, never the seed                       |
| `packaged-checks.mjs`     | installs one installer and attacks it (below)                                                                                                                                                   |

The release tag of every script is `v<major>.<minor>.<patch>`, or its `-rehearsal` form, which stands for the same
version. A version is `<major>.<minor>.<patch>`; only `check-upload-set.mjs` and `packaged-checks.mjs` also accept
`<major>.<minor>.<patch>-<prerelease>` (dot-separated letters, digits and hyphens, no `+` build metadata), and only
with `--allow-prerelease`. The option widens the version form only: the upload set is still exactly the six
installers.

### Packaged checks

`packaged-checks.mjs --platform <mac|win|linux> --installer <path> --version <v> --positive-control <fx3u .vpp>
--trusted-keys <trusted-keys.ts> --report <file.json> [--negative-control] [--allow-prerelease]` installs the installer
into a temporary folder and runs, in order:

- `start`: the editor stays alive 30 s.
- `ABUSE-01`: the reproducer of the published trust patch (`fixtures/patch-trust-reproducer.mjs`) must not change
  `app.asar`.
- `ABUSE-02`: no file of the installation, `app.asar` extracted included, holds a trust literal.
- `ABUSE-06 row 1` and `row 2`: a repacked `app.asar`, and one byte edited in place in the `dist/main` chunk that holds
  the trust module, must stop the editor.
- `ABUSE-07`: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`, `--inspect-brk` and SIGUSR1 must run no attacker
  code and open no debugger. A process ended by SIGUSR1 itself, with no inspector banner, counts as refused.
- `ABUSE-13 (a)` and `(b)`: an `app` folder next to `app.asar`, and one with `app.asar` moved away, must not load.
- `ABUSE-03 (b)` and `(e)`: the CLI refuses to install, and to compile against, a package signed by another key.
- `AC5 compile` and `AC5 packages install`: the Autonomy-signed fx3u package (`--positive-control`, pinned by sha256)
  is still accepted: a CLI build for its board starts with no trust refusal, and the CLI installs it.

Some checks are skipped with their reason: `ABUSE-06` on Linux (no ASAR integrity there), SIGUSR1 on Windows,
`AC5 packages install` outside Linux, and `ABUSE-03 (b)` and `AC5 packages install` before 4.3.2 (no
`openplc-cli packages`). A prerelease version is compared by its numeric core: `4.3.2-rc1` counts as 4.3.2.

With `--negative-control` the same checks run inverted against an original installer: each passes only when the
attack works, so a check that cannot see its attack fails instead of passing. `start` and `ABUSE-07 NODE_OPTIONS` stay
normal; `ABUSE-13 (a)`, `ABUSE-03 (b)`, `ABUSE-03 (e)` and the two `AC5` checks are skipped, each with its reason.

The report is JSON (`schema: 1`): the platform, the version, the installer and its sha256, `negativeControl`, the
start and end times, `result` (`pass` or `fail`) and one entry per check with its `mode` (`normal`, `inverted` or
`skipped`), `result`, `reason` and evidence. Exit codes: 0 when every check passes or is skipped, 1 when one fails
(an inconclusive check fails), 2 for a usage problem, with no report.

## `rebuild-release.yml`: rebuilding a published release

Started by hand only (`workflow_dispatch`), from `main`. One run per release at a time (`concurrency` on the release
input). Every release script runs from the workflow's own checkout (`tooling/`), never from the tree it builds
(`tree/`).

### Inputs

| Input               | Used by                | Meaning                                                                |
| ------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `mode`              | every run              | `rebuild` (default), `dry-run`, `verify` or `seed-audit`               |
| `ref`               | `rebuild`, `dry-run`   | the branch to build: the backport branch of the release                |
| `release`           | every mode             | the target release tag, for example `v4.3.5` or `v4.3.5-rehearsal`     |
| `negative_controls` | `rebuild`, `dry-run`   | also run the negative controls; for the rehearsal only. Off by default |
| `run_id`            | `verify`, `seed-audit` | the rebuild run to verify or audit                                     |

There is no version input: the version comes from the release tag. The run name is
`Rebuild <release> (<mode>) from <ref>`.

### Modes and jobs

- **`rebuild`** runs every job below and replaces the six installers of the release.
- **`dry-run`** runs the same jobs except `publish`: it builds and checks, and changes nothing on the release.
- **`verify`** reads the rebuild manifest and build digests of `run_id` and checks the release's assets against them
  with `release-digests.mjs after`.
- **`seed-audit`** searches everything a rebuild run left for its seed (below).

Jobs of `rebuild` and `dry-run`:

1. `resolve` requires `ref`, runs `check-ref.mjs` before it fetches the tree, checks out `ref`, writes the branch and
   the commit to the run summary, runs `check-version.mjs`, requires tag `v<version>` to be an ancestor of the commit,
   finds the one release with the target tag (drafts included), records the original digests
   (`release-digests.mjs before`) and uploads them with the release id, version and commit as the artifact
   `rebuild-manifest` (30 days).
2. `trust-module`: as in `release.yml`, for the version and commit `resolve` found, plus `npm run setup:strucpp`
   before the check-site test.
3. Five build jobs (`build-macos`, `build-windows-x64`, `build-windows-arm64`, `build-linux-x64`,
   `build-linux-arm64`) build with `OPENPLC_RELEASE_BUILD=1` and the downloaded module, name the installers as the
   release does, record their sha256, run `read-fuses.mjs` and `scan-trust-literals.mjs`, then upload the installers
   (7 days) and their digests (30 days). With `negative_controls`, `build-windows-x64` also reads the fuses of the
   original installer of `v<version>` and requires the readout to fail naming only the original.
4. `packaged-checks` runs `packaged-checks.mjs` on the macOS arm64, Windows x64 and Linux x64 installers of the run
   (Linux under `xvfb-run`), with no secret, no token and no dependency install. With `negative_controls` it also
   downloads the published installer of `v<version>` and runs the checks on it with `--negative-control`. The
   reports are uploaded as `packaged-checks-<platform>` (30 days).
5. `cross-seed` (after `resolve`) checks out `tree/` at the commit `resolve` found and runs that tree's own
   `cli.ts cross-seed-check`, after `npm ci --ignore-scripts` and `npm run setup:strucpp`, with `contents: read`, no
   Environment, no secret and no token. A `dry-run` reports its result.
6. `publish` (`rebuild` only, after every build job, `packaged-checks` and `cross-seed`) checks the upload set (with
   `negative_controls`, it first proves that a set holding `latest.yml` fails), replaces the installers, checks the
   digests and records the rebuild in the release notes.

### The `ref` rule

A rebuild builds only the backport branch of its target release: `feature/<KEY>-backport-v<version>`, the version
taken from the release tag, so `v4.3.5-rehearsal` needs the backport branch of 4.3.5. `check-ref.mjs` enforces it in
`resolve`, before the branch is fetched. The Environment `release-trust` cannot enforce it: the workflow is dispatched
from `main`, so its deployment branch rule only ever sees `main`. The run name shows the `ref`, so the
`release-trust` reviewer reads it before approving the `trust-module` job.

### Replacing the installers

For each of the six installers, `publish`:

1. deletes a `<name>.uploading` asset an earlier attempt left;
2. uploads the new file as `<name>.uploading`;
3. deletes the old `<name>` asset;
4. renames the upload to `<name>`.

The release never lacks a file the run has not uploaded yet, and an `.uploading` name matches no installer the update
notice picks. Between steps 3 and 4 the installer's name is absent for a few seconds (see `docs/update-notice.md`).

If a replacement fails, use **Re-run failed jobs** on the same run (within 7 days, while its installer artifacts
exist): the re-run deletes any leftover `.uploading` asset and replaces each installer again. Otherwise delete the
leftover `<name>.uploading` asset by hand.

After the upload, `publish` reads the release back with `release-digests.mjs after`: each of the six installers must
carry the digest the run built, no installer may keep its original digest, and no seventh asset may exist. GitHub can
fill an asset's digest after the upload response, so while the only problem is a digest not computed yet (exit 3) the
read is repeated, 10 s apart, up to 6 reads, then fails naming the assets still without one.

### Seed audit

`seed-audit` runs in the Environment `release-trust`. It requires the `trust-module` artifact of `run_id` to exist
(it is kept for one day), downloads it with every other artifact of the run, the run's logs, every asset of the
release and the repository's cache keys, and runs `seed-audit.mjs` with the version and commit of the run's manifest.

## Rehearsal and rebuilds

Every 4.3.x release from 4.3.0 on is rebuilt from its backport branch. Nothing replaces a published asset before the
rehearsal passed.

1. **Environment and secret.** A repository admin creates the Environment `release-trust`, with a required reviewer
   and a deployment rule that allows `main` and `v*` tags (the refs its jobs run on), and adds the secret `TRUST_SEED_SECRET` to it: 64
   hexadecimal characters, for example from `openssl rand -hex 32`. Keep it unchanged between a rebuild and its seed
   audit.
2. **Rehearsal release.** Create a draft release `v4.3.5-rehearsal` and upload copies of the six original v4.3.5
   installers to it. Keep it a draft.
3. **Dry run on the oldest tree.** `mode: dry-run` with `ref` = `feature/<KEY>-backport-v4.3.0` and `release` =
   `v4.3.0`. It builds and checks the oldest tree, and uploads nothing.
4. **Rehearsal rebuild.** `mode: rebuild` with `negative_controls: true`, `ref` = `feature/<KEY>-backport-v4.3.5`,
   `release` = `v4.3.5-rehearsal`. Negative controls are valid only here, before any v4.3.x release is replaced.
5. **Approvals.** Approve the Environment each time, after checking the `ref` in the run name.
6. **Scenario runs**, then:
   - ABUSE-16: `ref` = `feature/<KEY>-backport-v4.3.4`, `release` = `v4.3.5-rehearsal`. It is refused by the ref
     check, naming 4.3.4 and 4.3.5.
   - ABUSE-10 and ABUSE-12: alter the draft in one of these ways, then run `mode: verify` with `run_id` = the
     rehearsal run. Each run must fail, naming the asset:
     - ABUSE-10: replace `OpenPLC.Editor_4.3.5.exe` with a file of the same name that the run did not build;
     - ABUSE-12: put back the original `OpenPLC.Editor-4.3.5-ARM64.AppImage`, which still carries its original
       digest;
     - ABUSE-12: delete `OpenPLC.Editor_4.3.5-ARM64.exe`, which is then missing;
     - ABUSE-12: add a seventh asset `OpenPLC Editor_4.3.5.exe`, which is unexpected.
   - ABUSE-09: `mode: seed-audit` with `run_id` = the rehearsal run. Run it after the rehearsal run finished and
     within one day, while its `trust-module` artifact still exists.
7. **Rebuilds**, only once steps 3 to 6 passed: `mode: rebuild` for each release `v4.3.0` to `v4.3.5` from its backport
   branch, `negative_controls` off, then `mode: verify` for each run.

### Backport branches

A backport branch `feature/<KEY>-backport-v4.3.N` is cut from the tag `v4.3.N` and takes only the trust anchor and
the fuses, with their tests, never `release.yml` changes. It is pushed and kept, never merged, and no `v*` tag is ever
pushed for it: a tag push would start `release.yml` and create a release.

## Limits and accepted residuals

Three residuals below (a structural patch of a call site, a structural patch of the generated checks, a wrapped
`node:fs`) need a modifiable installation. What stops that differs by platform:

- **macOS:** the Developer ID signature and ASAR integrity stop a modified `app.asar` or executable from running.
- **Windows:** open while the installers are not code-signed (DOPE-444). Once they are, a tampered executable is
  detectable (its Authenticode signature breaks and SmartScreen warns), but Windows refuses to run it only where Smart
  App Control or an application control policy (WDAC) enforces signatures.
- **Linux (AppImage):** open. There is no ASAR integrity and no barrier is planned.

- **Test level.** The hardened runtime with a Developer ID signature exists only in CI builds. A local macOS build is
  signed ad hoc, so the packaged checks run locally show the fuses and the trust anchor, not the hardened runtime.
- **Linux.** Electron has no ASAR integrity for an AppImage, so a modified `app.asar` still starts there
  (`ABUSE-06` is skipped on Linux). The per-build key encoding and the check sites still apply.
- **Windows without Authenticode.** The installers are not code-signed (DOPE-444). The `app.asar` hash is recorded
  in the executable, which no signature protects, so an attacker able to write the installation can change both.
- **Files outside `app.asar`.** ASAR integrity covers `app.asar` only: the extra resources (`yowasp-clang`,
  `wasmer-sdk`, `python-runtime`, `bin`, `sources`) are not checked (DOPE-895).
- **A structural patch of a call site.** Each release names the call sites differently, but the fixed text around them
  is the same in every release, so a patch that anchors on that text and returns a forged verdict fits every release.
  The code does not stop it: on macOS the signature and ASAR integrity do; on Windows it stays open until DOPE-444 and,
  after it, is refused only where signatures are enforced; on Linux it stays open.
- **A structural patch of the generated checks.** The seed changes the names, the share literals, the order of the
  declarations and of each site's canaries, the number of sites per hook (two to four), the canonical-JSON and file-set
  check variants of each site, and the reader variant of each hook. It does not change the rest: the signature
  parser, the own-property reader, the Ed25519 helper, the manifest identity check and the check-canary runner of every
  site, the hook's loop over its sites, the end of each site, the entry point's handling of the shared verifier's
  `valid`, and the refusal text are the same in every release. One regex that matches that shape, rather than exact
  bytes, can patch every release; the per-build generation only makes each patch structural instead of byte-exact.
  Same platform condition as the call-site patch: stopped on macOS, open on Windows until DOPE-444 and afterwards
  refused only where signatures are enforced, open on Linux.
- **A wrapped `node:fs`.** Code able to replace `node:fs` in the main process can serve the bytes of a genuine package
  to the trust checks while another package is used. Same platform condition: stopped on macOS, open on Windows until
  DOPE-444 and afterwards refused only where signatures are enforced, open on Linux.
- **`seed-audit` and compressed installers.** The audit searches the release assets as they are: DMG, NSIS and
  AppImage files are compressed, so a seed packed inside one would not show as plain bytes.
