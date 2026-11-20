# Package trust test fixtures

- `com.openplc.fx3u-compatible-2.1.0.vpp`: the catalog package as published, signed by Autonomy (key id
  `openplc-2026`); it provides the board "FX3U-14M / LE3U-14M".
  - Source: `https://api.autonomylogic.com/vpp-catalog/v1/packages/com.openplc.fx3u-compatible-2.1.0.vpp`
  - sha256: `8a949877a1ee0e48cfc3fc9f6efff2e106b0aecd3b1fec9050de858c679e3fa6` (466,964 bytes)
- `sign-test-package.ts`: signs a synthetic package directory (by default `com.example.untrusted` under the throwaway key
  `untrusted-dev`), with options to set the key id and alter files after signing; zips a directory into a `.vpp`; extracts
  the fx3u fixture.
- `trust-test-kit.ts`: trust modules generated for a throwaway test key, the module under test with the real key
  (`OPENPLC_TRUST_MODULE_UNDER_TEST` names a generated module file, with `layout.json` beside it), site
  neutralization and recording mechanisms.

Every key here is a throwaway test key; none signs a real package.
