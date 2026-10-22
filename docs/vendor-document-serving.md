# Vendor document serving (`vpp-doc://`)

Some vendor packages ship a browser application (for example an I/O configurator) that the editor
embeds in an iframe. On desktop the main process serves those files under a custom scheme:

```
vpp-doc://<packageId>/<path inside the package>
```

- Registration: `protocol.registerSchemesAsPrivileged` at module top of `src/main/main.ts`
  (`standard`, `secure`, `supportFetchAPI`), and `protocol.handle` inside `whenReady`, before the
  main window is created.
- Handler: `src/main/modules/vendor-document/serve.ts`.
- URL builder: `buildVendorDocumentUrl` in `src/middleware/shared/vendor-document/document-url.ts`,
  exposed to the UI as `DevicePort.getVendorDocumentUrl(packageId, relPath)`.
- Web host: the adapter returns `<Edge API base>/devices/<vPLC id>/vpp/files/<relPath>`, the Edge
  route next to the vPLC's archive route, only for the selected vPLC's own package and only when
  `VITE_VPP_DOCUMENT_ROUTE_ENABLED=true`. Otherwise, and always on the Node host, it returns `null`
  and the screen says the configurator is not available in this host yet.
- Supported bundle: Weidmüller Device Editor 3.5.22 (u-OS 2.2 and later). The screen JSON records it
  in `bundleVersion`; the relay protocol version (`RELAY_PROTOCOL_VERSION`) must match the packaged
  `relay.js` or the screen refuses the bundle.

## What the handler guarantees

- The package id is resolved only through the installed-package registry. An unregistered id is 404.
- A `standard` scheme lowercases the host, so the id travels lowercased and is matched without case.
  Two registered ids that differ only by case are refused as ambiguous (404).
- Every requested file is resolved with `realpath` and must stay inside that package's directory, so
  `..` segments, encoded separators and symlinks leaving the package are 404.
- Only regular files are served; a directory is 404, never a listing. Only `GET` is accepted (405).
- `/esbuild` is 404. The vendor bundle probes its development server there and would otherwise reload.
- Explicit MIME map (`html`, `js`, `css`, `svg`, `json`, `png`, `woff`, `woff2`); anything else is
  `application/octet-stream`, with `X-Content-Type-Options: nosniff`.
- Every response carries this Content-Security-Policy:

  ```
  default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; worker-src 'self' blob:;
  connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;
  form-action 'none'
  ```

- A frame showing a package document cannot navigate outside its package: the main window's
  `will-frame-navigate` handler cancels it (`leavesVendorDocument` in `serve.ts`). CSP has no directive
  for a frame navigating itself, so this is the only guard against sending data out that way. In a
  browser host no page can cancel that navigation; only the served CSP applies there.

## The iframe sandbox

The host renders the document in `<iframe sandbox="allow-scripts allow-forms">`. **Never add
`allow-same-origin`.** Without it the document runs in an opaque origin: it cannot read the host's
DOM, storage, cookies or `window.bridge`, and its requests carry no host credentials. With it, a
document served from a package could reach the editor's preload bridge and everything behind it.
The host talks to the document only through the postMessage relay in
`src/middleware/shared/vendor-document/` and never touches `iframe.contentWindow` globals.

## The `vendor-document` screen section

A VPP screen embeds the document with a section of layout `vendor-document`
(`vendor-screen/layouts/configurator-screen.tsx`). The configurator and its I/O Mapping are two screens
of the board, the configurator first:

```json
"screens": {
  "Backplane Configuration": "screens/backplane.json",
  "I/O Mapping": "screens/io-mapping.json"
}
```

The configurator screen holds the one section, which fills the screen (at least 640 px, since the
vendor draws the backplane at a fixed scale):

```json
{
  "id": "configurator",
  "layout": "vendor-document",
  "document": "configurator/index.html",
  "bundleVersion": "3.5.22",
  "controllers": { "<device board name>": "<controller type id>" }
}
```

- All three fields are required; a section missing one renders nothing. A board not listed in
  `controllers` gets a refusal that names the supported boards.
- The section always persists to `configurator` (a `persistence` value is ignored: the build reads the
  archive from that key). It also owns `device-setup`,
  `module-configuration` and `io-mapping`, so dirty tracking, save and "Don't save" cover all four
  (`collectScreenPersistenceKeys`).
- Screens with a `vendor-document` section or an `io-table` section with `source: "device-setup"` are linked
  (`collectLinkedScreenKeys`): each owns the keys of all of them, a pending change marks every open
  linked tab unsaved, a save from either writes all keys and marks both saved, and "Don't save" from
  either restores all keys. A linked tab opened later takes the saved state of one already open.
  When the stored archive changes to one the guest neither loaded nor delivered (a "Don't save" from
  the I/O Mapping tab, for example), the configurator boots a fresh guest from the store.
