// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
import { isDataTypeFilesEnabled } from '../feature-flags'

describe('feature flags', () => {
  it('ships with the .dt data type persistence switched off', () => {
    // Flipped to true by the DOPE-385 release PR; until then every
    // build must behave exactly like the legacy project.json format.
    expect(isDataTypeFilesEnabled()).toBe(false)
  })
})
