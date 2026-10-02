# Auto-update

> Jira: [DOPE-486](https://autonomylogic.atlassian.net/browse/DOPE-486) ·
> Requirements: [DOPE-486 - Desktop Editor auto-updater - Requirements Gathering](https://autonomylogic.atlassian.net/wiki/spaces/CD/pages/304513025)

The desktop editor updates itself on **macOS** and **Linux (AppImage)**. It is
off on Windows until the Windows installers are code-signed.

Read the first section before tagging anything: a release is no longer a
download page, it is a push to every installed editor.

## A release reaches the whole fleet

Every editor from **4.1.0** on embeds `resources/app-update.yml` (electron-builder
infers it from the git remote) and runs electron-updater. So the first release
that carries `latest-mac.yml` / `latest-linux*.yml` is downloaded and installed
by every macOS and Linux editor out there, including the ones that predate this
feature, which run the old boilerplate `checkForUpdatesAndNotify()`.

Two consequences shape everything below:

- **There is no rollback.** electron-updater never installs an older version,
  and deleting a release does not undo it on machines that already installed
  it. A bad release is fixed by publishing a newer, fixed one.
- **Windows metadata must never be published** until Windows is signed.
  Windows editors up to now have no `publisherName` in their `app-update.yml`,
  so they would install whatever a `latest.yml` pointed to without checking a
  signature.

## How the editor behaves

All of it lives in `src/main/modules/updater/`: `update-service.ts` holds the
rules and is tested without Electron, `index.ts` wires Electron in.

| Situation                        | What happens                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start-up                         | One check about 60 s after launch, none after that while the editor stays open. None at all when "Check for Updates Automatically" is off.                                                                                                                         |
| Update found                     | Downloaded in the background if the editor can write where it is installed. Otherwise the user is told once per version, with a link to the releases page.                                                                                                         |
| Download finished                | A blue **Update to X** button appears at the right of the status bar, on the start screen and in the workspace. No dialog. On macOS only after Squirrel reports the update ready.                                                                                  |
| Update button, or Restart Now    | Goes through the quit coordinator. Unsaved work is asked about first; with nothing unsaved it restarts without the "quit?" confirmation, since the user just asked for it. Cancelling the unsaved prompt keeps the editor open, and a later plain quit only quits. |
| Button ignored                   | The update installs when the editor is next quit.                                                                                                                                                                                                                  |
| Offline, proxy, GitHub down      | Nothing is shown. Errors go to the log.                                                                                                                                                                                                                            |
| Manual check                     | Always answers with a dialog: up to date, downloading (then "Restart Now / Later" once it is ready), ready, being rolled out, or an error with the download page.                                                                                                  |
| Install fails                    | Detected on the next starts (see below), then that version is never offered again and the user is told once.                                                                                                                                                       |
| Windows                          | No checks. "Check for Updates" opens the releases page.                                                                                                                                                                                                            |
| Development build                | No checks.                                                                                                                                                                                                                                                         |
| macOS from a DMG or translocated | No checks; a manual check asks to move the app to Applications.                                                                                                                                                                                                    |
| Linux without `$APPIMAGE`        | No checks; a manual check points to the download page.                                                                                                                                                                                                             |

The status bar lives in the shared renderer (`frontend/components/_organisms/status-bar`,
byte-identical on openplc-web) and reads `AppUpdatePort`
(`middleware/shared/ports/app-update-port.ts`). The editor adapter talks to
`index.ts` over `app-update:get-status`, `app-update:status` and
`app-update:install`; the web has no adapter, so it never shows the button.

Preferences and bookkeeping are in electron-store: `auto_update_check` (the
menu toggle, read at start-up) and `update_state` (`notifiedVersion`,
`pendingVersion`, `installAttempts`, `failedVersion`).

### Why the install path looks the way it does

- **Linux installs silently and relaunches.** electron-updater's default
  `quitAndInstall` starts the new AppImage before this process exits; the
  single-instance lock (`main.ts`) makes it quit at once, and the user is left
  with no editor. So the service calls `quitAndInstall(true, false)`, which
  installs without launching, then reopens the AppImage from a detached
  `/bin/sh` that waits for this process to exit. Not `app.relaunch`: its helper
  runs from inside the AppImage's FUSE mount, which the AppImage runtime takes
  down as this process exits, so nothing reopens (found on a packaged build).
- **macOS waits for Squirrel.** electron-updater emits `update-downloaded`
  before handing the file to Squirrel.Mac; calling `quitAndInstall` before
  Electron's own `autoUpdater` emits `update-downloaded` waits with the window
  already gone. A 30 s watchdog quits if the install never does.
- **The quit intent belongs to one request.** The renderer never reports a
  dismissed quit prompt, so `requestQuit('install-update')` does not leave a
  flag behind: the next `requestQuit()` is a plain quit again.
- **Failures are inferred, not reported.** On macOS the install happens after
  the process exits; on Linux its error fires while quitting. So a download
  records `pendingVersion`, and each start that still runs an older version
  counts one attempt. After **two** such starts the version is marked failed:
  one could be a crash, because nothing installs on a non-zero exit.

## Release artifacts

`electron-builder.json` names every update artifact without spaces, because
GitHub turns a space into a dot on upload while electron-updater requests a
dash, and a spaced name is a 404 for every client:

| Platform          | Update artifact                                         | Metadata                      |
| ----------------- | ------------------------------------------------------- | ----------------------------- |
| macOS arm64 / x64 | `OpenPLC-Editor-<version>-<arch>.zip` + `.zip.blockmap` | `latest-mac.yml` (both archs) |
| Linux x64         | `OpenPLC-Editor.AppImage`                               | `latest-linux.yml`            |
| Linux arm64       | `OpenPLC-Editor-ARM64.AppImage`                         | `latest-linux-arm64.yml`      |

- Names are set at build time and never renamed afterwards: the metadata records
  the name electron-builder wrote.
- The AppImage name carries **no version**, so electron-updater replaces the
  file in place and desktop shortcuts keep working. An AppImage whose name has a
  version is renamed on every update instead. Editors on 4.3.2 and earlier have
  versioned names, so their first update moves to the new name once.
- `dmg.writeUpdateInfo` is `false`: the DMGs users download are rebuilt by
  `create_dmg.sh`, so the electron-builder DMG never reaches the release and
  must not appear in `latest-mac.yml`.
- The DMGs and the Windows installers are unchanged, and keep the names the
  website's download buttons (`mapAssetToOS` in autonomy-website) rely on.

## Releasing

1. Bump the version as the `CLAUDE.md` section says.
2. **Tag `vX.Y.Z-rc.1`** on `main`. The rc is published as a prerelease with no
   stage: only editors already running an rc receive it (stable builds ignore
   prereleases). Test it on macOS arm64, macOS x64 and Linux: install the
   previous rc, let it update, check the Update button, unsaved-project prompt,
   and the checks in the next section.
3. **Keep the rc release.** `release-gate` refuses a stable `vX.Y.Z` without a
   published `vX.Y.Z-rc.N`.
4. **Tag `vX.Y.Z`.** After the builds, `create-release` waits for approval in
   the `release` environment, then `scripts/verify-release-assets.js` checks the
   exact set of files about to be uploaded and refuses the release when:

   - any metadata `url`, `sha512` or `size` does not match its file;
   - a Windows `latest.yml` or an `*.exe.blockmap` is present;
   - a metadata file has no artifact, or an artifact no metadata (Linux ARM64
     may be missing, but only together with its metadata);
   - the website would show zero or two downloads for an OS;
   - any file is not on the allowed list.

   It is created as a draft with every file attached, then published, so no
   client sees it half uploaded. Stable releases start at `stagingPercentage: 1`.

5. **Canary check.** Machines marked as canaries (below) are always inside the
   first stage. Confirm they updated, including an older macOS install.
6. **Widen the stage** with the "Raise Release Stage" workflow: 10, then 50,
   then 100. Each run rewrites `stagingPercentage` in the release's
   `latest-*.yml`; 100 removes the field. Editors re-read it on every check,
   which is once per launch, so a wider stage reaches them as they reopen.

The smallest stage is 1% of the real install base, not only the canaries:
electron-updater reads the field as an integer.

During a stage, editors outside it are told "vX is being rolled out" on a
manual check, not "up to date".

### Marking a canary machine

electron-updater places each install in the rollout by the last 4 bytes of the
UUID in `<userData>/.updaterId` (`percentage = uint32 / 0xffffffff`). A UUID
ending in `00000000` is inside every stage above 0.

Write it with **no trailing newline**: the file is read without trimming and
checked against an anchored pattern, and an invalid id is silently replaced by
a random one.

```bash
# macOS
printf '%s' '3f1c2a9e-7b4d-4c1a-8e2f-a1b200000000' > "$HOME/Library/Application Support/open-plc-editor/.updaterId"
# Linux
printf '%s' '3f1c2a9e-7b4d-4c1a-8e2f-a1b200000000' > "$HOME/.config/open-plc-editor/.updaterId"
```

The folder is `app.getPath('userData')`, named after `name` in
`release/app/package.json` (`open-plc-editor`), not the product name. Then check
the editor log (`<userData>/logs/main.log`) for `Staging percentage: …, user id:
3f1c2a9e-…00000000`: a "Generated new staging user ID" line instead means the
file was rejected and replaced.

## Repository settings this relies on

The workflow references them; a repository admin has to create them.

- **`release` environment** with required reviewers, and a deployment policy
  limited to `v*` tags. `create-release` and "Raise Release Stage" run in it.
- **A tag ruleset** restricting who may create `v*` tags. This is the control
  that matters: the workflow that runs is the one in the tagged commit, so
  anyone who can push a `v*` tag can edit it, drop `environment:` and publish
  with `GITHUB_TOKEN`. An environment on its own protects nothing.
- **Signing secrets inside an environment** limited to `v*` tags, not in the
  repository. On macOS this is a second barrier: Squirrel.Mac only installs an
  update signed by the installed app's Team ID. Linux AppImage updates have no
  signature check, so there the tag ruleset is the only barrier.

## Testing locally (Linux)

Point two builds at a local feed with a build-time `publish` override, so
nothing reaches GitHub:

```bash
npm run build
npx electron-builder --linux AppImage --x64 --publish never \
  -c.extraMetadata.version=9.0.0 -c.publish.provider=generic -c.publish.url=http://localhost:8080/
mkdir -p /tmp/feed-a && cp release/build/OpenPLC-Editor.AppImage /tmp/feed-a/
npx electron-builder --linux AppImage --x64 --publish never \
  -c.extraMetadata.version=9.0.1 -c.publish.provider=generic -c.publish.url=http://localhost:8080/
(cd release/build && python3 -m http.server 8080) &
/tmp/feed-a/OpenPLC-Editor.AppImage
```

- **Old-client path:** extract a released AppImage (`--appimage-extract`), edit
  `squashfs-root/resources/app-update.yml` to the generic feed above, and run
  `squashfs-root/AppRun` with `APPIMAGE` set to a copy of the original file.
- **Negative control:** change one character of `sha512` in the served
  `latest-linux.yml`; the download must be refused and nothing installed.
- **Driving it:** the flow ends in native dialogs and a process that exits and
  reopens, so Playwright is the wrong tool. Its `--inspect` keeps the old
  process alive at exit, holding the single-instance lock, and it kills its
  process group, relaunched editor included. Run the AppImage on a virtual
  display instead (`Xvfb :97`), with `HOME`, `XDG_CONFIG_HOME` and
  `XDG_CACHE_HOME` pointed at a scratch directory, so neither your settings nor
  your `openplc-cli` shim are touched. Without a window manager the window opens
  at 800x600 and the editor shows its "mobile" screen; resize it from any X
  client.
