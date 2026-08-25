// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project

/** Re-import the module so it re-reads the injected global at load time. */
const loadFlags = async () => {
  jest.resetModules()
  return import('../feature-flags')
}

describe('feature flags', () => {
  const injectFlag = (value: boolean) => Reflect.set(globalThis, 'DATATYPES_DT_FILES', value)

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'DATATYPES_DT_FILES')
  })

  it('reads .dt data type persistence as off when the build injects nothing', async () => {
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(false)
  })

  it('is on when the build injects it', async () => {
    injectFlag(true)
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(true)
  })

  it('is off when the build injects it false', async () => {
    injectFlag(false)
    const { isDataTypeFilesEnabled } = await loadFlags()
    expect(isDataTypeFilesEnabled()).toBe(false)
  })
})
