// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Compile-time feature switches shared by both IDEs (mirrored file).
 *
 * `DATATYPES_DT_FILES` gates the per-type data type persistence
 * (`datatypes/<Name>.dt`, DOPE-385): the write path and the read
 * preference both key off it, so a build with the flag off behaves
 * exactly like the legacy project.json format in every scenario.
 * Flip the constant in the release PR once the whole DOPE-385 series
 * has landed.
 *
 * Exposed as a function rather than a bare constant so call sites
 * stay mockable in tests (both flag states need coverage).
 */
const DATATYPES_DT_FILES = false

export const isDataTypeFilesEnabled = (): boolean => DATATYPES_DT_FILES
