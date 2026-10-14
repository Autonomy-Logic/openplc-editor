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
  exposed to the UI as `DevicePort.getVendorDocumentUrl(packageId, relPath)`. The web adapter returns
  `null`: the browser host has no package-file route yet.

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
  connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:
  ```

## The iframe sandbox

The host renders the document in `<iframe sandbox="allow-scripts allow-forms">`. **Never add
`allow-same-origin`.** Without it the document runs in an opaque origin: it cannot read the host's
DOM, storage, cookies or `window.bridge`, and its requests carry no host credentials. With it, a
document served from a package could reach the editor's preload bridge and everything behind it.
The host talks to the document only through the postMessage relay in
`src/middleware/shared/vendor-document/` and never touches `iframe.contentWindow` globals.

## The `vendor-document` screen section

A VPP screen embeds the document with a section of layout `vendor-document`
(`vendor-screen/layouts/configurator-screen.tsx`):

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
- `persistence` defaults to `configurator`. The section also owns `device-setup` and `io-mapping`, so
  dirty tracking, save and "Don't save" cover all three (`collectScreenPersistenceKeys`).
- Boot (`src/frontend/utils/vpp/configurator-session.ts`): `ready` → `setController` → `show` →
  `load(stored archive)` → compare the loaded module guids with the stored `device-setup`. A mismatch
  or a rejected load fails the screen and writes nothing, so the stored archive is kept. An empty
  archive is never loaded.
- The guest fires `modified` twice for `show` and once per `setProject`; those are counted off. Any
  other `modified` is a user change, snapshotted once events settle, and written by
  `applyConfiguratorSnapshot` in one store update: `configurator` `{archive, controller, bundleVersion}`
  (archive byte-for-byte), `device-setup`, and `io-mapping` derived from the datapoints with aliases
  carried over by `datapointId`.
- The dirty compare hashes the archive (`src/frontend/utils/vpp/owned-slice.ts`); `cleanState` keeps it
  whole for the revert.
- Switching tabs unmounts the iframe; reopening replays the boot from the stored data.

## The `datapoint-io-table` screen section

The I/O Mapping for a configurator-driven station is a section of layout `datapoint-io-table`
(`vendor-screen/layouts/datapoint-io-table-layout.tsx`). It takes no fields beyond `id` and `title`:

```json
{ "id": "io-mapping", "title": "I/O Mapping", "layout": "datapoint-io-table" }
```

- It reads `device-setup` (modules, in slot order) and `io-mapping` (channels and addresses), the keys
  the `vendor-document` section writes, and owns both whatever `persistence` says.
- It is read-only: no slot picker, add, remove, clear, reorder, mode or parameter controls, and any
  `actions` on the section are ignored. The station is changed only in the configurator.
- The Alias cell is the one write: `validateAliasEdit` gates it, `renameAlias` cascades a rename onto
  bound variables, and the session alias memory is keyed by `datapointId`.