- Boot (`src/frontend/utils/vpp/configurator-session.ts`): `ready` → `setController` → `show` →
  `load(stored archive)` → compare the loaded module guids with the stored `device-setup`. A mismatch
  or a rejected load fails the screen and writes nothing, so the stored archive is kept. An empty
  archive is never loaded.
- The guest fires `modified` for its own boot calls too: Device Editor 3.5.22 fires twice during
  `setController` and once per `setProject`, some after the call resolves. So `modified` is ignored
  until the guest has been quiet for the settle time after boot. After that, a `modified` is a user
  change, snapshotted once events settle, and written by
  `applyConfiguratorSnapshot` in one store update: `configurator` `{archive, controller, bundleVersion}`
  (archive byte-for-byte), `device-setup` (the modules in bus order), `module-configuration.slots` (the
  manifest module id of each slot, matched by exact `typeId`; `null` when the type is not in the
  manifest catalogue) and `io-mapping.entries`. The entries come from the manifest channels of each
  slot through the module-slots allocation rule (`allocateModuleSlots`): an alias is kept when the
  same slot holds the same module id, and dropped aliases are reported in a toast. The configurator's
  datapoints are not read.
- A failed snapshot is retried with backoff, up to `SNAPSHOT_ATTEMPTS` (3) per pending change, then
  reported once; the change stays pending and the tab unsaved, and the next change starts over.
- The dirty compare hashes the archive (`src/frontend/utils/vpp/owned-slice.ts`); `cleanState` keeps it
  whole for the revert.
- Every open vendor-screen tab stays mounted, hidden while inactive (`vendor-screen-tabs.tsx`), so
  switching tabs keeps the iframe and its session: a change still settling when the user leaves the
  tab is delivered. Closing the tab unmounts it; reopening replays the boot from the stored data.

## The read-only I/O Mapping screen section

The I/O Mapping for a configurator-driven station is an `io-table` section with `source: "device-setup"`
(`vendor-screen/layouts/device-setup-io-table.tsx`), alone on its own screen:

```json
{
  "id": "io-mapping",
  "title": "I/O Mapping",
  "layout": "io-table",
  "source": "device-setup",
  "persistence": "io-mapping"
}
```

- It reads `device-setup` (module groups in slot order, by instance name), `module-configuration` and
  `io-mapping` (channels and addresses), the keys the `vendor-document` section writes, and owns them
  whatever `persistence` says. It runs no allocation on mount.
- A slot whose `module-configuration` id is `null` shows a "Not in catalogue" badge and no rows. Saving
  stays allowed; an `io-ranges` build refuses that station.
- It is read-only: no slot picker, add, remove, clear, reorder, mode or parameter controls, and any
  `actions` on the section are ignored. The station is changed only in the configurator.
- The Alias cell is the one write: `validateAliasEdit` gates it, `renameAlias` cascades a rename onto
  bound variables, and the session alias memory is keyed by module id, slot and channel name (`vppMemoryKey`).

## Plugin hand-off

A device with `hal.pluginConfigFormat: "io-ranges"` gets an `io-ranges` plugin config
(`src/backend/shared/utils/vpp/generate-io-ranges-plugin-config.ts`) instead of `slots`:

- Each channel's bus offset is the sum of the `processImage` bytes of the earlier slots in its direction
  plus its own module-relative `wire`; its PLC position is its `io-mapping` address. Channels of one
  module, kind and direction that are contiguous on both sides merge into one range.
- The build refuses a station with a slot not in the catalogue, a module without `processImage`, or a
  channel without `wire`.
- The stored archive (hex) is written as `conf/<pluginName>.station.bin` next to `conf/<pluginName>.json`,
  which names it in `configuration_archive` with its `configuration_sha256`. Without an archive the
  plugin starts with a blank project and the build log says so.

## End-to-end tests

`e2e/vendor-configurator.spec.ts` (editor) drives the embedded configurator with a fake Device Editor:
add a module, switch to the I/O Mapping screen at once and check its channels and addresses there, set
an alias, switch back and find the same iframe (not booted again), reopen and find the alias kept, check
the stored `module-configuration` and `io-mapping`, and check that the sandboxed guest reaches nothing
of the host.

- The relay (`src/middleware/shared/vendor-document/relay.ts`) and the fake bundle
  (`src/__fixtures__/fake-device-editor/`) are bundled with webpack into `relay.js` and `index.js` by
  `e2e/fixtures/vendor-configurator/build-package.ts`, next to `index.html`; `guest-device-editor.ts`
  also runs the sandbox probes. The fixture manifest carries a catalogue for the fake's module types.
- The fixture package is unsigned, so the spec replaces the `packages:verify-signatures` handler with a
  no-op after the bridge registers it. Signature checking in the app is unchanged.
- openplc-web has no e2e for it: the browser accepts only packages signed with the production key.

## Building the packaged relay

`npm run build:relay` bundles `installWindowRelay(window)` into `release/relay/relay.js`
(`-- --out <dir>` writes elsewhere). A vendor package ships that file under `configurator/`, loaded by
its `index.html` before the vendor bundle.
