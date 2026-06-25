/**
 * Tests for the per-project-type capability matrix.
 *
 * Capability flags drive sidebar / menu / project-tree visibility.
 * Drift between the matrix and the consumers shows up here as a
 * test break before it ships as a "why does my library project show
 * a debugger button" bug.
 */

import { isLibraryProject, projectCapabilities } from '../types'

describe('isLibraryProject', () => {
  it('returns true for plc-library', () => {
    expect(isLibraryProject({ type: 'plc-library' })).toBe(true)
  })

  it('returns false for plc-project', () => {
    expect(isLibraryProject({ type: 'plc-project' })).toBe(false)
  })

  it('returns false for null / undefined (no project loaded yet)', () => {
    expect(isLibraryProject(null)).toBe(false)
    expect(isLibraryProject(undefined)).toBe(false)
  })
})

describe('projectCapabilities for plc-project', () => {
  const caps = projectCapabilities({ type: 'plc-project' })

  it('includes every standard project-shape branch', () => {
    expect(caps.hasPrograms).toBe(true)
    expect(caps.hasResource).toBe(true)
    expect(caps.hasDevices).toBe(true)
    expect(caps.hasServers).toBe(true)
    expect(caps.hasRemoteDevices).toBe(true)
    expect(caps.hasVendorScreens).toBe(true)
  })

  it('shows program build + runtime / debug affordances', () => {
    expect(caps.hasProgramBuild).toBe(true)
    expect(caps.hasLibraryBuild).toBe(false)
    expect(caps.hasDebugger).toBe(true)
    expect(caps.hasRuntimeControls).toBe(true)
    expect(caps.hasVersionControl).toBe(true)
  })

  it('does not show the library manifest tab', () => {
    expect(caps.hasLibraryManifest).toBe(false)
  })
})

describe('projectCapabilities for plc-library', () => {
  const caps = projectCapabilities({ type: 'plc-library' })

  it('hides every program / device / runtime affordance', () => {
    expect(caps.hasPrograms).toBe(false)
    expect(caps.hasResource).toBe(false)
    expect(caps.hasDevices).toBe(false)
    expect(caps.hasServers).toBe(false)
    expect(caps.hasRemoteDevices).toBe(false)
    expect(caps.hasVendorScreens).toBe(false)
    expect(caps.hasProgramBuild).toBe(false)
    expect(caps.hasDebugger).toBe(false)
    expect(caps.hasRuntimeControls).toBe(false)
    expect(caps.hasVersionControl).toBe(false)
  })

  it('shows the library-specific affordances', () => {
    expect(caps.hasLibraryBuild).toBe(true)
    expect(caps.hasLibraryManifest).toBe(true)
  })
})

describe('projectCapabilities default (no project loaded)', () => {
  // No project = treat as plc-project defaults so the start screen
  // and other pre-load surfaces don't accidentally render with the
  // library-restricted set.
  it('falls through to plc-project capabilities for null / undefined', () => {
    const nullCaps = projectCapabilities(null)
    const undefCaps = projectCapabilities(undefined)
    const baseline = projectCapabilities({ type: 'plc-project' })
    expect(nullCaps).toEqual(baseline)
    expect(undefCaps).toEqual(baseline)
  })
})
