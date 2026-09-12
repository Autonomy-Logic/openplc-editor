/**
 * The breadcrumb trail, one case per `EditorModel` type.
 *
 * The trail used to identify the Device branch by matching the single string
 * 'Configuration' against `meta.name`, so every other screen under it fell
 * through to a "Resource" label. The fix keys off `editor.type` instead, which
 * makes the property worth pinning a table: every member of the union reaches
 * the trail it should, and only the Resource screen says "Resource".
 */

import { render } from '@testing-library/react'

type EditorLike = { type: string; meta: Record<string, unknown> }

let editor: EditorLike

// Mocked through the @root alias rather than a relative path: Jest resolves a
// mock path relative to its setup file, so a relative one works under Vitest and
// fails here. The alias resolves to the same module in both runners.
vi.mock('@root/frontend/store', () => {
  const state = () => ({
    editor,
    project: { meta: { name: 'Irrigation Controller' }, data: { dataTypes: [], globalVariableLists: [] } },
    workspace: { isDebuggerVisible: false, fbDebugInstances: new Map(), fbSelectedInstance: new Map() },
    workspaceActions: { setFbSelectedInstance: () => {} },
  })
  const useOpenPLCStore = (selector?: (s: unknown) => unknown) => (selector ? selector(state()) : state())
  useOpenPLCStore.getState = state
  return { useOpenPLCStore }
})

import { Breadcrumbs } from '../index'

/** The trail as text, in order. */
function trail(model: EditorLike): string[] {
  editor = model
  const { container, unmount } = render(<Breadcrumbs />)
  const crumbs = Array.from(container.querySelectorAll('span')).map((span) => span.textContent ?? '')
  unmount()
  return crumbs
}

describe('the Device tree branch', () => {
  // The bug: only 'Configuration' was recognised, by name, so its siblings were
  // all labelled "Resource".
  it.each([
    ['configuration', 'Configuration'],
    ['pin-mapping', 'Pin Mapping'],
    ['orchestrators', 'Orchestrators'],
    ['runtime-status', 'Runtime Status'],
  ])('trails %s as Project > Device > screen', (derivation, name) => {
    expect(trail({ type: 'plc-device', meta: { name, derivation } })).toEqual(['Irrigation Controller', 'Device', name])
  })

  it.each([
    ['plc-persistent-storage', 'Persistent Storage'],
    ['plc-user-management', 'User Management'],
  ])('trails %s under Device too', (type, name) => {
    expect(trail({ type, meta: { name } })).toEqual(['Irrigation Controller', 'Device', name])
  })
})

describe('screens that sit under no branch', () => {
  // Two segments rather than a made-up parent: a vendor screen sits at the
  // project root beside the Device branch, and the managers are opened from the
  // workspace rather than the tree.
  it.each([
    ['plc-vendor-screen', 'Modbus Setup'],
    ['plc-package-manager', 'Package Manager'],
    ['plc-library-manager', 'Library Manager'],
  ])('trails %s as Project > screen', (type, name) => {
    expect(trail({ type, meta: { name, screenName: name } })).toEqual(['Irrigation Controller', name])
  })

  it('trails the library manifest as Project > Manifest', () => {
    expect(trail({ type: 'plc-library-manifest', meta: { name: 'library.json' } })).toEqual([
      'Irrigation Controller',
      'Manifest',
    ])
  })
})

describe('the rest of the union', () => {
  it('trails a server under Servers', () => {
    expect(trail({ type: 'plc-server', meta: { name: 'MB1', protocol: 'modbus-tcp' } })).toEqual([
      'Irrigation Controller',
      'Servers',
      'MB1',
    ])
  })

  it('trails a remote device under Remote Devices', () => {
    expect(trail({ type: 'plc-remote-device', meta: { name: 'RD1', protocol: 'modbus-tcp' } })).toEqual([
      'Irrigation Controller',
      'Remote Devices',
      'RD1',
    ])
  })

  it('trails an EtherCAT slave under its bus', () => {
    expect(trail({ type: 'plc-ethercat-device', meta: { name: 'Drive1', busName: 'Bus0', deviceId: 'd1' } })).toEqual([
      'Irrigation Controller',
      'Remote Devices',
      'Bus0',
      'Drive1',
    ])
  })

  it('trails a diff tab under Source Control, by path', () => {
    expect(trail({ type: 'diff-viewer', meta: { name: 'Diff: pous/Main.st', filePath: 'pous/Main.st' } })).toEqual([
      'Irrigation Controller',
      'Source Control',
      'pous/Main.st',
    ])
  })

  it('trails a POU by its type', () => {
    expect(trail({ type: 'plc-textual', meta: { name: 'Main', pouType: 'program', language: 'st' } })).toEqual([
      'Irrigation Controller',
      'Program',
      'Main',
    ])
  })

  it('still says Resource for the Resource screen — the one place it is right', () => {
    expect(trail({ type: 'plc-resource', meta: { name: 'Resource' } })).toEqual(['Irrigation Controller', 'Resource'])
  })

  it('renders nothing when no tab is really open', () => {
    // Previously this rendered a "Resource" trail for a document that does not
    // exist.
    editor = { type: 'available', meta: { name: 'available' } }
    const { container } = render(<Breadcrumbs />)
    expect(container.firstChild).toBeNull()
  })
})
