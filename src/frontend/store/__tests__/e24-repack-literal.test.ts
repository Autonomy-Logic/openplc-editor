/**
 * E24 da bancada — variavel com literal nao acompanha o repack.
 *
 * Duas variaveis sobre o MESMO canal: uma ligada pelo alias, outra escrita
 * como literal. Um produtor novo entra e dispara o repack. O contraste entre
 * as duas e a evidencia: se as duas acompanharem, o modelo mudou; se nenhuma
 * acompanhar, o repack nao rodou e o cenario nao testou nada.
 */
import { createStore } from 'zustand/vanilla'

import type { BoardInfo, ModbusIOGroup, PLCRemoteDevice, PLCVariable } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

const makeStore = () =>
  createStore<ProjectSliceRoot>()((...a) => ({
    ...createProjectSlice(...a),
    ...createDeviceSlice(...a),
    ...createConsoleSlice(...a),
    ...createEditorSlice(...a),
    ...createLibrarySlice(...a),
  }))

const RUNTIME_V4: BoardInfo = {
  compiler: 'openplc-compiler',
  core: 'rt-v4',
  preview: '',
  specs: {},
  capabilities: {
    pinMapping: false,
    vppIo: true,
    modbusTcpRemote: true,
    ethercat: true,
    modbusTcpServer: true,
    opcuaServer: true,
    s7Server: true,
    debuggerTransports: ['websocket'],
    pythonFunctionBlocks: true,
    arduinoApiCompletions: false,
    hasRuntimeStats: true,
    isInProcessSimulator: false,
    directUsbUpload: false,
  },
}

const device = (name: string): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
})
const group = (id: string, length: number): ModbusIOGroup => ({
  id,
  name: `g-${id}`,
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length,
  errorHandling: 'keep-last-value',
  ioPoints: [],
})
const intVar = (name: string, location: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
  location,
  documentation: '',
})

const addDevice = (s: ReturnType<typeof makeStore>, d: PLCRemoteDevice) => {
  const cur = s.getState().project
  s.setState({ project: { ...cur, data: { ...cur.data, remoteDevices: [...(cur.data.remoteDevices ?? []), d] } } })
}
const setPous = (s: ReturnType<typeof makeStore>, pous: unknown[]) => {
  const cur = s.getState().project
  s.setState({ project: { ...cur, data: { ...cur.data, pous: pous as never } } })
}
const locOf = (s: ReturnType<typeof makeStore>, name: string) =>
  (
    s.getState().projectActions.getCompileReadyProjectData() as never as {
      pous: { interface: { variables: PLCVariable[] } }[]
    }
  ).pous[0].interface.variables.find((v) => v.name === name)?.location

describe('E24 — literal nao acompanha o repack', () => {
  it('alias acompanha, literal fica para tras', () => {
    const s = makeStore()
    s.getState().deviceActions.setAvailableOptions({
      availableBoards: new Map<string, BoardInfo>([['OpenPLC Runtime v4', RUNTIME_V4]]),
    })
    s.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')

    // Produtor B primeiro, para o repack ter o que reordenar quando A entrar.
    addDevice(s, device('DevB'))
    s.getState().projectActions.addIOGroup('DevB', group('gb', 2))
    const pb = s.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
    s.getState().projectActions.updateIOPointAlias('DevB', 'gb', pb, 'sinalB')

    const antes = s.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].iecLocation
    // eslint-disable-next-line no-console
    console.log(`[E24] endereco inicial do ponto B = ${antes}`)

    setPous(s, [
      {
        name: 'main',
        pouType: 'program',
        interface: { variables: [intVar('porAlias', 'sinalB'), intVar('porLiteral', antes)] },
        body: { language: 'st', value: '' },
        documentation: '',
      },
    ])

    expect(locOf(s, 'porAlias')).toBe(antes)
    expect(locOf(s, 'porLiteral')).toBe(antes)

    // Entra um modulo VPP, que na ordem canonica vem ANTES do Modbus
    // (pinos -> VPP -> Modbus), entao empurra os pontos do device.
    s.getState().deviceActions.setVendorScreenData('io-mapping', {
      entries: [
        // Endereco REAL, e colidindo com o ponto Modbus: o registry migra
        // estado existente, entao um canal sem endereco nao registra nada
        // (seedChannel devolve null). Com VPP em %IW0 e Modbus tambem em
        // %IW0, a ordem canonica (pinos -> VPP -> Modbus) da %IW0 ao VPP e
        // empurra o Modbus.
        { slot: 0, moduleId: 'mod', channelName: 'ch0', iecAddress: '%IW0', alias: '' },
        { slot: 0, moduleId: 'mod', channelName: 'ch1', iecAddress: '%IW1', alias: '' },
      ],
    })
    // O gatilho central do repack — o que as telas de produtor chamam ao salvar.
    s.getState().projectActions.recalculateIecAddresses()

    const depois = s.getState().project.data.remoteDevices!.find((d) => d.name === 'DevB')!.modbusTcpConfig!.ioGroups[0]
      .ioPoints![0].iecLocation
    // eslint-disable-next-line no-console
    console.log(
      `[E24] apos o repack: ponto B = ${depois} | porAlias = ${locOf(s, 'porAlias')} | porLiteral = ${locOf(s, 'porLiteral')}`,
    )

    if (depois === antes) {
      throw new Error(`repack nao rodou (ponto continua em ${antes}) — o cenario nao testou nada`)
    }
    expect(locOf(s, 'porAlias')).toBe(depois) // alias acompanha
    expect(locOf(s, 'porLiteral')).toBe(antes) // literal fica para tras
  })
})
