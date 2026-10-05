# Update notice

The desktop editor tells the user when a newer version is out and, if they
want it, downloads the installer for their computer and opens it (DOPE-486).
It is the same on Windows, macOS and Linux. The editor never installs anything
itself: the user runs the installer, exactly as after downloading it from the
website.

## How it behaves

All of it lives in `src/main/modules/updater/`: `update-service.ts` holds the
rules and is tested without Electron, `release-assets.ts` picks the installer,
and `index.ts` wires Electron and the GitHub API in.

| Situation                     | What happens                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start-up                      | One check about 60 s after launch, none after that while the editor stays open. None when "Check for Updates Automatically" (File menu) is off. Never in a development build.                                                                                                                         |
| Newer version found           | A blue **Update to X** button appears at the right of the status bar, on the start screen and in the workspace. No dialog.                                                                                                                                                                            |
| Button clicked                | The installer for this OS and architecture is downloaded to the Downloads folder, its sha256 is checked against the release, and it is opened. The button shows the progress, then **Install X** to open it again.                                                                                    |
| After opening                 | Windows: the installer runs; macOS: the disk image opens; Linux: the new AppImage is shown in its folder (running it now would only meet this editor's single-instance lock). A dialog says what is left to do, with **Quit Now** (the ordinary quit, unsaved-project prompt included) and **Later**. |
| Manual "Check for Updates"    | Always answers with a dialog: up to date, a newer version with **Download / Later**, or an error with the download page.                                                                                                                                                                              |
| Offline, proxy, GitHub down   | Nothing is shown; the error goes to the log.                                                                                                                                                                                                                                                          |
| sha256 mismatch, or no digest | The file is deleted (or not downloaded) and the user is sent to the releases page.                                                                                                                                                                                                                    |

The status bar lives in the shared renderer
(`frontend/components/_organisms/status-bar`, byte-identical on openplc-web) and
reads `AppUpdatePort` (`middleware/shared/ports/app-update-port.ts`). The editor
adapter talks to `index.ts` over `app-update:get-status`, `app-update:status`
and `app-update:download`; the web has no adapter, so it never shows the button.

## Where the version comes from

- **Stable builds** read `GET /repos/Autonomy-Logic/openplc-editor/releases/latest`,
  which never returns a prerelease or a draft.
- **rc and beta builds** (a version with `-`) read the 20 most recent releases
  and take the newest, so an rc hears of the next rc as well as of the stable.
- The installer is picked with the website's rules (`mapAssetToOS` in
  autonomy-website): `-arm64.exe` / `.exe`, `-arm.dmg` / `.dmg`,
  `-arm64.AppImage` / `.AppImage`. A Mac running the Intel build under Rosetta
  (`app.runningUnderARM64Translation`) is offered the Apple silicon `.dmg`, and
  the Intel one only when the release has none; Windows on ARM running the x64
  build stays on x64 until installing ARM64 over it is tested. Only files under
  `https://github.com/Autonomy-Logic/openplc-editor/releases/download/` are
  ever downloaded.
- Integrity: GitHub stores a `sha256:` digest for every uploaded asset and the
  API returns it; the download is hashed while it is written and compared.

The release pipeline needs nothing for this: any release with the usual
installers is found. Unauthenticated API calls are limited to 60 an hour per IP,
far above one check per launch.

## Why not electron-updater

Every editor from 4.1.0 on still embeds `app-update.yml` and could self-update
through electron-updater the moment a release published `latest-*.yml`. That
was the first design and was dropped (feedback, 2026-10-05): updates should be
the user's choice, the flow should be the same on every OS, and the Windows
installers are not signed, so a silent install there was never acceptable.
**Releases must keep not publishing `latest*.yml`**: the 4.1.0-4.3.2 editors in
the field would install it without asking.

## Testing locally

Unit tests: `npx jest --config jest.config.json --no-coverage src/main/modules/updater`.

End to end, against the real releases: package the editor with an older
version, so the latest release is newer than it, and run it isolated.

```bash
npm run build
npx electron-builder --linux AppImage --x64 --publish never -c.extraMetadata.version=4.3.1
mkdir -p /tmp/upd/home && HOME=/tmp/upd/home XDG_CONFIG_HOME=/tmp/upd/config \
  ./release/build/*.AppImage
```

About a minute after start the button appears; clicking it downloads the
latest AppImage into `/tmp/upd/home/Downloads` and checks its sha256. Point
`HOME` at a scratch directory, so neither your settings nor your `openplc-cli`
shim are touched.
