// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Compile-time feature switches shared by both IDEs (mirrored file).
 *
 * `DATATYPES_DT_FILES` gates the per-type data type persistence
 * (`datatypes/<Name>.dt`, DOPE-385). It gates the **write** side only —
 * `.dt` files are always read when present, so a build with the flag
 * off still opens a migrated project and its next save writes the
 * legacy `project.json` form back. That makes turning the flag off a
 * round trip rather than a data-loss event.
 *
 * Injected per build (Vite `define` / webpack `DefinePlugin`) rather
 * than hard-coded, so `development` and `main` carry identical source
 * and "on in staging, off in production" is a deploy setting. A branch
 * that has to be edited during promotion is a branch someone forgets
 * to edit.
 *
 * Undefined in un-injected builds (unit tests, any bundler that skips
 * the define) — those read as off. Exposed as a function rather than a
 * bare constant so call sites stay mockable in tests.
 */
const dataTypeFilesEnabled = typeof DATATYPES_DT_FILES !== 'undefined' && DATATYPES_DT_FILES

export const isDataTypeFilesEnabled = (): boolean => dataTypeFilesEnabled
