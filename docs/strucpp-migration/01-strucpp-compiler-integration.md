# Phase 1: STruC++ Compiler Integration

## Goal

Set up the infrastructure to use STruC++ as a dependency in the OpenPLC Editor. This phase
focuses exclusively on the dependency management: version tracking, automated download from
GitHub Releases, and making the STruC++ `compile()` API and C++ runtime headers available
to the editor.

The editor will call `compile()` directly from `compiler-module.ts` -- no wrapper module
is needed. The Arduino runtime navigates STruC++ generated structures dynamically (located
variables, configuration, tasks, programs) so no glue code generator is needed either.

## Prerequisites

- STruC++ repository at `github.com/Autonomy-Logic/STruCpp` with tagged releases
- STruC++ release workflow produces an npm tarball (`.tgz`) as a release artifact
- STruC++ exposes a programmatic API: `compile(source: string, options?): CompileResult`

## Dependency Strategy

STruC++ is unique compared to matiec and xml2st: it is both a **TypeScript library** (imported
via `compile()`) and a provider of **C++ runtime headers** (needed for Arduino compilation).
Both artifacts must be strictly version-coupled and managed through the same mechanism the
editor already uses for external tools.

### Principles

1. **No `file:` dependencies** -- fragile, breaks CI, requires local checkout
2. **No manually-copied runtime headers** -- they must travel with the compiler version
3. **Single version source of truth** -- `binary-versions.json` tracks the STruC++ version
4. **Same download mechanism** -- `scripts/download-binaries.ts` handles setup
5. **Works identically in local dev and CI/CD**

### Release Artifact from STruC++

The STruC++ release workflow (`release.yml`) includes a `build-npm` job that runs `npm pack`
to produce a platform-independent `.tgz` tarball. This tarball contains everything:

- `dist/` -- compiled JavaScript (the `compile()` API)
- `src/runtime/include/` -- C++ runtime headers (`iec_var.hpp`, `iec_types.hpp`, etc.)
- `libs/` -- standard function block libraries (`.stlib` files)
- `package.json` -- metadata including version

The `.tgz` is uploaded as a release asset alongside the platform-specific binaries.

### Version Tracking

**File**: `binary-versions.json`

```json
{
  "xml2st": {
    "version": "v4.0.3",
    "repository": "Autonomy-Logic/xml2st"
  },
  "matiec": {
    "version": "v4.0.11",
    "repository": "Autonomy-Logic/matiec"
  },
  "strucpp": {
    "version": "v0.2.4",
    "repository": "Autonomy-Logic/STruCpp"
  }
}
```

Version bumps are a one-line change, auditable in git.

### Download Script

**File**: `scripts/download-binaries.ts`

The existing download script is extended with `downloadStrucpp()` and `needsStrucpp()`.

**Download flow:**
1. Download the `.tgz` from GitHub Releases
2. Run `npm install <tgz> --save-exact` to install into `node_modules/strucpp/`
   (makes `import { compile } from 'strucpp'` work)
3. Extract runtime headers to `resources/strucpp/runtime/include/`
4. Extract `.stlib` libraries to `resources/strucpp/libs/`
5. Write cache metadata to `resources/strucpp/.strucpp-metadata.json`

**Cache invalidation:**
- Checks `node_modules/strucpp/package.json` version against `binary-versions.json`
- Checks `resources/strucpp/runtime/include/iec_types.hpp` exists
- Checks `.strucpp-metadata.json` version matches
- If any check fails, re-downloads (replacing all local files)
- `--force` flag bypasses all cache checks

**Key difference from matiec/xml2st**: STruC++ is platform-independent (pure TypeScript +
header-only C++), so it downloads once regardless of platform/arch.

### Git Ignore

**File**: `.gitignore`

```gitignore
resources/strucpp/
```

The `node_modules/strucpp` entry is already covered by the blanket `node_modules/` ignore.

