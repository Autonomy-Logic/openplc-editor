/**
 * Single source of truth for the OpenPLC application version, SHARED
 * byte-for-byte between openplc-web and openplc-editor.
 *
 * This file lives under `src/frontend/`, so the mirror gate
 * (`scripts/compare-surfaces.py`, run by `ci-sync.yml`) byte-compares it
 * across both repos — the two IDEs can never display different versions.
 * Bumping the version is a single edit here, carried identically into both
 * repos by the coordinated mirror PR.
 *
 * Consumers:
 *  - the About modal renders this directly (both apps);
 *  - the web build writes it into `version.json` (`version` field);
 *  - the editor's electron-builder reads `package.json.version`, kept equal
 *    to this value by `release.yml`.
 *
 * NOTE: this is the human-facing semver only. The web "force update" check
 * compares a per-deploy `BUILD_ID` (git commit SHA), not this version, so a
 * stale tab is detected on every deploy even without a version bump.
 */
export const APP_VERSION = '4.2.8'
