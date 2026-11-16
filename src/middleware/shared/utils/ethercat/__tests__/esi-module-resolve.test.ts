import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { ESIDevice, ESIModule } from '@root/middleware/shared/ports/esi-types'

import { findModuleByIdent, identsEqual, resolveEsiModule } from '../esi-module-resolve'

const mod = (ident: string): ESIModule => ({ ident, name: ident, rxPdo: [], txPdo: [], initCmds: [] })

describe('identsEqual', () => {
  test('compares numerically across notations and zero padding', () => {
    expect(identsEqual('0x000A1FC1', '0xa1fc1')).toBe(true)
    expect(identsEqual('#x00000230', '560')).toBe(true)
    expect(identsEqual('0x1A0F', '0x1A10')).toBe(false)
    expect(identsEqual('junk', 'junk')).toBe(false)
  })

  test('findModuleByIdent uses the numeric comparison', () => {
    expect(findModuleByIdent([mod('0x00091F84')], '0x91f84')?.ident).toBe('0x00091F84')
  })
})

describe('resolveEsiModule', () => {
  const device = (modules: ESIModule[]): ESIDevice => ({
    type: { productCode: '0x1', revisionNo: '0x1', name: 'coupler' },
    name: 'coupler',
    fmmu: [],
    syncManagers: [],
    rxPdo: [],
    txPdo: [],
    modules,
  })
  const port = (
    devices: Array<ESIModule[] | 'fail'>,
    standalone?: ESIModule,
  ): Pick<EsiPort, 'loadDeviceFull' | 'loadModuleFull'> => ({
    loadDeviceFull: (_id, i) => {
      const d = devices[i]
      if (d === 'fail' || d === undefined) return Promise.reject(new Error('boom'))
      return Promise.resolve({ success: true, device: device(d) })
    },
    loadModuleFull: () =>
      Promise.resolve(standalone ? { success: true, module: standalone } : { success: false, error: 'none' }),
  })

  test('finds a module carried inline by a later device after an earlier one fails', async () => {
    const p = port(['fail', [mod('0x80000041')]])
    const r = await resolveEsiModule(p, { id: 'w', devices: [{}, {}] }, '0x80000041')
    expect(r?.ident).toBe('0x80000041')
  })

  test('falls back to the module-only file', async () => {
    const p = port([], mod('0x00091F84'))
    expect((await resolveEsiModule(p, { id: 'u', devices: [] }, '0x00091F84'))?.ident).toBe('0x00091F84')
  })

  test('undefined when nothing carries it', async () => {
    expect(await resolveEsiModule(port([[mod('0x1')]]), { id: 'x', devices: [{}] }, '0x2')).toBeUndefined()
  })
})
