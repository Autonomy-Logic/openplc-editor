# External Binaries Strategy

> **Purpose**: Guide the migration of pre-built binaries (xml2st, matiec, arduino-cli) out of the
> openplc-editor git repository, replacing them with versioned downloads from GitHub Releases.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State](#current-state)
3. [Target Architecture](#target-architecture)
4. [Phase 1 — Tagged Releases on xml2st and matiec](#phase-1--tagged-releases-on-xml2st-and-matiec)
5. [Phase 2 — Download Script in openplc-editor](#phase-2--download-script-in-openplc-editor)
6. [Phase 3 — Update openplc-editor CI/CD](#phase-3--update-openplc-editor-cicd)
7. [Phase 4 — Remove Binaries from Git](#phase-4--remove-binaries-from-git)
8. [Alternatives Considered](#alternatives-considered)
9. [Key Design Decisions](#key-design-decisions)
10. [Implementation Checklist](#implementation-checklist)

---

## Problem Statement

The openplc-editor repository contains **~350 MB** of pre-built binaries committed directly to git
under `resources/bin/`. Every time xml2st or matiec is updated, new binaries are committed, bloating
the repository history. There is no version tracking — it is impossible to know which version of
xml2st or matiec is bundled at any given commit.

## Current State

### Repository layout

```
resources/
├── bin/
│   ├── darwin/
│   │   ├── x64/    (68 MB)  — arduino-cli, iec2c, xml2st/
│   │   └── arm64/  (66 MB)  — arduino-cli, iec2c, xml2st/
│   ├── linux/
│   │   ├── x64/    (57 MB)  — arduino-cli, iec2c, xml2st
│   │   └── arm64/  (33 MB)  — arduino-cli only (incomplete)
│   └── win32/
│       ├── x64/    (63 MB)  — arduino-cli.exe, iec2c.exe, xml2st.exe
│       └── arm64/  (63 MB)  — arduino-cli.exe, iec2c.exe, xml2st.exe
└── sources/
    └── MatIEC/lib/           — matiec IEC standard library files (596 KB)
```

### Tool summary

| Tool | Repository | Language | CI/CD | Tagged Releases | Extra Files |
|---|---|---|---|---|---|
| xml2st | Autonomy-Logic/xml2st | Python (PyInstaller) | Build workflow for 6 platforms | None | plcopen/, templates/ (bundled by PyInstaller) |
| matiec (iec2c) | Autonomy-Logic/matiec | C++ (Bison/Flex/Autotools) | None | None | lib/ dir (596 KB) with .txt + C headers |
| arduino-cli | arduino/arduino-cli | Go | Official | Yes (official releases) | None |

### How binaries are consumed

The `CompilerModule` class (`src/main/modules/compiler/compiler-module.ts`) resolves binary paths
at runtime:

```
Development:  {cwd}/resources/bin/{platform}/{arch}/{binary}
Production:   {resourcesPath}/bin/{binary}
```

`electron-builder.json` copies the platform-specific `resources/bin/{platform}/{arch}` directory
into the packaged app as `extraResources`.

The MatIEC standard library is consumed from `resources/sources/MatIEC/lib/` by the compilation
pipeline.

### Compilation pipeline

```
XML Project File  →  xml2st  →  ST File  →  iec2c  →  C/C++ Files  →  arduino-cli  →  Board Binary
```

---

## Target Architecture

```
openplc-editor/
├── binary-versions.json          ← Single source of truth for tool versions
├── scripts/
│   └── download-binaries.ts      ← Downloads release artifacts from GitHub
├── resources/
│   ├── bin/                      ← .gitignored, populated by download script
│   │   └── {platform}/{arch}/
│   └── sources/
│       └── MatIEC/lib/           ← .gitignored, populated by download script
```

Version bumps become a one-line diff in `binary-versions.json`.

---

## Phase 1 — Tagged Releases on xml2st and matiec

### 1.1 xml2st (Autonomy-Logic/xml2st)

**Status**: Already has a CI build workflow for all 6 platforms. Needs a release workflow.

**Tasks**:

- [ ] Add a release workflow (`.github/workflows/release.yml`) triggered on tag push (`v*`)
- [ ] Standardize artifact naming: `xml2st-{platform}-{arch}.tar.gz`
  - `xml2st-darwin-arm64.tar.gz`
  - `xml2st-darwin-x64.tar.gz`
  - `xml2st-linux-arm64.tar.gz`
  - `xml2st-linux-x64.tar.gz`
  - `xml2st-win32-arm64.zip`
  - `xml2st-win32-x64.zip`
- [ ] On macOS, the artifact is a **directory** (xml2st/ with _internal/ containing Python
  runtime). The tarball must preserve this directory structure.
- [ ] On Linux and Windows, the artifact is a **single executable** (`-F` flag in PyInstaller).
- [ ] Create a GitHub Release with all 6 artifacts attached
- [ ] Tag the current development branch as `v1.0.0`

### 1.2 matiec (Autonomy-Logic/matiec)

**Status**: Has no CI/CD at all. Needs a complete pipeline.

**Tasks**:

- [ ] Create `.github/workflows/release.yml` triggered on tag push (`v*`)
- [ ] Build matrix covering 6 platform/arch combinations:
  - `macos-15` (arm64), `macos-13` (x64)
  - `ubuntu-22.04` (x64), `ubuntu-22.04-arm` (arm64)
  - `windows-latest` (x64), Windows ARM64 (cross-compile or native runner)
- [ ] Build dependencies per platform:
  - **Linux**: `sudo apt-get install -y build-essential bison flex autoconf automake`
  - **macOS**: `brew install bison flex autoconf automake` (or use Xcode tools)
  - **Windows**: MinGW or MSYS2 with bison, flex, autoconf, automake
- [ ] Build steps: `autoreconf -i && ./configure && make`
- [ ] Package output as `matiec-{platform}-{arch}.tar.gz` containing:
  - `iec2c` binary (or `iec2c.exe` on Windows)
  - `lib/` directory (all .txt files + C/ subdirectory with headers)
- [ ] Create a GitHub Release with all 6 artifacts attached
- [ ] Tag the current development branch as `v1.0.0`

**Note on Windows ARM64**: matiec uses autotools which may need MSYS2 or cross-compilation. If a
native Windows ARM64 runner is not available, cross-compile from x64 or use the x64 binary (runs
via emulation on Windows ARM64). Evaluate feasibility during implementation.

---

## Phase 2 — Download Script in openplc-editor

### 2.1 Version manifest: `binary-versions.json`

Create at repository root:

```json
{
  "xml2st": {
    "version": "v1.0.0",
    "repository": "Autonomy-Logic/xml2st"
  },
  "matiec": {
    "version": "v1.0.0",
    "repository": "Autonomy-Logic/matiec"
  },
  "arduino-cli": {
    "version": "1.1.1",
    "repository": "arduino/arduino-cli"
  }
}
```

### 2.2 Download script: `scripts/download-binaries.ts`

**Responsibilities**:

1. Read `binary-versions.json`
2. Determine current platform and architecture (or accept `--platform` / `--arch` overrides)
3. Construct GitHub Release download URLs:
   - xml2st: `https://github.com/Autonomy-Logic/xml2st/releases/download/{tag}/xml2st-{platform}-{arch}.tar.gz`
   - matiec: `https://github.com/Autonomy-Logic/matiec/releases/download/{tag}/matiec-{platform}-{arch}.tar.gz`
   - arduino-cli: `https://github.com/arduino/arduino-cli/releases/download/v{version}/arduino-cli_{version}_{os}_{arch}.tar.gz`
4. Download and extract to `resources/bin/{platform}/{arch}/`
5. Copy matiec `lib/` to `resources/sources/MatIEC/lib/`
6. Write a `.binary-metadata.json` inside `resources/bin/` recording downloaded versions (for cache
   checking)

**Behavioral rules**:

- **Cache check**: If binaries already exist and `.binary-metadata.json` matches
  `binary-versions.json`, skip download. Use `--force` to override.
- **Dev mode**: Downloads only the current platform's binaries (not all 6).
- **CI mode**: Accepts `--platform` and `--arch` flags for cross-platform builds.
- **Error handling**: Clear error messages if GitHub is unreachable or a release artifact is missing.

### 2.3 npm integration

```jsonc
// package.json
{
  "scripts": {
    "setup:binaries": "ts-node scripts/download-binaries.ts",
    "postinstall": "ts-node scripts/download-binaries.ts && ts-node scripts/check-native-dep.js && electron-builder install-app-deps"
  }
}
```

Running `npm install` will automatically fetch the correct binaries for the developer's platform.

### 2.4 Platform / architecture mapping

The download script must map Node.js `process.platform` and `process.arch` values to artifact
naming conventions. Each tool may use slightly different naming:

| Node.js | xml2st artifact | matiec artifact | arduino-cli artifact |
|---|---|---|---|
| darwin/arm64 | xml2st-darwin-arm64 | matiec-darwin-arm64 | arduino-cli_{v}_macOS_ARM64 |
| darwin/x64 | xml2st-darwin-x64 | matiec-darwin-x64 | arduino-cli_{v}_macOS_64bit |
| linux/arm64 | xml2st-linux-arm64 | matiec-linux-arm64 | arduino-cli_{v}_Linux_ARM64 |
| linux/x64 | xml2st-linux-x64 | matiec-linux-x64 | arduino-cli_{v}_Linux_64bit |
| win32/arm64 | xml2st-win32-arm64 | matiec-win32-arm64 | arduino-cli_{v}_Windows_ARM64 |
| win32/x64 | xml2st-win32-x64 | matiec-win32-x64 | arduino-cli_{v}_Windows_64bit |

---

## Phase 3 — Update openplc-editor CI/CD

### 3.1 Modify `release.yml`

Add a binary download step **before** the build step in each platform job:

```yaml
- name: Download tool binaries
  run: npx ts-node scripts/download-binaries.ts
```

For cross-architecture builds (e.g., Windows ARM64 on x64 runner):

```yaml
- name: Download tool binaries (ARM64)
  run: npx ts-node scripts/download-binaries.ts --platform win32 --arch arm64
```

### 3.2 macOS builds

The macOS job builds **both** x64 and arm64 in a single run. The download script must be called
twice (once per architecture), or accept a `--all-arch` flag to download both:

```yaml
- name: Download binaries for x64
  run: npx ts-node scripts/download-binaries.ts --arch x64

- name: Download binaries for arm64
  run: npx ts-node scripts/download-binaries.ts --arch arm64
```

### 3.3 Caching (optional optimization)

Use GitHub Actions cache to avoid re-downloading binaries across CI runs when versions haven't
changed:

```yaml
- name: Cache tool binaries
  uses: actions/cache@v4
  with:
    path: resources/bin
    key: binaries-${{ runner.os }}-${{ hashFiles('binary-versions.json') }}
```

---

## Phase 4 — Remove Binaries from Git

### 4.1 Gitignore

Add to `.gitignore`:

```gitignore
# External tool binaries (downloaded by scripts/download-binaries.ts)
resources/bin/
resources/sources/MatIEC/lib/
```

### 4.2 Remove tracked files

```bash
git rm -r --cached resources/bin/
git rm -r --cached resources/sources/MatIEC/lib/
git commit -m "chore: remove pre-built binaries from git tracking"
```

### 4.3 (Optional) Rewrite git history

The binary blobs will remain in git history forever unless history is rewritten. This is a
**destructive operation** that requires coordination with all contributors:

```bash
# Using git-filter-repo (recommended over BFG)
git filter-repo --path resources/bin/ --invert-paths
```

**Recommendation**: Do this in a separate effort after the new system is proven stable. It requires
force-pushing and all contributors to re-clone.

---

## Alternatives Considered

| Alternative | Why Not |
|---|---|
| **Git submodules** | Still requires building from source after clone. Doesn't solve the pre-built binary distribution problem. |
| **Git LFS** | Binaries still stored (in LFS server); versioning is no better; adds LFS dependency for all developers. |
| **npm packages** | xml2st and matiec aren't JavaScript. Publishing native binaries as npm packages is non-standard and awkward. |
| **Build from source on npm install** | Requires bison/flex/autoconf for matiec and Python/PyInstaller for xml2st on every dev machine. Too fragile, too many dependencies. |
| **Docker-based builds** | Overkill for a desktop Electron app's development workflow. |
| **Vendored tarballs** | Still bloats the repo, just with compressed files instead of raw binaries. |

---

## Key Design Decisions

### 1. `binary-versions.json` as single source of truth

When upgrading xml2st, change one line in this file. The PR diff clearly shows "upgraded xml2st
from v1.2.0 to v1.3.0" — no binary blobs, clear audit trail.

### 2. Download on `postinstall`

Makes `npm install` self-sufficient — a new developer clones the repo, runs `npm install`, and
has everything needed to develop. Includes a cache check to avoid redundant downloads.

### 3. arduino-cli from official releases

Arduino CLI already has proper GitHub Releases with pre-built binaries for every platform. No
changes needed to the Arduino project — just download their official artifacts.

### 4. matiec lib/ bundled in release tarball

The matiec release artifact includes both the `iec2c` binary and the `lib/` directory. The download
script extracts `iec2c` to `resources/bin/` and `lib/` to `resources/sources/MatIEC/lib/`. This
keeps them versioned together (they must always match).

### 5. Platform-specific downloads in development

A developer on macOS ARM only downloads ~70 MB (darwin-arm64 binaries) instead of ~350 MB (all
platforms). CI downloads only what it needs for the target platform.

---

## Implementation Checklist

Phases should be executed in order. Each phase can be merged independently.

### Phase 1: Release Pipelines

- [ ] **1.1** Create xml2st release workflow with standardized artifact names
- [ ] **1.2** Tag xml2st `v1.0.0`
- [ ] **1.3** Create matiec CI/CD build workflow for all 6 platforms
- [ ] **1.4** Create matiec release workflow with standardized artifact names
- [ ] **1.5** Tag matiec `v1.0.0`
- [ ] **1.6** Verify all 12 release artifacts (6 per tool) download and work correctly

### Phase 2: Download Script

- [ ] **2.1** Create `binary-versions.json` in openplc-editor repo root
- [ ] **2.2** Implement `scripts/download-binaries.ts`
- [ ] **2.3** Test on all 3 platforms (macOS, Linux, Windows)
- [ ] **2.4** Hook into `postinstall` in package.json
- [ ] **2.5** Update CLAUDE.md / README with new setup instructions

### Phase 3: CI/CD Integration

- [ ] **3.1** Update `release.yml` to use download script instead of committed binaries
- [ ] **3.2** Handle cross-architecture builds (macOS dual-arch, Windows ARM64)
- [ ] **3.3** Add GitHub Actions caching for binaries
- [ ] **3.4** Run a full release build and verify all 6 distribution packages work

### Phase 4: Cleanup

- [ ] **4.1** Add `resources/bin/` and `resources/sources/MatIEC/lib/` to `.gitignore`
- [ ] **4.2** Remove binaries from git tracking (`git rm --cached`)
- [ ] **4.3** (Optional) Rewrite git history to purge old binary blobs
- [ ] **4.4** Update contributor documentation
