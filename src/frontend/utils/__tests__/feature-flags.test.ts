// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project

/** Re-import the module so it re-reads the injected global at load time. */
const loadFlags = async () => {
  jest.resetModules()
  return import('../feature-flags')
}

describe('feature flags', () => {
  const globals = globalThis as { DATATYPES_DT_FILES?: boolean }

  afterEach(() => {
    delete globals.DATATYPES_DT_FILES
  })

  it('reads .dt data type persistence as off when the build injects nothing', async () => {
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(false)
  })

  it('is on when the build injects it', async () => {
    globals.DATATYPES_DT_FILES = true
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(true)
  })

  it('is off when the build injects it false', async () => {
    globals.DATATYPES_DT_FILES = false
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(false)
  })
})
