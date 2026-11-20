# HMI preview: where the first build's time goes, and how to make it fast

Investigation of the slow first HMI preview build in the OpenPLC Editor (desktop, Electron) and openplc-web
(Chromium), on this investigation branch in both repositories, started from the HMI feature branch (editor
`823c59e64`, web `0d2b88567`). Every prototype named here is a commit on that branch; none is meant to ship
as written.

Reading guide: **Measured** marks numbers taken in this investigation, **Verified in code** marks facts read from the
source, **Inferred** marks conclusions drawn from those, and **Not measured** marks what there is no data for.

## 1. Summary

- **Measured.** A first build ever takes about 16.5 s on desktop and 15 s on the web, from the click on a screen to
  its first frame. 98 % of it is clang. The precompiled header (6.7 s desktop, 3.7 s web) is compiled alone before
  any C++ unit can start, and the StandardWidgets unit `library.cpp` (6.8 s, 5.2 s) is the longest unit after it.
  Project files, unit generation (STruC++), fonts, module start and first frame together cost under 100 ms.
- **Measured.** The persistent object cache does hit after a restart (build 0.5 s), but after a normal session it
  misses `library.cpp`, `glue.cpp` and `factory.cpp`, and the restart takes 7.9 s on desktop and 6.1 s on the web.
  No key changes per session: the palette's gallery build and the screen preview compile the same unit paths with
  different generated headers, the cache keeps one object per unit path, and the gallery, drawn after the preview,
  overwrites it.
- **Measured, best combination.** Variants per unit + no precompiled header + linked module kept + store read at
  toolchain start + a 1.06 MB seed of the fixed parts: first build ever 3.2 s (desktop) and 5.1 s (web, of which
  1.9 s is waiting for the toolchain download from localhost); restart 0.38 s and 0.29 to 0.48 s; second screen
  0.35 s and 0.24 s.
- **Recommendation**, in order: fix the variant miss; drop the precompiled header; keep the linked module and read
  the store at toolchain start; ship a small seed of the fixed parts with the editor; warm up at project open. Do not
  store build artefacts in the project file. Section 7 has the ordered list, section 8 the follow-up tasks.

## 2. Method

### What was built and run

