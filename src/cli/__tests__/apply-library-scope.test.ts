/**
 * `apply` on a Library Project with a `device` section used to report "saved"
 * and write nothing: the board went into the store, and a library's save
 * writes no `devices/` folder. A library targets a core, recorded in
 * `library.json`, so the section is refused before anything is applied.
 */

import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { openPLCStoreBase } from '@root/frontend/store'

import { libraryScopeErrors } from '../apply/library-scope'
import type { ApplySpec } from '../apply/schema'

const spec = (extra: Partial<ApplySpec>) => ({ specVersion: 1, ...extra }) as ApplySpec

describe('what a spec may ask of a library project', () => {
  it('refuses a board, and says where a library keeps its target', () => {
    const errors = libraryScopeErrors(spec({ device: { board: 'ESP32-DevKitC' } }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/^device \(board\): a library project has no device/)
    expect(errors[0]).toContain('library.json')
    expect(errors[0]).toContain('"core"')
  })

  it('refuses every other device field too — none of them is saved for a library', () => {
    const errors = libraryScopeErrors(
      spec({ device: { runtimeIpAddress: '10.0.0.5', persistentStorage: { enabled: true } } }),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('runtimeIpAddress, persistentStorage')
  })

  it('refuses servers and remote devices, but not empty lists of them', () => {
    expect(libraryScopeErrors(spec({ servers: [], remoteDevices: [] }))).toEqual([])
    expect(
      libraryScopeErrors(spec({ servers: [{ name: 'mb', protocol: 'modbus' }] } as unknown as Partial<ApplySpec>)),
    ).toEqual([expect.stringMatching(/^servers:/)])
    expect(
      libraryScopeErrors(
        spec({ remoteDevices: [{ name: 'io', protocol: 'modbus-tcp' }] } as unknown as Partial<ApplySpec>),
      ),
    ).toEqual([expect.stringMatching(/^remoteDevices:/)])
  })

  it('passes a spec with nothing device-shaped in it', () => {
    expect(libraryScopeErrors(spec({ pous: [] }))).toEqual([])
  })
})

describe('the premise: a library save writes no device files', () => {
  // If this ever changes, the refusal above has become wrong rather than safe.
  it('omits devices/ for plc-library and keeps it for plc-project', () => {
    const setType = (type: 'plc-project' | 'plc-library') =>
      openPLCStoreBase.setState((state) => ({ project: { ...state.project, meta: { ...state.project.meta, type } } }))

    setType('plc-library')
    const library = Object.keys(buildAllProjectFileContentsPure())
    expect(library.filter((path) => path.startsWith('devices/'))).toEqual([])

    setType('plc-project')
    expect(Object.keys(buildAllProjectFileContentsPure())).toContain('devices/configuration.json')
  })
})
