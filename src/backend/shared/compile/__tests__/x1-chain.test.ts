/**
 * X1 (metade do editor) — o image.conf que o editor emite bate com o projeto.
 *
 * Monta os produtores pelo STORE, que e o caminho do usuario, e emite o
 * arquivo pelo mesmo gerador do pipeline. O outro lado da cadeia -- o core
 * alocando e os plugins logando -- roda no runtime em container.
 */
import { writeFileSync } from 'fs'
import { createStore } from 'zustand/vanilla'

import type { BoardInfo, ModbusIOGroup, PLCRemoteDevice } from '../../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../../../../frontend/store/slices/console'
import { createDeviceSlice } from '../../../../frontend/store/slices/device'
import { createEditorSlice } from '../../../../frontend/store/slices/editor'
import { createLibrarySlice } from '../../../../frontend/store/slices/library'
import { createProjectSlice } from '../../../../frontend/store/slices/project/slice'
import type { ProjectSliceRoot } from '../../../../frontend/store/slices/project/types'
import { computeIoImage, IMAGE_AREAS_RUNTIME_V4 } from '../steps/compute-io-image'
import { generateImageConf } from '../steps/generate-image-conf'

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

it('X1 — image.conf reflete os produtores montados pelo store', () => {
  const s = makeStore()
  s.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map<string, BoardInfo>([['OpenPLC Runtime v4', RUNTIME_V4]]),
  })
  s.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')

  const cur = s.getState().project
  s.setState({ project: { ...cur, data: { ...cur.data, remoteDevices: [device('Dev1')] } } })
  s.getState().projectActions.addIOGroup('Dev1', group('g1', 6)) // 6 pontos %IW

  const compileReady = s.getState().projectActions.getCompileReadyProjectData()
  // Reshaped here rather than through the editor's `toIpcProjectData`: that
  // adapter is editor-only and this file lives on the shared surface, so
  // importing it would not resolve in the web build. Only the two fields the
  // sizer reads are needed, and the rename (`configurations` -> `configuration`)
  // is the one the adapter performs.
  const forSizer = {
    ...compileReady,
    configuration: (compileReady as unknown as { configurations: unknown }).configurations,
  }
  const img = computeIoImage({
    projectData: forSizer as never,
    capabilities: { pinMapping: false, vppIo: true, modbusTcpRemote: true, ethercat: true } as never,
    serverCapabilities: { modbusTcpServer: true, opcuaServer: true, s7Server: true },
    areas: IMAGE_AREAS_RUNTIME_V4,
  })
  const conf = generateImageConf(img.sizes)
  writeFileSync('/tmp/claude-1000/x1-image.conf', conf)
  const naoZero = conf.split('\n').filter((l) => /=\s*[1-9]/.test(l))
  // eslint-disable-next-line no-console
  console.log(`[X1] editor: ${JSON.stringify(img.sizes)} | image.conf: ${naoZero.join(', ')}`)
  expect(img.sizes['%IW']).toBe(6)
  expect(conf).toContain('int_input=6 words')
})
