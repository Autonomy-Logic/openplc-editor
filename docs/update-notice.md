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
| Newer version found           | A thin blue banner across the top of the window, under the title bar, says "A new version of OpenPLC Editor is available: X", with **Update** and an **X**. No dialog.                                                                                                                                |
| X clicked                     | The banner hides until the editor is opened again, or until the user checks from the menu.                                                                                                                                                                                                            |
| Update clicked                | Windows and macOS: the installer is downloaded to the Downloads folder. Linux: a save dialog asks where to put the new AppImage. Its sha256 is checked against the release and it is opened. The banner shows the progress, then **Open Installer** to open it again.                                 |
| After opening                 | Windows: the installer runs; macOS: the disk image opens; Linux: the new AppImage is shown in its folder (running it now would only meet this editor's single-instance lock). A dialog says what is left to do, with **Quit Now** (the ordinary quit, unsaved-project prompt included) and **Later**. |
| Manual "Check for Updates"    | Always answers with a dialog: up to date, a newer version with **Download / Later**, or an error with the download page.                                                                                                                                                                              |
| Offline, proxy, GitHub down   | Nothing is shown; the error goes to the log.                                                                                                                                                                                                                                                          |
| sha256 mismatch, or no digest | The file is deleted (or not downloaded) and the user is sent to the releases page.                                                                                                                                                                                                                    |
| Download stalls               | After 30 s with no data the download is given up, the partial file deleted, **Update** comes back and the user is offered the download page.                                                                                                                                                          |
| Open Installer, file gone     | The installer is downloaded again. If it is there but cannot be opened, the user is told where it is and offered the download page.                                                                                                                                                                   |

The banner lives in the shared renderer
(`frontend/components/_organisms/update-banner`, mounted by `AppLayout`,
byte-identical on openplc-web) and reads `AppUpdatePort`
(`middleware/shared/ports/app-update-port.ts`). The editor adapter talks to
`index.ts` over `app-update:get-status`, `app-update:status`,
`app-update:download` and `app-update:dismiss`; the web has no adapter, so it
never shows the banner.

"Check for Updates" and "Check for Updates Automatically" are in both File
menus: the native one (`src/main/menu.ts`, macOS and Linux) and the in-app one
(`menus/file.tsx`, Windows, where the native File menu is hidden). The in-app
items go through the same port (`checkNow`, `isAutoCheckEnabled`,
`setAutoCheck`, over `app-update:check`, `app-update:get-auto-check` and
`app-update:set-auto-check`); on the web, Check for Updates stays disabled.

## The Windows installer

The Windows `.exe` used to be a one-click installer: it installed and launched
the editor with no window at all, which broke when the editor was already open
and made some users think it was the editor itself. It is now an ordinary
installer (`nsis` in `electron-builder.json`, `assets/installer.nsh`):

- a welcome page, the licence (`LICENSE`, GPLv3), the progress and a finish
  page that can launch the editor;
- installed per user, as before, so it replaces the existing installation; no
  folder choice;
- when the editor is open, it asks the user to save their work and close it,
  with Retry and Cancel. It never closes the editor itself (electron-builder's
  default would kill it and lose unsaved work).

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