- **Instrumentation** (commit "Trace the HMI preview's first build and time it in three cases"): a temporary
  `[first-build]` trace in the shared toolchain code, identical in both repositories
  (`src/backend/shared/wasm-toolchain/first-build-trace.ts`): toolchain start (`toolchain-prepare`), the identity
  probe (`toolchain-identity`), reading the stored objects (`store-records`, `store-load`), each clang worker's spawn
  and ready, every cache miss with its reason (absent, a dependency changed and which file, a shadowed include), each
  compile's per-unit jobs (`compile-done`), the StandardWidgets STruC++ compile (`standard-widgets`) and, later, the
  linked-module lookup (`module-memo`). The existing timings line ("HMI preview built in N ms: files, generate,
  fonts, toolchain, start, first frame") is read from the Console.
- **Timing specs**: `e2e/hmi-first-build-timing.spec.ts` in each repository. One run is four sessions on one profile:
  1. **fresh**: a new profile (no stored objects; on the web, no downloaded toolchain either), open the project,
     click screen `Overview` and wait for its first frame (case **i**), then click screen `Layout` (case **iii**, a
     second build in the same session);
  2. **restart**: the editor (or browser) closed and started again on the same profile, click `Overview` (case
     **ii**);
  3. **restart again**: the same once more (case **ii'**), the first restart that follows a session which ran exactly
     like a normal one.

  A session ends only after every build it started finished, the palette's gallery included, and the store settled.
  (A first version closed the app while the gallery still compiled, which hid the miss of section 4.) The measured
  time is **click-to-frame**: from the click on the screen in the project tree to the preview status `ready`, set
  after the module started and drew its first frame.
- **Test project**: the HMI e2e fixture of `hmi-live-add.spec.ts` (`Overview`, and a richer `Layout` with stacks,
  labels, a diagram and a tank), a `Main` program, a Runtime v4 device, no project widget blocks.
- **Desktop**: the production build (`npm run build`) launched with Playwright's `_electron.launch`, as in the editor
  CLAUDE.md. **Web**: the local-project Vite dev server (port 5181) in Playwright's Chromium, with a persistent
  browser profile per run, so IndexedDB and the downloaded toolchain survive the restart. The web numbers therefore
  come from development mode with the toolchain served from localhost.
- **Repetitions**: three runs of each configuration; the tables give medians. The raw JSONL results stayed local.
- **Setup note**: the web worktree's `binary-versions.json` pins STruC++ `v0.8.1`, whose release asset does not exist
  (HTTP 404); the web runs used `0.8.1-rc1`, the version the editor's setup installs, copied into `node_modules`.

### Machine and load

Apple M4 Pro, 14 cores, 24 GB, macOS 26.6.2. Another agent was building and testing in other worktrees throughout:
the 1-minute load average next to the runs was 12 to 72, mostly 20 to 35. All timings carry that noise (the fresh
case moves between 13.5 and 17.5 s with nothing changed); comparisons are between configurations measured under the
same kind of load, and outliers are named where they occurred. **Not measured:** a slower Windows PC (open point 1
of the task), Firefox and WebKit, a production web bundle, and a real network.

## 3. Where the time goes (AC1)

### Desktop, baseline (the feature branch as it is)

Medians of three runs, ms. "toolchain" includes waiting for the identity probe and the stored objects.

| Phase | (i) fresh profile | (ii) restart | (ii') restart after a normal session | (iii) 2nd screen, same session |
| --- | ---: | ---: | ---: | ---: |
| **Click to first frame** | **16 558** | **771** | **7 914** | **893** |
| Build total | 16 339 | 529 | 7 818 | 686 |
| files | 13 | 14 | 15 | 0 |
| generate (of which STruC++) | 32 (21) | 31 (21) | 31 (20) | 20 (14) |
| fonts | 5 | 3 | 2 | 2 |
| toolchain | 16 272 | 468 | 7 753 | 648 |
| of which identity probe | 246 | 232 | 224 | 0 |
| of which stored objects read | 0 | 133 | 100 | 0 |
| of which compile | 15 892 | 25 | 7 356 | 605 |
| of which link | 61 | 72 | 63 | 40 |
| units compiled, of 13 | 13 | 0 | 3 | 2 |
| module start | 6 | 4 | 5 | 5 |
| first frame | 6 | 5 | 5 | 5 |

Per-unit compile time of the fresh build, desktop medians in ms: `library.cpp` 6 800, precompiled header 6 687,
preview host 1 727, `factory.cpp` 1 721, `hmi_text.c` 1 608, `screen_Layout.cpp` 1 523, `screen_Overview.cpp` 1 395,
`hmi_raster.c` 1 190, `hmi_core.c` 1 183, `glue.cpp` 830, `hmi_theme.c` 707, `hmi_math.c` 635, font table 188. A
clang worker is ready 216 ms after it is spawned (180 to 300 ms).

**Verified in code** (`compileToWasm`): the precompiled header is compiled first and alone, and every C++ unit waits
for it. **Inferred:** the critical path is the header then `library.cpp`, about 13.5 s of the 15.9 s compile; the other
units run beside `library.cpp` on up to four workers on this machine.

### Web (Chromium), baseline

| Phase | (i) fresh profile | (ii) restart | (ii') restart after a normal session | (iii) 2nd screen, same session |
| --- | ---: | ---: | ---: | ---: |
| **Click to first frame** | **15 140** | **558** | **6 080** | **1 008** |
| Build total | 14 175 | 412 | 5 575 | 563 |
| files | 9 | 30 | 9 | 0 |
| generate (of which STruC++) | 29 (18) | 29 (18) | 30 (19) | 23 (17) |
| fonts | 1 | 1 | 1 | 1 |
| toolchain | 14 117 | 334 | 5 515 | 514 |
| of which identity probe | 1 928 | 146 | 145 | 0 |
| of which stored objects read | 20 | 112 | 138 | 0 |
| of which compile | 12 182 | 18 | 5 186 | 477 |
| of which link | 36 | 57 | 41 | 37 |
| units compiled, of 13 | 13 | 0 | 3 | 1 |
| module start | 10 | 10 | 11 | 10 |
| first frame | 5 | 5 | 5 | 5 |

Per-unit compile time of the fresh build, web medians in ms: `library.cpp` 5 152, precompiled header 3 743, the
others 65 to 1 123. The web ran two clang workers, the desktop four.

- **Measured.** On a fresh profile the identity probe waits about 1.9 s for the toolchain's files, which the page
  starts downloading at load (`startRuntimeDownload`), here from localhost. The files are 105 MB (`llvm.core.wasm`
  75.5 MB, `llvm-resources.tar` 29.7 MB), 27 MB with gzip -6. **Not measured:** that download over a real network,
  likely the largest part of a real first visit.
- **IndexedDB, measured:** the store survives closing and reopening the browser profile; reading 14 records
  (15.4 MB) takes 112 to 138 ms; a fresh profile's store is empty and is created on first use; a build's writes are
  complete within the 2 s settle window the spec waits for.

### The rest of the path

- **Measured.** StandardWidgets is compiled by STruC++ on the renderer's (desktop) or page's (web) main thread once
  per session, at project open, because the language server's HMI sync asks for the library: 365 to 397 ms, before
  the HMI editor opens. It was not on the click-to-frame path in these runs; it stalls the UI for that long at open.
- **Measured.** The palette's gallery build (thumbnails) starts 800 ms after the designer mounts and, on a fresh
  profile, compiles the same precompiled header, core and library units a second time, alongside the preview build.
- **Measured.** Module start plus first frame is under 20 ms. With a warm cache, the remaining 150 to 300 ms of
  click-to-frame is the designer mounting and the build's own work outside the toolchain.

## 4. Does the persistent object cache hit on the first build after a restart? (AC2)

**Yes, except after a normal session, where three units always miss.** Evidence:

1. **Restart right after the fresh session** (ii): 0 of 13 units compiled, desktop and web, all three runs. The
   records (`store-records`: 14 to 19 records, 15 to 17 MB) are read before the first build, and every unit's key and
   dependency digests match. So nothing changes per session: not the precompiled header's digest (a unit's key uses
   the header's input digest, not its bytes), not the generated file names, and the store is wired for the preview
   path on both platforms.
2. **Restart after a normal session** (ii'), in which the palette's gallery is built after the preview, as it is in
   every session: `library.cpp`, `glue.cpp` and `factory.cpp` miss with reason `dependency`, the changed file being
   `unit/hmi_unit_libraries.hpp` (`library.cpp`, `factory.cpp`) and `unit/hmi_unit.hpp` (`glue.cpp`). 7.9 s on
   desktop, 6.1 s on the web, three runs each.
3. **Cause.** The compile requests dumped by the spec (`FB_DUMP_REQUESTS`) show that the gallery request's
   `hmi_unit_libraries.hpp` lacks the PLC's global constants (`STRING_LENGTH`, `LIST_LENGTH`) that the screen request
   carries: the thumbnails request has no PLC libraries. The wrappers `groups/library.cpp`, `glue.cpp` and
   `factory.cpp` have the same path and flags in both requests, so the same cache key, and `WasmObjectCache` keeps one
   object per key, in memory and in the store: the build that finishes last wins. The same eviction makes the second
   screen of a session recompile `glue.cpp` and `factory.cpp`, and `library.cpp` too when the gallery finished in
   between (case iii: 0.9 s, 5.8 s in one run).
4. The first trial run (restart, `library.cpp` recompiled, 7.6 s) also showed it is a race in the fresh session:
   the preview and the gallery compile `library.cpp` at the same time and either may be stored last.

## 5. Candidates (AC3)

Click-to-frame medians in ms, desktop / web. Each line adds its prototype to the commits above it, except where
marked. The fresh column moves between 13.5 and 17.5 s on lines that cannot change a build with an empty cache: that
is the load noise.

| Configuration (commit) | i fresh | ii restart | ii' restart after a normal session | iii 2nd screen |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 16 558 / 15 140 | 771 / 558 | 7 914 / 6 080 | 893 / 1 008 |
| 5.1 variants per unit | 15 492 / 16 147 | 750 / 578 | **743 / 562** | **353 / 249** |
| 5.2 identical builds joined, gallery after the preview (desktop) | 17 170 / - | 910 / - | 641 / - | 627 / - |
| 5.4 (b) seed of fixed parts (15.5 MB, with the header), on the line above | **4 116 / 4 055** | 979 / 550 | 930 / 559 | 383 / 234 |
| 5.5 (c) linked module kept, store read at toolchain start | 13 989 / 12 090 | **370 / 612** | **361 / 594** | **356 / 236** |
| 5.6 (d) warm-up, screen opened at once (desktop, on 5.2) | 15 534 / - | 611 / - | 666 / - | 615 / - |
| 5.6 (d) warm-up, screen opened 8 s after the project (desktop, on 5.2) | **7 554** / - | 648 / - | 630 / - | 608 / - |
| 5.7 no precompiled header, on 5.5 | **8 606 / 10 092** | 365 / 294 | 380 / 572 | 346 / 237 |
| 5.7 + seed of fixed parts without the header (1.06 MB) | **3 248 / 5 070** | 375 / 484 | 376 / 289 | 345 / 242 |

### 5.1 Keep several variants per unit (found by the measurements)

- **Prototype** ("Prototype: keep several variants of each compiled unit"; `wasm-object-cache.ts`,
  `persistent-object-cache.ts`, `compile-to-wasm.ts`): the session cache keeps up to four variants per unit key, each
  identified by the digest of the files it was built from; the store keys a record by unit key and that digest
  (record format 2; format-1 records are dropped once).
- **Measured.** Restart after a normal session 7 914 to 743 ms (desktop), 6 080 to 562 ms (web); second screen
  893 to 353 ms, 1 008 to 249 ms; no miss of reason `dependency` left. Fresh unchanged, as expected.
- **Effort:** small (three shared files and their tests). **Risk:** the store holds a few more records (19 instead
  of 14 here), within its 192 MB bound. Three cache unit tests expect format 1 and fail on the prototype.

### 5.2 Join identical builds; draw the gallery after the preview

- **Prototype** ("Prototype: join identical preview builds, draw thumbnails after, warm up"; `hmi-preview-port.ts`):
  a build identical to one running joins it; the gallery starts after the builds running when it was asked for.
- **Measured.** No gain on this 14-core machine (fresh 17.2 s, within the noise); the second screen got slower
  (627 ms) because its link queued behind the gallery, which now runs later.
- **Inferred.** The duplicate work (header, core, library twice) ran on otherwise idle workers here, so it was off the
  critical path; with fewer clang workers it would not be. **Not measured** on such a machine. The joining is what
  the warm-up (5.6) needs.

### 5.3 (a) Persist the compiled StandardWidgets archive

- **Measured.** STruC++ compiles StandardWidgets in 365 to 397 ms in the app (489 ms median in Jest); loading the
  archive back from its 648 KB of JSON takes 1.5 ms in Jest (`standard-widgets-archive-timing.test.ts`; that figure
  may benefit from STruC++'s own caching, but even a plain `JSON.parse` of 648 KB is a few ms).
- **Inferred.** Not on the click-to-frame path when the screen is opened after the project has loaded (the language
  server compiles it first), so it gains nothing for the first build in these runs; it removes a 0.4 s UI stall at
  project open.
- **Not prototyped** as a persisted store: the gain is bounded by the measurement above, so no store mechanism (a
  third record type in the object store, or a file next to it) was built.

### 5.4 (b) Build the fixed parts with the editor and seed the cache

- **Prototype** (spec option `FB_SEED`; commit "Timing spec: seed the object store before a fresh session" on the
  web): the store records of the fixed units, taken from a fresh run of the same build, copied into a new profile's
  store before the editor starts (desktop) or written into IndexedDB before the page loads (web): what a seed shipped
  with the editor and copied on first use would give. Fixed units: precompiled header (when used), `hmi_core.c`,
  `hmi_theme.c`, `hmi_math.c`, `hmi_raster.c`, `hmi_text.c`, the font table, the preview host and both variants of
  `library.cpp`.
- **Measured.** With the header: first build 16.6 to 4.1 s (desktop), 15.1 to 4.1 s (web); 10 records, 15.5 MB,
  8.9 MB gzip, of which the header 14.5 MB (8.6 MB gzip). Without the header (5.7): 3.2 s (desktop) and 5.1 s (web,
  1.9 s of it the toolchain download from localhost); 9 records, 1.06 MB, 0.3 MB gzip. What remains is the project's
  own units (the screens, `glue.cpp`, `factory.cpp`).
- **Inferred, validity.** A record is used only when the toolchain identity (digest of `clang --version`), its key
  (compiler, flags, source path, header digest) and the digest of every file it read all match; the WebAssembly clang
  is the same on every OS, so one seed serves macOS, Windows, Linux and the web. A seed goes stale harmlessly (it
  misses) when STruC++'s runtime headers, the HMI core sources, the fonts, the flags or the toolchain change, so it
  has to come from the editor's own build of the same sources. `library.cpp` depends on the PLC libraries' constants
  (section 4); the seed covers the default libraries.
- **Effort:** medium: a build step that runs the shared preview build in Node with the pinned toolchain on a
  reference request and writes the records; an extra resource (desktop) and versioned static assets (web); seeding
  the store on first use. **Risk:** download and install size (+0.3 MB without the header, +9 MB with it); trust as
  in 6.5.

### 5.5 (c) Keep the last finished preview

- **Prototype** ("Prototype: keep linked modules and read the store at toolchain start"; `compile-to-wasm.ts`,
  `wasm-compile-service.ts`): instead of a per-project "last preview" shown while a background build checks it, the
  linked module is kept in the object cache under a digest of the whole compile request (every file, unit and flag).
  An identical request then needs no compile and no link, so there is nothing to check: the same inputs give the same
  module. The service also reads the stored objects as soon as the toolchain's files are ready (editor start, page
  load), then lets the probe's worker go, instead of on the first build.
- **Measured.** Restart after a normal session 743 to 361 ms (desktop), build total 75 ms, the lookup itself 15 ms;
  second screen 356 ms (desktop), 236 ms (web). On the web the restart did not improve (562 to 594 ms): on the dev
  server the store is often still being read when the screen is clicked. Linked module 0.48 to 0.55 MB (150 to
  170 KB gzip).
- **Inferred.** Showing a stale module while rebuilding would help only when the cache misses (an editor update),
  needs the designer to accept a stale module, and raises the trust question of 6.5; after 5.1 and this, the restart
  is about 0.4 s, so it is not worth it now.
- **Effort:** small. **Risk:** one more record per distinct request, within the store's bound.

### 5.6 (d) Warm up when a project with HMI screens opens

- **Prototype** (same commit as 5.2; `use-hmi-warmup.ts`, on when `localStorage['openplc.hmiWarmup']` is `1`): once
  the project and its PLC libraries are loaded, the workspace builds the project's preview in the background, holding
  the toolchain so it may use several workers; the HMI editor's identical build joins it (5.2).
- **Measured (desktop).** Screen opened at once: no gain (15.5 s; the warm-up started about 0.7 s before the click).
  Screen opened 8 s after the project: 16.6 to 7.6 s. The warm-up build took 14.8 to 17.5 s on a fresh profile; on a
  warm cache the screen opens in about 0.6 s. **Not measured** on the web.
- **Inferred.** It hides as much of the first build as the user spends elsewhere first; after 5.7 and the seed that
  is the remaining 3 s. **Risk:** CPU and memory at project open; only for projects with screens, at low priority,
  and it must yield to a build the user asked for.

### 5.7 Other bottlenecks the measurements showed

- **The precompiled header is a net loss.** Probe ("Probe: compile the preview without a precompiled header",
  `build-hmi-preview.ts`): each C++ unit force-includes the header's text (`-include`) instead. **Measured:** fresh
  8.6 s instead of 14 to 16.5 s (desktop), 10.1 s instead of 15.1 s (web); per unit, without the header, the screens
  take 1.1 to 1.3 s (desktop) and 0.78 s (web), against 1.4 to 1.5 s and 0.6 to 0.8 s with it, measured inside the
  same fresh builds; the store shrinks from 16.9 to 2.4 MB and reading it from about 105 to 20 ms. **Not measured:**
  the time to rebuild after editing one screen, in isolation; the per-unit numbers above suggest no loss, and the
  follow-up has to check it on a larger project. **Inferred:** the header costs 3.7 to 6.7 s up front and saves at
  most a few hundred ms per unit; each job also posts the 14.5 MB header to its worker.
- **Identity probe.** Each session's first build spawned a clang worker to run `clang --version` (about 230 ms on
  desktop; on a fresh web profile, the wait for the download). 5.5 moves it to toolchain start; an identity taken from
  the pinned toolchain package would avoid the worker. **Inferred** gain about 0.2 s.
- **UI thread.** STruC++ runs on the renderer's or page's main thread: StandardWidgets once (0.4 s), then the unit at
  each build (about 20 ms here).

## 6. Storing build artefacts in the project file (AC4)

The developer's original idea: save what the build produced into the project and load it on the next open.

### 6.1 What would be stored, measured

| Artefact | Raw | gzip | As base64 in a JSON project |
| --- | ---: | ---: | ---: |
| Every compiled object of this project, with the header (both variants) | 15.8 to 16.9 MB | about 9 MB | 21 to 22.5 MB (about 12 MB if gzipped first) |
| of which the precompiled header | 14.5 MB | 8.6 MB | 19.3 MB |
| Every compiled object, without the header (5.7) | 1.4 MB | not measured | about 1.9 MB |
| Only the linked preview module | 0.48 to 0.55 MB | 150 to 170 KB | 0.65 to 0.73 MB |

### 6.2 Web: one JSON envelope per project

**Verified in code** (`project-adapter.ts`, web): opening a project downloads the whole envelope; every save, and
every single-file save, first GETs the whole envelope and then POSTs it back whole (the endpoint deletes by
omission); every file is a string. Artefacts in the project would therefore travel three times per save (the open,
then GET and POST on each save), as base64, 0.7 MB (module only) to 22 MB (all objects with the header) each way,
and be kept in Edge's S3 and the project's git history (`gitPath`).

### 6.3 Version control noise

**Inferred.** The objects of the screen units, `glue.cpp`, `factory.cpp` and the linked module change with every
screen edit; the core and library objects change with every editor update. Each commit of a project would carry
binary churn of 0.5 to 16 MB, and two people's branches would conflict on files nobody can merge.

### 6.4 Staleness

**Verified in code.** Objects are valid only for the exact toolchain (digest of `clang --version`), flags, STruC++
runtime headers and HMI core sources. **Inferred:** any editor update touching one of them turns stored artefacts into
dead weight that is rebuilt anyway; a project opened in an older editor carries artefacts it cannot use. The
per-machine cache already gives the same benefit to whoever built them, without these costs.

### 6.5 Trust

**Verified in code:** the object cache and the compile service are shared by the HMI preview, the OpenPLC Simulator
and the Runtime v4 HMI artefact (`hmi.wasm`, uploaded to the device and run by its browser clients): `pipeline.ts`
compiles through the same `compileToWasm` on desktop and web. **Inferred:** objects loaded from a project, that is
from whoever last saved it, into that cache could link a crafted object into a module deployed to a PLC's HMI, with
nothing showing the user that it does not match the sources. A preview module on its own runs sandboxed (WebAssembly
in a Worker, 128 MB memory cap), so there the risks left are a misleading preview and resource use. Therefore:

- a seed built with the editor (5.4) carries the editor's own trust, and must be read only from the installed
  application (desktop) or the app's own origin under versioned names (web), never from a project or a location
  other users can write;
- objects compiled on the machine (5.1, 5.5) are as trusted as the profile they live in, as today;
- artefacts from a project file must never enter the shared cache; if ever used, only as a stale preview in the
  sandboxed Worker while a local build replaces it, and never for a simulator or Runtime v4 build.

**Conclusion:** do not store build artefacts in the project file. Everything it would give is available from the
per-machine cache and an editor-built seed, without the size, noise, staleness and trust costs.

## 7. Recommended strategy (AC5)

In order. Gains are this investigation's click-to-frame medians on a 14-core machine under load, desktop / web.

1. **Keep several variants per compiled unit** (5.1). Restart after a normal session 7.9 s to 0.74 s / 6.1 s to
   0.56 s; second screen 0.9 s to 0.35 s / 1.0 s to 0.25 s. Small effort, low risk; a correctness fix of the cache
   that every later step relies on.
2. **Drop the preview's precompiled header** (5.7). First build ever 16.5 s to 8.6 s / 15.1 s to 10.1 s; the store
   shrinks from 16.9 to 2.4 MB and the seed of step 4 from 15.5 to 1.06 MB. Small effort; the risk is the edit
   rebuild time, which the task must measure on a larger project before it lands.
3. **Keep the linked module, read the store at toolchain start, take the toolchain identity from its package**
   (5.5, 5.7). Restart 0.74 s to 0.36 s on desktop; the web gains when the store is read before the click. Small
   effort, low risk.
4. **Ship a seed of the fixed parts with the editor** (5.4). With steps 1 to 3: first build ever 8.6 s to 3.2 s /
   10.1 s to 5.1 s, for 0.3 MB gzip. Medium effort; trust handled by reading the seed only from the application.
5. **Warm up when a project with HMI screens opens** (5.6, with 5.2's joining). Hides what is left of the first build
   (3 s after step 4) for users who do anything else first: on desktop, 8 s spent elsewhere saved 8 s. Small to
   medium effort; nothing must change for projects without screens.
6. **Later, if still wanted:** persist the StandardWidgets archive (5.3, 0.4 s UI stall at project open).

On the web, a real first visit also downloads 27 MB of toolchain (gzip), which none of the above changes; it is
started at page load, so step 5 overlaps it too. Not recommended: storing build artefacts in the project file
(section 6); showing a stale module while rebuilding (5.5), worth under 0.4 s after steps 1 and 3.

## 8. Proposed follow-up tasks

1. **Keep several compiled-object variants per unit in the WebAssembly toolchain cache.** In the shared
   `wasm-toolchain` code of both repositories, let the session cache and the persistent store keep several objects
   per unit key, identified by the digests of the files each was built from, so the HMI preview, the palette's
   gallery and a widget-block preview stop evicting each other's `library.cpp`, `glue.cpp` and `factory.cpp`. Bump
   the record format (old records dropped once), keep the size bound, update the unit tests, and add an e2e check
   that a restart after a session that drew the palette compiles no unit.
2. **Build the HMI preview without a precompiled header.** Replace the precompiled header of the preview request
   (`build-hmi-preview.ts`) with a force-included header, after measuring on a large project (many screens and
   widget blocks) the first build and the rebuild after editing one screen, with and without it, on desktop and
   web; keep the header only if the rebuild after an edit is clearly slower without it. Both repositories.
3. **Reuse the linked module and load the object store at toolchain start.** Key each linked module by a digest of
   its whole compile request and keep it in the object cache, so an unchanged preview, simulator or HMI artefact
   request needs no compile or link; read the stored objects when the toolchain's files are ready instead of on the
   first build; derive the toolchain identity from the pinned package instead of a `clang --version` worker. Shared
   code, both repositories.
4. **Ship a seed of the HMI preview's fixed objects with the editor.** Add a build step that runs the shared preview
   build in Node with the pinned WebAssembly toolchain on a reference request and writes the store records of the HMI
   core, the font table, the preview host and StandardWidgets (and the header, if task 2 keeps it); ship them as an
   extra resource of the desktop package and as versioned static assets of the web build; copy them into the store
   on first use when missing; read them only from the application itself. Include a size budget and an e2e check
   that a fresh profile compiles only the project's own units.
5. **Warm up the HMI preview when a project with screens opens.** Once a project with HMI screens and its PLC
   libraries are loaded, build its preview in the background at low priority, holding the toolchain while it runs;
   let the HMI editor join that build instead of starting another, and draw the palette's gallery after the first
   preview. Nothing happens for projects without screens; an e2e check opens a screen a few seconds after the project
   and expects a frame within a bound.
6. **Persist the compiled StandardWidgets archive** (lower priority). Keep the STruC++ archive of StandardWidgets in
   the per-machine store, keyed by its sources and the STruC++ version, so project open no longer compiles it on the
   UI thread.

## 9. Reproducing

Editor worktree, after the install and build steps of the editor CLAUDE.md ("Electron e2e"):

```bash
FB_RUN=1 FB_OUT=/path/results.jsonl npx playwright test e2e/hmi-first-build-timing.spec.ts --workers=1
# options: FB_SEED=<folder of .obj store records>, FB_WARMUP=1, FB_DELAY_MS=8000, FB_DUMP_REQUESTS=1 (desktop)
```

Web worktree (Playwright starts its dev servers): the same command with `--project=chromium`; `FB_SEED` reads the
same records. A seed folder is the fixed units' records of a fresh run's store (`<userData>/User/WasmObjects`).

## 10. Follow-up DOPE-896: what was built, and the numbers after it

Reading guide as above. The investigation sections 1 to 9 describe the state of 2026-11-19; this section describes the
code on the DOPE-896 branch (editor and web), after the HMI widgets moved to the pinned openplc-hmi-widgets release.

### 10.1 Final design

- **Content-keyed object cache** (5.1), **no precompiled header** (5.7), **linked module kept and store read at
  toolchain start** (5.5), **toolchain identity from the pinned package**: as recommended in section 7.
- **Widget libraries compile alone.** Each library that declares widgets compiles from a whole unit generated from its
  `.stlib` and its dependencies (`backend/shared/library/library-unit.ts`, HMI wrapper `hmi/lib-object/library-unit.ts`),
  so a library gives one object in every project, preview and `hmi.wasm`. Libraries come from the archives the project
  uses (bundled `vendor/hmi-widgets/` plus the libraries it lists), as 12f loads them. Dependencies are passed to STruC++
  before the library: STruC++ declares the libraries in the order given, and a dependency declared after its user does
  not compile (seen with `plcopen-softmotion` and `oscat-basic`).
- **Per-library preview factory.** The preview factory has one table per widget library, generated from the library
  alone and compiled with it (`<library>_factory.cpp`), a table of the project's widget blocks, and a dispatcher that
  numbers the tables one after another (`hmi/unit/preview-factory.ts`). The live elements' code (`hmi_preview_live.cpp`)
  compiles against the library that declares `HmiScreen` (`hmi_preview_widgets.hpp`), so it is shipped too.
- **Objects next to the library (make-style).** A library's unit carries a tag; its key is a digest of the archive, its
  dependencies' archives, the kind (`hmi`, `hmi-factory`, `simulator`), the unit's flags and the provided header
  versions (the HMI core API). The compile service offers the object kept for the library when the key and toolchain
  match, and writes back the object a build used when it differs; the cache still checks every file the object was built
  from, so a stale object is never linked. Desktop: `<userData>/libraries/<name>/<name>.<kind>.wasm-object` next to a
  user-installed `.stlib`; web: IndexedDB `openplc-library-objects` (the browser has no folder next to a library).
  Bundled libraries keep nothing there; they use the shipped objects.
- **Shipped objects.** `build:hmi-objects` builds from the pinned release archives and the fixed preview units: HMI
  core, font tables, hosts, live elements, each widget library and its factory table, and the OpenPLC Simulator units
  of the bundled PLC libraries. 24 objects, 2.7 MB, the same names in both repositories. A set for another toolchain is
  ignored, and an object whose sources changed (another core API, another STruC++ runtime) misses: both compile instead.
- **Simulator libraries split out.** Only the simulator build asks STruC++ for `separateLibraryFiles`; each reached
  library, and its dependencies, compiles from its own whole unit (`compile/steps/simulator-library-units.ts`, under
  `simlib/`). Runtime v3/v4, baremetal and the debug compile keep their output.
- **Web defect fixed on the way.** The web glob of the pre-installed widget archives was resolved against Vite's root
  (`src/`), so the page had no widget library and every HMI preview failed ("No library of the project declares an HMI
  widget"). It is now relative to the module (`bundled-stlibs.ts`).

### 10.2 HMI preview first build, measured

Click-to-frame, ms, Apple M4 Pro, the timing specs of section 9, three runs each, before and after run one after the
other at a 1-minute load of 4 to 7. "Before" is the branch right after merging 12f (widget library units and shipped
objects already in place); "after" adds the per-library factory tables, the shipped live-elements unit and the objects
kept next to each library.

| Case | Desktop before | Desktop after | Web before | Web after |
| --- | ---: | ---: | ---: | ---: |
| First build ever (fresh profile) | 3 480, 3 243, 3 241 | 3 272, 3 524, 3 277 | 6 090, 6 047, 6 124 | 6 082, 6 062, 6 058 |
| Restart | 374 to 392 | 345 to 387 | 247 to 267 | 242 to 501 |
| Second screen, same session | 341 to 362 | 338 to 346 | 224 to 234 | 232 to 240 |

- **Measured.** No change in click-to-frame on either platform. What a first build compiles is the project's own units,
  before and after: two screens, `glue.cpp` and the factory group (4 units). The factory group went from 2.9 s to 1.25 s
  (desktop) and from 3.3-3.6 s to 1.7 s (web), but it was never alone on the critical path: on desktop the four units
  run on four workers and the screens and glue take 2.5 to 3.0 s each; on the web's two workers the jobs run in two
  rounds (glue and a screen at about 3.2 s, then the other screen and the factory group at about 1.7 s).
- **Measured.** An empty factory group (no project widget blocks, no library header) still takes 1.7 s on the web: most
  of a job's time there is per-job overhead, not code.
- **Inferred.** What is left of the web first build (about 6 s, of which about 4.9 s is compile) is bounded by the number
  of project units per worker and the per-job cost, no longer by library code. Fewer units on a first build (for
  example one unit for all of a project's screens until the first edit) or more workers would be the next levers; not
  done.

`tests/hmi-preview/run.ts` (real toolchain, four threads): first build with the shipped objects 1.74 s, compiling only the
project's units; cold build with nothing cached 7.5 s; single-screen rebuild 0.9 s.

### 10.3 OpenPLC Simulator build, measured

Through `openplc-cli compile` (a fresh process per build, one clang worker), fresh profile, then two one-line program
edits. Wall-clock ms; in parentheses the units compiled and reused.

| Project | First build before | First build after | Rebuild before | Rebuild after |
| --- | ---: | ---: | ---: | ---: |
| TON, CTU and standard functions | 16 692 (23, 0) | 13 722 (24, 1) | 10 120, 10 955 (12 compiled) | 10 906, 9 997 (12 compiled) |
| The same with a 40-block user library | 15 331 (23, 0) | 17 140 (25, 1) | 10 366, 10 238 (12 compiled) | 9 865, 9 711 (12 compiled) |

With the user library's object kept next to its archive and the object store emptied, the next build reused both
library units (the shipped `iec_standard_fb` and the kept user library): 25 files, 2 reused, 16.0 s.

Per unit, with a warm four-thread runner (`compileToWasm` on the same requests): first build 3.0 s before and 3.6 s after
(the whole `iec_standard_fb` unit takes 1.0 s when not shipped, the 40-block user library 1.2 s); rebuild 1.2 s in both.
On one warm thread: first build 7.4 s, rebuild 2.9 s.

- **Measured.** A one-line program edit recompiled no library code before this change either: STruC++ put the reached
  library chunks in `configuration.cpp`, which a body edit does not change. What a rebuild compiles, before and after, is
  `pou_MAIN.cpp` and the eleven runtime units that include `defines.h` through `openplc.h`; `defines.h` carries the
  program's MD5, which changes on every edit.
- **Measured.** The CLI's rebuild is 9.7 to 10.9 s for about 2.9 s of compile on one thread: the rest is the clang
  worker's start in a fresh process, about 6 s.
- **Inferred.** Splitting the libraries out gains on a first build only when the bundled libraries' objects are shipped
  (TON/CTU: about 3 s here), costs a whole-library compile once per user library (then kept next to it), and gains
  nothing on rebuilds. The levers for the simulator's rebuild are the MD5 in `defines.h` (moving it to its own unit would
  leave eleven runtime units cached) and the clang worker's start for each Play.

### 10.4 Not done or not measured

- Simulator Play, click to live values, fresh profile (the `wasm-simulator-play` specs): desktop 32.0 and 29.4 s
  before, 28.6 and 28.5 s after; web 10.69 and 10.69 s before, 10.78 and 10.77 s after. **Not measured:** why Play takes
  about three times longer on the desktop than on the web.
- Library projects: a library project's widgets are the project's widget blocks, compiled with the project; nothing
  compiles its `build/<name>.stlib`, so nothing is kept next to it.