### Directory Layout After Setup

```
openplc-editor/
├── binary-versions.json                   # Tracks v0.2.4
├── node_modules/strucpp/                  # TypeScript compiler (npm install)
│   ├── dist/                              # Compiled JS
│   ├── src/runtime/include/               # C++ headers (also in node_modules)
│   ├── libs/                              # .stlib files (also in node_modules)
│   └── package.json                       # Version: 0.2.4
├── resources/strucpp/                     # Extracted for compiler module access
│   ├── .strucpp-metadata.json             # Cache: {"strucpp": "v0.2.4"}
│   ├── runtime/include/                   # C++ headers (copied to build dirs)
│   │   ├── iec_var.hpp
│   │   ├── iec_types.hpp
│   │   ├── iec_located.hpp
│   │   ├── iec_std_lib.hpp
│   │   └── ... (19 header files)
│   └── libs/                              # .stlib archives
│       ├── iec-standard-fb.stlib
│       └── oscat-basic.stlib
└── resources/bin/{platform}/{arch}/       # Other binaries (unchanged)
```

### How the Compiler Module Uses STruC++

In later phases, `compiler-module.ts` will:

1. **Import the compiler** -- `import { compile } from 'strucpp'` (standard Node.js import)
2. **Call compile() directly** -- pass the ST source string, get C++ code back. No wrapper needed.
3. **Copy runtime headers** -- from `resources/strucpp/runtime/include/` to the build directory
4. **Pass library paths** -- `resources/strucpp/libs/` to `compile()` via the `libraryPaths` option

### Why No Compile Wrapper

The STruC++ `compile()` API returns everything the editor needs directly:
- `cppCode` / `headerCode` -- the generated C++ files
- `projectModel` -- task intervals, program instances (accessible from generated code)
- `errors` / `warnings` -- diagnostics

The Arduino runtime navigates STruC++ structures dynamically at C++ level:
- `locatedVars[]` array for I/O binding (just a for loop)
- `ConfigurationInstance` → `ResourceInstance` → `TaskInstance` for task scheduling
- `ProgramBase::run()` for executing each program
- `common_ticktime__` computed from task intervals at runtime

No TypeScript glue code generator or metadata extraction wrapper is needed.

### Version Upgrade Workflow

To upgrade STruC++ to a new version:

1. Update `binary-versions.json`: change `"version": "v0.3.0"`
2. Run `npm run setup:binaries` (or `npm run dev` which triggers it via prestart)
3. The script downloads the new `.tgz`, updates `node_modules/strucpp`, and refreshes
   `resources/strucpp/` with the matching runtime headers
4. Commit `binary-versions.json` (one-line change)
5. CI picks it up automatically

### CI/CD Integration

The CI workflow already calls `npm ci` (which triggers `postinstall` -> `download-binaries.ts`).
The download script automatically handles strucpp alongside xml2st and matiec. No CI workflow
changes needed beyond the existing cache invalidation (keyed on `binary-versions.json` hash).

## Files Created/Modified

### In openplc-editor

| File | Action |
|------|--------|
| `binary-versions.json` | Add strucpp entry with version and repository |
| `scripts/download-binaries.ts` | Add `downloadStrucpp()` and `needsStrucpp()` |
| `.gitignore` | Add `resources/strucpp/` |

### In STruCpp (separate repository)

| File | Action |
|------|--------|
| `.github/workflows/release.yml` | Add `build-npm` job to produce `.tgz` artifact |

## Testing

1. Run `npm run setup:binaries` -- verify strucpp downloads and installs
2. Verify `node_modules/strucpp/package.json` has the correct version
3. Verify `resources/strucpp/runtime/include/iec_types.hpp` exists
4. Verify `resources/strucpp/libs/iec-standard-fb.stlib` exists
5. Change version in `binary-versions.json`, re-run -- verify it re-downloads
6. Run with `--force` -- verify it re-downloads even when cached
