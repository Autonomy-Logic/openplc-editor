import { modbusMemoryKey, vppMemoryKey } from '@root/middleware/shared/utils/iec-address/registry'
import { createStore } from 'zustand/vanilla'

import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'

import type {
  BoardInfo,
  ModbusIOGroup,
  OpcUaNodeConfig,
  OpcUaSecurityProfile,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCBody,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCRemoteDevice,
  PLCServer,
  PLCTask,
  PLCVariable,
  S7CommDataBlock,
} from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString } from '../../utils/generate-iec-variables-to-string'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot, ProjectState } from '../slices/project/types'

function makeStore() {
  // The project slice reads from device + console (alias-sync) plus
  // editor + library (variables-text reconcile in createVariable /
  // updateVariable / deleteVariable). All five are wired here so the
  // cross-slice `ProjectSliceRoot` type resolves and the helpers see
  // a real (default-initialised) editor/library state at test time.
  return createStore<ProjectSliceRoot>()((...args) => ({
    ...createProjectSlice(...args),
    ...createDeviceSlice(...args),
    ...createConsoleSlice(...args),
    ...createEditorSlice(...args),
    ...createLibrarySlice(...args),
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVariable(name: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
  }
}

function makeBody(language: PLCBody['language'] = 'st', value: unknown = ''): PLCBody {
  return { language, value }
}

function makePou(name: string, pouType: PLCPou['pouType'] = 'program', vars: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: makeBody(),
    documentation: '',
  }
}

function makeTask(name: string): PLCTask {
  return { name, triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }
}

function makeInstance(name: string, task = 'Task0', program = 'Main'): PLCInstance {
  return { name, task, program }
}

function makeModbusTcpServer(name: string): PLCServer {
  return {
    name,
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled: false, networkInterface: '0.0.0.0', port: 502 },
  }
}

function makeS7CommServer(name: string): PLCServer {
  return {
    name,
    protocol: 's7comm',
    s7commSlaveConfig: {
      server: {
        enabled: false,
        bindAddress: '0.0.0.0',
        port: 102,
        maxClients: 32,
        workIntervalMs: 100,
        sendTimeoutMs: 3000,
        recvTimeoutMs: 3000,
        pingTimeoutMs: 10000,
        pduSize: 480,
      },
      plcIdentity: {
        name: 'OpenPLC Runtime',
        moduleType: 'CPU 315-2 PN/DP',
        serialNumber: 'S C-OPENPLC01',
        copyright: 'OpenPLC Project',
        moduleName: 'OpenPLC',
      },
      dataBlocks: [],
      logging: { logConnections: true, logDataAccess: false, logErrors: true },
    },
  }
}

function makeOpcUaServer(name: string): PLCServer {
  return {
    name,
    protocol: 'opcua',
    opcuaServerConfig: {
      server: {
        enabled: false,
        name: 'OpenPLC OPC UA Server',
        applicationUri: 'urn:openplc:opcua:server',
        productUri: 'urn:openplc:runtime',
        bindAddress: '0.0.0.0',
        port: 4840,
        endpointPath: '/openplc/opcua',
      },
      securityProfiles: [
        {
          id: 'default-insecure',
          name: 'insecure',
          enabled: true,
          securityPolicy: 'None',
          securityMode: 'None',
          authMethods: ['Anonymous'],
        },
      ],
      security: {
        serverCertificateStrategy: 'auto_self_signed',
        serverCertificateCustom: null,
        serverPrivateKeyCustom: null,
        trustedClientCertificates: [],
      },
      users: [],
      cycleTimeMs: 100,
      addressSpace: { namespaceUri: 'urn:openplc:opcua:namespace', nodes: [] },
    },
  }
}

function makeRemoteDevice(name: string): PLCRemoteDevice {
  return {
    name,
    protocol: 'modbus-tcp',
    modbusTcpConfig: { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
  }
}

function makeDataBlock(dbNumber: number): S7CommDataBlock {
  return {
    dbNumber,
    description: `DB${dbNumber}`,
    sizeBytes: 128,
    mapping: { type: 'input', startBuffer: 0, bitAddressing: false },
  }
}

function makeSecurityProfile(id: string): OpcUaSecurityProfile {
  return {
    id,
    name: `profile-${id}`,
    enabled: true,
    securityPolicy: 'Basic256Sha256',
    securityMode: 'SignAndEncrypt',
    authMethods: ['Username'],
  }
}

function makeOpcUaUser(id: string): OpcUaUser {
  return {
    id,
    type: 'password',
    username: `user-${id}`,
    passwordHash: 'hash',
    certificateId: null,
    role: 'operator',
  }
}

function makeOpcUaNode(id: string): OpcUaNodeConfig {
  return {
    id,
    pouName: 'Main',
    variablePath: 'Main.x',
    variableType: 'INT',
    nodeId: `ns=1;s=${id}`,
    browseName: id,
    displayName: id,
    description: '',
    permissions: { viewer: 'r', operator: 'rw', engineer: 'rw' },
    nodeType: 'variable',
  }
}

function makeTrustedCert(id: string): OpcUaTrustedCertificate {
  return { id, pem: 'PEM-DATA' }
}

function makeIOGroup(id: string, functionCode: ModbusIOGroup['functionCode'] = '3', length = 2): ModbusIOGroup {
  return {
    id,
    name: `group-${id}`,
    functionCode,
    cycleTime: 100,
    offset: '0',
    length,
    errorHandling: 'keep-last-value',
    ioPoints: [],
  }
}

// ---------------------------------------------------------------------------
// Seed store with data
// ---------------------------------------------------------------------------

function seedPou(store: ReturnType<typeof makeStore>, pou: PLCPou) {
  const current = store.getState().project
  store.getState().projectActions.setProject({
    ...current,
    data: { ...current.data, pous: [...current.data.pous, pou] },
  })
}

function seedServer(store: ReturnType<typeof makeStore>, server: PLCServer) {
  const current = store.getState().project
  store.getState().projectActions.setProject({
    ...current,
    data: { ...current.data, servers: [...(current.data.servers ?? []), server] },
  })
}

function seedRemoteDevice(store: ReturnType<typeof makeStore>, device: PLCRemoteDevice) {
  const current = store.getState().project
  store.getState().projectActions.setProject({
    ...current,
    data: { ...current.data, remoteDevices: [...(current.data.remoteDevices ?? []), device] },
  })
}

/** Seed global variables directly (bypassing createVariable's dedup so the
 *  `location` binding is stored verbatim for alias-cascade / compile tests). */
function seedGlobals(store: ReturnType<typeof makeStore>, vars: PLCVariable[]) {
  const current = store.getState().project
  store.getState().projectActions.setProject({
    ...current,
    data: {
      ...current.data,
      configurations: {
        ...current.data.configurations,
        resource: { ...current.data.configurations.resource, globalVariables: vars },
      },
    },
  })
}

/** A BOOL variable whose `location` is set verbatim — an alias name, a literal
 *  `%addr`, or empty — for the single-field location model. */
function locVar(name: string, location: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return { name, class: cls, type: { definition: 'base-type', value: 'BOOL' }, location, documentation: '' }
}

/** Seed a Runtime v4 target so the cap-gated address pool counts
 *  Modbus claims. Producer-edit actions (addIOGroup, updateIOGroup …)
 *  rely on `caps.modbusTcpRemote = true` to count sibling groups when
 *  allocating addresses. */
function seedRuntimeV4Board(store: ReturnType<typeof makeStore>) {
  store.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map<string, BoardInfo>([
      [
        'OpenPLC Runtime v4',
        {
          compiler: 'openplc-compiler',
          core: 'rt-v4',
          preview: '',
          specs: {},
          capabilities: {
            pinMapping: false,
            vppIo: false,
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
        },
      ],
    ]),
  })
  store.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')
}

/** Seed a target that exposes pin mapping AND VPP I/O (plus Modbus), so the
 *  central recalculation reallocates VPP + Modbus. */
function seedVppBoard(store: ReturnType<typeof makeStore>) {
  store.getState().deviceActions.setAvailableOptions({
    availableBoards: new Map<string, BoardInfo>([
      [
        'VPP Board',
        {
          compiler: 'openplc-compiler',
          core: 'rt-v4',
          preview: '',
          specs: {},
          capabilities: {
            pinMapping: true,
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
        },
      ],
    ]),
  })
  store.getState().deviceActions.setDeviceBoard('VPP Board')
}

// ===========================================================================
// Tests
// ===========================================================================

describe('createProjectSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const { project } = store.getState()
    expect(project.meta).toEqual({ name: '', type: 'plc-project', path: '' })
    expect(project.data.pous).toEqual([])
    expect(project.data.dataTypes).toEqual([])
    expect(project.data.configurations.resource.tasks).toEqual([])
    expect(project.data.configurations.resource.instances).toEqual([])
    expect(project.data.configurations.resource.globalVariables).toEqual([])
    expect(project.data.servers).toEqual([])
    expect(project.data.remoteDevices).toEqual([])
  })

  // =========================================================================
  // Project state
  // =========================================================================
  describe('setProject', () => {
    it('replaces the entire project state', () => {
      const newState: ProjectState = {
        meta: { name: 'MyProject', type: 'plc-project', path: '/tmp/proj' },
        data: {
          dataTypes: [],
          pous: [makePou('Main')],
          configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
          servers: [],
          remoteDevices: [],
        },
      }
      store.getState().projectActions.setProject(newState)
      expect(store.getState().project).toEqual(newState)
    })
  })

  describe('setPous', () => {
    it('replaces the pous array', () => {
      const pous = [makePou('A'), makePou('B')]
      store.getState().projectActions.setPous(pous)
      expect(store.getState().project.data.pous).toHaveLength(2)
      expect(store.getState().project.data.pous[0].name).toBe('A')
    })
  })

  describe('clearProjects', () => {
    it('resets project to default state', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.updateMetaName('MyProject')
      store.getState().projectActions.clearProjects()

      const { project } = store.getState()
      expect(project.meta.name).toBe('')
      expect(project.data.pous).toEqual([])
    })
  })

  // =========================================================================
  // Meta
  // =========================================================================
  describe('updateMetaName', () => {
    it('updates the project name', () => {
      store.getState().projectActions.updateMetaName('NewName')
      expect(store.getState().project.meta.name).toBe('NewName')
    })
  })

  describe('updateMetaPath', () => {
    it('updates the project path', () => {
      store.getState().projectActions.updateMetaPath('/new/path')
      expect(store.getState().project.meta.path).toBe('/new/path')
    })
  })

  // =========================================================================
  // POU
  // =========================================================================
  describe('createPou', () => {
    it('creates a program POU', () => {
      const result = store.getState().projectActions.createPou({
        type: 'program',
        data: { language: 'st', name: 'Main', variables: [], body: makeBody(), documentation: '' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous).toHaveLength(1)
      expect(store.getState().project.data.pous[0].name).toBe('Main')
      expect(store.getState().project.data.pous[0].pouType).toBe('program')
    })

    it('creates a function POU with returnType', () => {
      const result = store.getState().projectActions.createPou({
        type: 'function',
        data: {
          language: 'st',
          name: 'Add',
          returnType: 'INT',
          variables: [],
          body: makeBody(),
          documentation: '',
        },
      })
      expect(result.ok).toBe(true)
      const pou = store.getState().project.data.pous[0]
      expect(pou.interface?.returnType).toBe('INT')
    })

    it('creates a function-block POU', () => {
      const result = store.getState().projectActions.createPou({
        type: 'function-block',
        data: { language: 'st', name: 'MyFB', variables: [], body: makeBody(), documentation: '' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].pouType).toBe('function-block')
    })

    it('fails when POU already exists', () => {
      store.getState().projectActions.createPou({
        type: 'program',
        data: { language: 'st', name: 'Main', variables: [], body: makeBody(), documentation: '' },
      })
      const result = store.getState().projectActions.createPou({
        type: 'program',
        data: { language: 'st', name: 'Main', variables: [], body: makeBody(), documentation: '' },
      })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('POU already exists')
      expect(store.getState().project.data.pous).toHaveLength(1)
    })

    it('creates POU with provided variables', () => {
      const vars = [makeVariable('x'), makeVariable('y')]
      store.getState().projectActions.createPou({
        type: 'program',
        data: { language: 'st', name: 'Main', variables: vars, body: makeBody(), documentation: '' },
      })
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(2)
    })

    it('creates POU with no variables when undefined', () => {
      store.getState().projectActions.createPou({
        type: 'program',
        data: { language: 'st', name: 'Main', body: makeBody(), documentation: '' } as never,
      })
      expect(store.getState().project.data.pous[0].interface?.variables).toEqual([])
    })
  })

  describe('updatePou', () => {
    it('updates POU body', () => {
      seedPou(store, makePou('Main'))
      const newBody = makeBody('ld', { rungs: [] })
      store.getState().projectActions.updatePou({ name: 'Main', content: newBody })
      expect(store.getState().project.data.pous[0].body).toEqual(newBody)
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.updatePou({ name: 'NonExistent', content: makeBody() })
      expect(store.getState().project.data.pous[0].body).toEqual(makeBody())
    })
  })

  describe('deletePou', () => {
    it('removes POU by name', () => {
      seedPou(store, makePou('A'))
      seedPou(store, makePou('B'))
      store.getState().projectActions.deletePou('A')
      expect(store.getState().project.data.pous).toHaveLength(1)
      expect(store.getState().project.data.pous[0].name).toBe('B')
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.deletePou('NonExistent')
      expect(store.getState().project.data.pous).toHaveLength(1)
    })
  })

  describe('updatePouDocumentation', () => {
    it('updates POU documentation', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.updatePouDocumentation('Main', 'This is a POU')
      expect(store.getState().project.data.pous[0].documentation).toBe('This is a POU')
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.updatePouDocumentation('NonExistent', 'doc')
      expect(store.getState().project.data.pous[0].documentation).toBe('')
    })
  })

  describe('updatePouReturnType', () => {
    it('updates the return type', () => {
      seedPou(store, makePou('Fn', 'function'))
      store.getState().projectActions.updatePouReturnType('Fn', 'REAL')
      expect(store.getState().project.data.pous[0].interface?.returnType).toBe('REAL')
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Fn', 'function'))
      store.getState().projectActions.updatePouReturnType('Missing', 'REAL')
      expect(store.getState().project.data.pous[0].interface?.returnType).toBeUndefined()
    })

    it('does nothing when POU has no interface', () => {
      const pou: PLCPou = { name: 'NoIface', pouType: 'program', body: makeBody() }
      seedPou(store, pou)
      store.getState().projectActions.updatePouReturnType('NoIface', 'BOOL')
      expect(store.getState().project.data.pous[0].interface).toBeUndefined()
    })
  })

  describe('clearPouVariablesText', () => {
    it('deletes variablesText from POU', () => {
      const pou = makePou('Main') as PLCPou & { variablesText?: string }
      pou.variablesText = 'VAR x: INT; END_VAR'
      seedPou(store, pou)
      store.getState().projectActions.clearPouVariablesText('Main')
      const storedPou = store.getState().project.data.pous[0] as PLCPou & { variablesText?: string }
      expect(storedPou.variablesText).toBeUndefined()
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.clearPouVariablesText('NonExistent')
      expect(store.getState().project.data.pous).toHaveLength(1)
    })
  })

  describe('updatePouName', () => {
    it('renames an existing POU', () => {
      seedPou(store, makePou('OldName'))
      store.getState().projectActions.updatePouName('OldName', 'NewName')
      expect(store.getState().project.data.pous[0].name).toBe('NewName')
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.updatePouName('Missing', 'NewName')
      expect(store.getState().project.data.pous[0].name).toBe('Main')
    })

    it('cascades the rename into matching configuration instances (program POUs)', () => {
      // Regression guard for the "user renames `main` and the build
      // breaks" report.  The template seeds an instance bound to the
      // template's `main` program; without this cascade, renaming
      // the POU would orphan that instance and the IEC compile would
      // fail with a "program not found" error.
      seedPou(store, makePou('OldProg'))
      store.getState().projectActions.createInstance({
        data: { name: 'Inst0', task: 'task0', program: 'OldProg' },
      })
      store.getState().projectActions.updatePouName('OldProg', 'NewProg')
      const instances = store.getState().project.data.configurations.resource.instances
      expect(instances[0].program).toBe('NewProg')
    })

    it('syncs the LD body.value.name when a graphical POU is renamed', () => {
      // Regression guard for the "rename made all rungs disappear"
      // report.  LD/FBD bodies embed their `name` field inside
      // `body.value`; the project-load path uses it as the
      // ladderFlows key, so the rename has to update the inner name
      // too or the on-disk file ends up with a stale name and the
      // next reload renders an empty canvas under the new POU name.
      const pou: PLCPou = {
        name: 'main',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'ld', value: { name: 'main', updated: false, rungs: [] } },
        documentation: '',
      }
      seedPou(store, pou)
      store.getState().projectActions.updatePouName('main', 'PLC_PRG')
      const updated = store.getState().project.data.pous[0]
      expect(updated.name).toBe('PLC_PRG')
      expect((updated.body.value as { name: string }).name).toBe('PLC_PRG')
    })

    it('does not cascade renames into instances when the POU is a function (no instance binding)', () => {
      seedPou(store, makePou('Helper', 'function'))
      // Defensive: a stray instance with the same `program` value
      // shouldn't be rewritten when a function POU is renamed —
      // only program POUs participate in the instance contract.
      store.getState().projectActions.createInstance({
        data: { name: 'Inst0', task: 'task0', program: 'Helper' },
      })
      store.getState().projectActions.updatePouName('Helper', 'Renamed')
      expect(store.getState().project.data.configurations.resource.instances[0].program).toBe('Helper')
    })
  })

  describe('applyPouSnapshot', () => {
    it('replaces variables and body', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('old')]))
      const newVars = [makeVariable('a'), makeVariable('b')]
      const newBody = makeBody('ld', { rungs: [1] })
      store.getState().projectActions.applyPouSnapshot('Main', newVars, newBody)

      const pou = store.getState().project.data.pous[0]
      expect(pou.interface?.variables).toHaveLength(2)
      expect(pou.body).toEqual(newBody)
    })

    it('does nothing when POU not found', () => {
      seedPou(store, makePou('Main'))
      store.getState().projectActions.applyPouSnapshot('Missing', [], makeBody())
      expect(store.getState().project.data.pous[0].name).toBe('Main')
    })
  })

  // =========================================================================
  // Variables (local & global)
  // =========================================================================
  describe('createVariable', () => {
    it('creates a local variable on an existing POU', () => {
      seedPou(store, makePou('Main'))
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: makeVariable('x'),
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(1)
    })

    it('creates a local variable at specific row', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('c')]))
      store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: makeVariable('b'),
        rowToInsert: 1,
      })
      const vars = store.getState().project.data.pous[0].interface?.variables ?? []
      expect(vars[1].name).toBe('b')
    })

    it('auto-renames when local variable already exists', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: makeVariable('x'),
      })
      expect(result.ok).toBe(true)
      expect(result.data).toBeDefined()
      expect((result.data as { name: string }).name).not.toBe('x')
    })

    it('fails when POU not found for local scope', () => {
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Missing',
        data: makeVariable('x'),
      })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('POU not found')
    })

    it('creates a global variable', () => {
      const result = store.getState().projectActions.createVariable({
        scope: 'global',
        data: makeVariable('gx', 'global'),
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.globalVariables).toHaveLength(1)
    })

    it('creates a global variable at specific row', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('a', 'global') })
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('c', 'global') })
      store.getState().projectActions.createVariable({
        scope: 'global',
        data: makeVariable('b', 'global'),
        rowToInsert: 1,
      })
      const gv = store.getState().project.data.configurations.resource.globalVariables
      expect(gv[1].name).toBe('b')
    })

    it('auto-renames when global variable already exists', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })
      const result = store.getState().projectActions.createVariable({
        scope: 'global',
        data: makeVariable('gx', 'global'),
      })
      expect(result.ok).toBe(true)
      expect(result.data).toBeDefined()
      expect((result.data as { name: string }).name).not.toBe('gx')
    })

    it('fails for local scope when POU interface is missing', () => {
      const pou: PLCPou = { name: 'NoIface', pouType: 'program', body: makeBody() }
      seedPou(store, pou)
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'NoIface',
        data: makeVariable('x'),
      })
      // The pou is found but pou.interface is undefined, so the implementation returns fail('POU not found')
      expect(result.ok).toBe(false)
    })
  })

  describe('setPouVariables', () => {
    it('replaces all variables on a POU', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('old')]))
      const result = store.getState().projectActions.setPouVariables({
        pouName: 'Main',
        variables: [makeVariable('a'), makeVariable('b')],
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(2)
    })

    it('returns ok even when POU not found (no-op)', () => {
      const result = store.getState().projectActions.setPouVariables({ pouName: 'Missing', variables: [] })
      expect(result.ok).toBe(true)
    })
  })

  describe('setGlobalVariables', () => {
    it('replaces global variables', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('old', 'global') })
      const result = store.getState().projectActions.setGlobalVariables({
        variables: [makeVariable('new1', 'global'), makeVariable('new2', 'global')],
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.globalVariables).toHaveLength(2)
    })
  })

  describe('updateVariable', () => {
    it('updates a local variable by variableId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'x',
        data: { documentation: 'updated' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].interface?.variables[0].documentation).toBe('updated')
    })

    it('updates a local variable by rowId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b')]))
      store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 1,
        data: { name: 'b_renamed' },
      })
      expect(store.getState().project.data.pous[0].interface?.variables[1].name).toBe('b_renamed')
    })

    it('updates a global variable', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })
      store.getState().projectActions.updateVariable({
        scope: 'global',
        variableId: 'gx',
        data: { location: '%QW0' },
      })
      expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('%QW0')
    })

    it('fails when variable not found', () => {
      seedPou(store, makePou('Main'))
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'nonexistent',
        data: { name: 'foo' },
      })
      expect(result.ok).toBe(false)
    })

    it('fails when POU not found', () => {
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Missing',
        variableId: 'x',
        data: { name: 'foo' },
      })
      expect(result.ok).toBe(false)
    })

    it('stores the location binding verbatim (alias name or literal) and never auto-adopts', () => {
      // Single-field model: `location` is the binding. A manual literal is
      // stored verbatim; an alias name is stored verbatim (NOT auto-resolved
      // to an address, NOT auto-adopted from a matching address); clearing
      // succeeds.
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })

      store.getState().projectActions.updateVariable({ scope: 'global', variableId: 'gx', data: { location: '%QW0' } })
      expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('%QW0')

      // Bind by alias name — kept verbatim.
      store
        .getState()
        .projectActions.updateVariable({ scope: 'global', variableId: 'gx', data: { location: 'push_button' } })
      expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('push_button')

      // Clearing the location.
      const result = store.getState().projectActions.updateVariable({
        scope: 'global',
        variableId: 'gx',
        data: { location: '' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('')
    })
  })

  describe('getVariable', () => {
    it('returns a local variable by variableId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      const v = store.getState().projectActions.getVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'x',
      })
      expect(v?.name).toBe('x')
    })

    it('returns a local variable by rowId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b')]))
      const v = store.getState().projectActions.getVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 1,
      })
      expect(v?.name).toBe('b')
    })

    it('returns a global variable', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })
      const v = store.getState().projectActions.getVariable({ scope: 'global', variableId: 'gx' })
      expect(v?.name).toBe('gx')
    })

    it('returns undefined when variable not found', () => {
      seedPou(store, makePou('Main'))
      const v = store.getState().projectActions.getVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'nonexistent',
      })
      expect(v).toBeUndefined()
    })

    it('returns undefined when POU not found', () => {
      const v = store.getState().projectActions.getVariable({
        scope: 'local',
        associatedPou: 'Missing',
        variableId: 'x',
      })
      expect(v).toBeUndefined()
    })
  })

  describe('deleteVariable', () => {
    it('deletes a local variable by variableId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b')]))
      const result = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'a',
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(1)
      expect(store.getState().project.data.pous[0].interface?.variables[0].name).toBe('b')
    })

    it('deletes a local variable by rowId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b')]))
      store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 0,
      })
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(1)
      expect(store.getState().project.data.pous[0].interface?.variables[0].name).toBe('b')
    })

    it('deletes a local variable by variableName', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x'), makeVariable('y')]))
      store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableName: 'x',
      })
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(1)
    })

    it('deletes a global variable', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gy', 'global') })
      store.getState().projectActions.deleteVariable({ scope: 'global', variableId: 'gx' })
      expect(store.getState().project.data.configurations.resource.globalVariables).toHaveLength(1)
    })

    it('does nothing when variableName not found', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableName: 'nonexistent',
      })
      expect(store.getState().project.data.pous[0].interface?.variables).toHaveLength(1)
    })

    it('returns fail when variables array not available', () => {
      const result = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Missing',
        variableId: 'x',
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('rearrangeVariables', () => {
    it('moves a local variable to a new index', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b'), makeVariable('c')]))
      store.getState().projectActions.rearrangeVariables({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 0,
        newIndex: 2,
      })
      const vars = store.getState().project.data.pous[0].interface?.variables ?? []
      expect(vars[0].name).toBe('b')
      expect(vars[1].name).toBe('c')
      expect(vars[2].name).toBe('a')
    })

    it('moves a local variable by variableId', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a'), makeVariable('b'), makeVariable('c')]))
      store.getState().projectActions.rearrangeVariables({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'c',
        newIndex: 0,
      })
      const vars = store.getState().project.data.pous[0].interface?.variables ?? []
      expect(vars[0].name).toBe('c')
    })

    it('moves a global variable', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('ga', 'global') })
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gb', 'global') })
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gc', 'global') })
      store.getState().projectActions.rearrangeVariables({
        scope: 'global',
        rowId: 2,
        newIndex: 0,
      })
      const gv = store.getState().project.data.configurations.resource.globalVariables
      expect(gv[0].name).toBe('gc')
    })

    it('does nothing when variable not found', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('a')]))
      store.getState().projectActions.rearrangeVariables({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'nonexistent',
        newIndex: 0,
      })
      expect(store.getState().project.data.pous[0].interface?.variables[0].name).toBe('a')
    })

    it('does nothing when variables array is not available', () => {
      store.getState().projectActions.rearrangeVariables({
        scope: 'local',
        associatedPou: 'Missing',
        rowId: 0,
        newIndex: 1,
      })
      // no error thrown
    })
  })

  // =========================================================================
  // Data types
  // =========================================================================
  describe('createDatatype', () => {
    it('creates a structure data type', () => {
      const dt: PLCDataType = { name: 'MyStruct', derivation: 'structure', variable: [] }
      const result = store.getState().projectActions.createDatatype({ data: dt })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.dataTypes).toHaveLength(1)
    })

    it('creates a data type at specific row', () => {
      const dtA: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      const dtC: PLCDataType = { name: 'C', derivation: 'structure', variable: [] }
      const dtB: PLCDataType = { name: 'B', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dtA })
      store.getState().projectActions.createDatatype({ data: dtC })
      store.getState().projectActions.createDatatype({ data: dtB, rowToInsert: 1 })
      expect(store.getState().project.data.dataTypes[1].name).toBe('B')
    })

    it('fails when data type already exists', () => {
      const dt: PLCDataType = { name: 'MyStruct', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      const result = store.getState().projectActions.createDatatype({ data: dt })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Data type already exists')
    })
  })

  describe('deleteDatatype', () => {
    it('removes a data type by name', () => {
      const dt: PLCDataType = { name: 'MyStruct', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.deleteDatatype('MyStruct')
      expect(store.getState().project.data.dataTypes).toHaveLength(0)
    })

    it('does nothing when data type not found', () => {
      const dt: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.deleteDatatype('NonExistent')
      expect(store.getState().project.data.dataTypes).toHaveLength(1)
    })
  })

  describe('updateDatatype', () => {
    it('replaces data type by name', () => {
      const dt: PLCDataType = { name: 'MyStruct', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      const updated: PLCDataType = {
        name: 'MyStruct',
        derivation: 'structure',
        variable: [{ name: 'field1', type: { definition: 'base-type', value: 'BOOL' }, documentation: '' }],
      }
      store.getState().projectActions.updateDatatype('MyStruct', updated)
      const storedDt = store.getState().project.data.dataTypes[0]
      expect(storedDt.derivation).toBe('structure')
      if (storedDt.derivation === 'structure') {
        expect(storedDt.variable).toHaveLength(1)
      }
    })

    it('does nothing when data type not found', () => {
      const dt: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.updateDatatype('NonExistent', dt)
      expect(store.getState().project.data.dataTypes).toHaveLength(1)
    })

    it('does nothing when data is undefined', () => {
      const dt: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.updateDatatype('A', undefined)
      expect(store.getState().project.data.dataTypes[0].derivation).toBe('structure')
    })
  })

  describe('createArrayDimension', () => {
    it('adds a dimension to an array data type', () => {
      const dt: PLCDataType = {
        name: 'MyArray',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        dimensions: [{ dimension: '0..9' }],
      }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.createArrayDimension({ name: 'MyArray', derivation: 'array' })
      const storedDt = store.getState().project.data.dataTypes[0]
      if (storedDt.derivation === 'array') {
        expect(storedDt.dimensions).toHaveLength(2)
        expect(storedDt.dimensions[1]).toEqual({ dimension: '' })
      }
    })

    it('does nothing for non-array data type', () => {
      const dt: PLCDataType = { name: 'MyStruct', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.createArrayDimension({ name: 'MyStruct', derivation: 'array' })
      // no crash; structure has no dimensions array
    })

    it('does nothing when data type not found', () => {
      store.getState().projectActions.createArrayDimension({ name: 'NonExistent', derivation: 'array' })
      expect(store.getState().project.data.dataTypes).toHaveLength(0)
    })
  })

  describe('rearrangeStructureVariables', () => {
    it('moves a structure variable to a new index', () => {
      const dt: PLCDataType = {
        name: 'MyStruct',
        derivation: 'structure',
        variable: [
          { name: 'a', type: { definition: 'base-type', value: 'INT' }, documentation: '' },
          { name: 'b', type: { definition: 'base-type', value: 'INT' }, documentation: '' },
          { name: 'c', type: { definition: 'base-type', value: 'INT' }, documentation: '' },
        ],
      }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.rearrangeStructureVariables({
        associatedDataType: 'MyStruct',
        rowId: 0,
        newIndex: 2,
      })
      const storedDt = store.getState().project.data.dataTypes[0]
      if (storedDt.derivation === 'structure') {
        expect(storedDt.variable[0].name).toBe('b')
        expect(storedDt.variable[2].name).toBe('a')
      }
    })

    it('does nothing when associatedDataType is undefined', () => {
      store.getState().projectActions.rearrangeStructureVariables({
        associatedDataType: undefined,
        rowId: 0,
        newIndex: 1,
      })
      // no crash
    })

    it('does nothing for non-structure data type', () => {
      const dt: PLCDataType = {
        name: 'MyArray',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        dimensions: [],
      }
      store.getState().projectActions.createDatatype({ data: dt })
      store.getState().projectActions.rearrangeStructureVariables({
        associatedDataType: 'MyArray',
        rowId: 0,
        newIndex: 1,
      })
      // no crash
    })
  })

  describe('applyDatatypeSnapshot', () => {
    it('replaces the data type at matching index', () => {
      const dt: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      const replacement: PLCDataType = {
        name: 'A',
        derivation: 'enumerated',
        values: [{ description: 'val1' }],
      }
      store.getState().projectActions.applyDatatypeSnapshot('A', replacement)
      expect(store.getState().project.data.dataTypes[0].derivation).toBe('enumerated')
    })

    it('does nothing when data type not found', () => {
      const dt: PLCDataType = { name: 'A', derivation: 'structure', variable: [] }
      store.getState().projectActions.createDatatype({ data: dt })
      const replacement: PLCDataType = { name: 'Z', derivation: 'structure', variable: [] }
      store.getState().projectActions.applyDatatypeSnapshot('NonExistent', replacement)
      expect(store.getState().project.data.dataTypes[0].name).toBe('A')
    })
  })

  // =========================================================================
  // Tasks
  // =========================================================================
  describe('createTask', () => {
    it('creates a task', () => {
      const result = store.getState().projectActions.createTask({ data: makeTask('Task0') })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.tasks).toHaveLength(1)
    })

    it('creates a task at specific row', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.createTask({ data: makeTask('C') })
      store.getState().projectActions.createTask({ data: makeTask('B'), rowToInsert: 1 })
      expect(store.getState().project.data.configurations.resource.tasks[1].name).toBe('B')
    })

    it('fails when task already exists', () => {
      store.getState().projectActions.createTask({ data: makeTask('Task0') })
      const result = store.getState().projectActions.createTask({ data: makeTask('Task0') })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Task already exists')
    })
  })

  describe('setTasks', () => {
    it('replaces all tasks', () => {
      store.getState().projectActions.createTask({ data: makeTask('Old') })
      const result = store.getState().projectActions.setTasks({ tasks: [makeTask('New1'), makeTask('New2')] })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.tasks).toHaveLength(2)
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('New1')
    })
  })

  describe('updateTask', () => {
    it('updates a task at specific rowId', () => {
      store.getState().projectActions.createTask({ data: makeTask('Task0') })
      const updated = { ...makeTask('TaskUpdated'), priority: 5 }
      const result = store.getState().projectActions.updateTask({ data: updated, rowId: 0 })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('TaskUpdated')
      expect(store.getState().project.data.configurations.resource.tasks[0].priority).toBe(5)
    })

    it('does nothing when rowId is out of bounds (negative)', () => {
      store.getState().projectActions.createTask({ data: makeTask('Task0') })
      store.getState().projectActions.updateTask({ data: makeTask('X'), rowId: -1 })
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('Task0')
    })

    it('does nothing when rowId is out of bounds (too large)', () => {
      store.getState().projectActions.createTask({ data: makeTask('Task0') })
      store.getState().projectActions.updateTask({ data: makeTask('X'), rowId: 5 })
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('Task0')
    })
  })

  describe('deleteTask', () => {
    it('deletes a task at specific rowId', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.createTask({ data: makeTask('B') })
      store.getState().projectActions.deleteTask({ rowId: 0 })
      expect(store.getState().project.data.configurations.resource.tasks).toHaveLength(1)
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('B')
    })

    it('does nothing when rowId is out of bounds', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.deleteTask({ rowId: 5 })
      expect(store.getState().project.data.configurations.resource.tasks).toHaveLength(1)
    })

    it('does nothing when rowId is negative', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.deleteTask({ rowId: -1 })
      expect(store.getState().project.data.configurations.resource.tasks).toHaveLength(1)
    })
  })

  describe('rearrangeTasks', () => {
    it('moves a task to a new index', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.createTask({ data: makeTask('B') })
      store.getState().projectActions.createTask({ data: makeTask('C') })
      store.getState().projectActions.rearrangeTasks({ rowId: 0, newIndex: 2 })
      const tasks = store.getState().project.data.configurations.resource.tasks
      expect(tasks[0].name).toBe('B')
      expect(tasks[2].name).toBe('A')
    })

    it('does nothing when rowId is out of bounds', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.rearrangeTasks({ rowId: 5, newIndex: 0 })
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('A')
    })

    it('does nothing when rowId is negative', () => {
      store.getState().projectActions.createTask({ data: makeTask('A') })
      store.getState().projectActions.rearrangeTasks({ rowId: -1, newIndex: 0 })
      expect(store.getState().project.data.configurations.resource.tasks[0].name).toBe('A')
    })
  })

  // =========================================================================
  // Instances
  // =========================================================================
  describe('createInstance', () => {
    it('creates an instance', () => {
      const result = store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.instances).toHaveLength(1)
    })

    it('creates an instance at specific row', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.createInstance({ data: makeInstance('C') })
      store.getState().projectActions.createInstance({ data: makeInstance('B'), rowToInsert: 1 })
      expect(store.getState().project.data.configurations.resource.instances[1].name).toBe('B')
    })

    it('fails when instance already exists', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      const result = store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Instance already exists')
    })
  })

  describe('setInstances', () => {
    it('replaces all instances', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('Old') })
      const result = store.getState().projectActions.setInstances({
        instances: [makeInstance('New1'), makeInstance('New2')],
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.instances).toHaveLength(2)
    })
  })

  describe('updateInstance', () => {
    it('updates an instance at specific rowId', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      const updated = makeInstance('InstUpdated', 'Task1', 'Sub')
      const result = store.getState().projectActions.updateInstance({ data: updated, rowId: 0 })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('InstUpdated')
    })

    it('does nothing when rowId is out of bounds', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      store.getState().projectActions.updateInstance({ data: makeInstance('X'), rowId: 5 })
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('Inst0')
    })

    it('does nothing when rowId is negative', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('Inst0') })
      store.getState().projectActions.updateInstance({ data: makeInstance('X'), rowId: -1 })
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('Inst0')
    })
  })

  describe('deleteInstance', () => {
    it('deletes an instance at specific rowId', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.createInstance({ data: makeInstance('B') })
      store.getState().projectActions.deleteInstance({ rowId: 0 })
      expect(store.getState().project.data.configurations.resource.instances).toHaveLength(1)
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('B')
    })

    it('does nothing when rowId is out of bounds', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.deleteInstance({ rowId: 5 })
      expect(store.getState().project.data.configurations.resource.instances).toHaveLength(1)
    })

    it('does nothing when rowId is negative', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.deleteInstance({ rowId: -1 })
      expect(store.getState().project.data.configurations.resource.instances).toHaveLength(1)
    })
  })

  describe('rearrangeInstances', () => {
    it('moves an instance to a new index', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.createInstance({ data: makeInstance('B') })
      store.getState().projectActions.createInstance({ data: makeInstance('C') })
      store.getState().projectActions.rearrangeInstances({ rowId: 0, newIndex: 2 })
      const instances = store.getState().project.data.configurations.resource.instances
      expect(instances[0].name).toBe('B')
      expect(instances[2].name).toBe('A')
    })

    it('does nothing when rowId is out of bounds', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.rearrangeInstances({ rowId: 5, newIndex: 0 })
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('A')
    })

    it('does nothing when rowId is negative', () => {
      store.getState().projectActions.createInstance({ data: makeInstance('A') })
      store.getState().projectActions.rearrangeInstances({ rowId: -1, newIndex: 0 })
      expect(store.getState().project.data.configurations.resource.instances[0].name).toBe('A')
    })
  })

  // =========================================================================
  // Servers
  // =========================================================================
  describe('createServer', () => {
    it('creates a modbus-tcp server with default config', () => {
      const result = store.getState().projectActions.createServer({
        data: { name: 'ModbusServer', protocol: 'modbus-tcp' },
      })
      expect(result.ok).toBe(true)
      const servers = store.getState().project.data.servers ?? []
      expect(servers).toHaveLength(1)
      expect(servers[0].modbusSlaveConfig).toBeDefined()
      expect(servers[0].modbusSlaveConfig?.port).toBe(502)
    })

    it('creates an s7comm server with default config', () => {
      const result = store.getState().projectActions.createServer({
        data: { name: 'S7Server', protocol: 's7comm' },
      })
      expect(result.ok).toBe(true)
      const server = (store.getState().project.data.servers ?? [])[0]
      expect(server.s7commSlaveConfig).toBeDefined()
      expect(server.s7commSlaveConfig?.server.port).toBe(102)
      expect(server.s7commSlaveConfig?.plcIdentity!.name).toBe('OpenPLC Runtime')
    })

    it('creates an opcua server with default config', () => {
      const result = store.getState().projectActions.createServer({
        data: { name: 'OpcServer', protocol: 'opcua' },
      })
      expect(result.ok).toBe(true)
      const server = (store.getState().project.data.servers ?? [])[0]
      expect(server.opcuaServerConfig).toBeDefined()
      expect(server.opcuaServerConfig?.server.port).toBe(4840)
    })

    it('does not overwrite existing config when creating', () => {
      const result = store.getState().projectActions.createServer({
        data: makeModbusTcpServer('Srv'),
      })
      expect(result.ok).toBe(true)
      const srv = (store.getState().project.data.servers ?? [])[0]
      expect(srv.modbusSlaveConfig?.port).toBe(502)
    })

    it('fails when server name already exists', () => {
      store.getState().projectActions.createServer({ data: makeModbusTcpServer('Srv') })
      const result = store.getState().projectActions.createServer({ data: makeModbusTcpServer('Srv') })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Server already exists')
    })

    it('creates a server with unknown protocol type without adding config', () => {
      const result = store.getState().projectActions.createServer({
        data: { name: 'EtherNet', protocol: 'ethernet-ip' },
      })
      expect(result.ok).toBe(true)
      const srv = (store.getState().project.data.servers ?? [])[0]
      expect(srv.modbusSlaveConfig).toBeUndefined()
      expect(srv.s7commSlaveConfig).toBeUndefined()
      expect(srv.opcuaServerConfig).toBeUndefined()
    })
  })

  describe('deleteServer', () => {
    it('removes a server by name', () => {
      seedServer(store, makeModbusTcpServer('A'))
      seedServer(store, makeModbusTcpServer('B'))
      const result = store.getState().projectActions.deleteServer('A')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers).toHaveLength(1)
      expect(store.getState().project.data.servers![0].name).toBe('B')
    })

    it('returns ok even when server not found', () => {
      const result = store.getState().projectActions.deleteServer('NonExistent')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateServerName', () => {
    it('renames a server', () => {
      seedServer(store, makeModbusTcpServer('OldName'))
      const result = store.getState().projectActions.updateServerName('OldName', 'NewName')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].name).toBe('NewName')
    })

    it('fails when new name already exists', () => {
      seedServer(store, makeModbusTcpServer('A'))
      seedServer(store, makeModbusTcpServer('B'))
      const result = store.getState().projectActions.updateServerName('A', 'B')
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Server name already exists')
    })

    it('returns ok when server not found (no-op)', () => {
      const result = store.getState().projectActions.updateServerName('NonExistent', 'New')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateServerConfig', () => {
    it('updates modbus config fields', () => {
      seedServer(store, makeModbusTcpServer('Srv'))
      const result = store.getState().projectActions.updateServerConfig('Srv', {
        enabled: true,
        port: 503,
        networkInterface: '192.168.0.1',
      })
      expect(result.ok).toBe(true)
      const config = store.getState().project.data.servers![0].modbusSlaveConfig!
      expect(config.enabled).toBe(true)
      expect(config.port).toBe(503)
      expect(config.networkInterface).toBe('192.168.0.1')
    })

    it('updates buffer mapping', () => {
      seedServer(store, makeModbusTcpServer('Srv'))
      store.getState().projectActions.updateServerConfig('Srv', {
        bufferMapping: { holdingRegisters: { qwCount: 10 } },
      })
      const config = store.getState().project.data.servers![0].modbusSlaveConfig!
      expect(config.bufferMapping?.holdingRegisters?.qwCount).toBe(10)
    })

    it('merges buffer mapping with existing', () => {
      seedServer(store, makeModbusTcpServer('Srv'))
      store.getState().projectActions.updateServerConfig('Srv', {
        bufferMapping: { holdingRegisters: { qwCount: 10 } },
      })
      store.getState().projectActions.updateServerConfig('Srv', {
        bufferMapping: { coils: { qxBits: 32 } },
      })
      const config = store.getState().project.data.servers![0].modbusSlaveConfig!
      expect(config.bufferMapping?.holdingRegisters?.qwCount).toBe(10)
      expect(config.bufferMapping?.coils?.qxBits).toBe(32)
    })

    it('does nothing when server has no modbusSlaveConfig', () => {
      seedServer(store, { name: 'ENet', protocol: 'ethernet-ip' })
      const result = store.getState().projectActions.updateServerConfig('ENet', { enabled: true })
      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // S7Comm
  // =========================================================================
  describe('updateS7CommServerSettings', () => {
    it('updates server settings', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.updateS7CommServerSettings('S7', { port: 200, enabled: true })
      expect(result.ok).toBe(true)
      const settings = store.getState().project.data.servers![0].s7commSlaveConfig!.server
      expect(settings.port).toBe(200)
      expect(settings.enabled).toBe(true)
      expect(settings.bindAddress).toBe('0.0.0.0') // unchanged
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateS7CommServerSettings('Modbus', { port: 200 })
      expect(result.ok).toBe(true)
    })
  })

  describe('updateS7CommPlcIdentity', () => {
    it('updates PLC identity', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.updateS7CommPlcIdentity('S7', { name: 'Custom PLC' })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.plcIdentity!.name).toBe('Custom PLC')
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.plcIdentity!.moduleType).toBe(
        'CPU 315-2 PN/DP',
      ) // unchanged
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateS7CommPlcIdentity('Modbus', { name: 'X' })
      expect(result.ok).toBe(true)
    })
  })

  describe('addS7CommDataBlock', () => {
    it('adds a data block', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks).toHaveLength(1)
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.addS7CommDataBlock('Modbus', makeDataBlock(1))
      expect(result.ok).toBe(true)
    })
  })

  describe('updateS7CommDataBlock', () => {
    it('updates a data block at index', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      const result = store.getState().projectActions.updateS7CommDataBlock('S7', 0, { description: 'Updated' })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks[0].description).toBe('Updated')
    })

    it('does nothing when index is out of bounds', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      store.getState().projectActions.updateS7CommDataBlock('S7', 5, { description: 'Nope' })
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks[0].description).toBe('DB1')
    })

    it('does nothing when index is negative', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      store.getState().projectActions.updateS7CommDataBlock('S7', -1, { description: 'Nope' })
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks[0].description).toBe('DB1')
    })
  })

  describe('removeS7CommDataBlock', () => {
    it('removes a data block at index', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(2))
      const result = store.getState().projectActions.removeS7CommDataBlock('S7', 0)
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks).toHaveLength(1)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks[0].dbNumber).toBe(2)
    })

    it('does nothing when index is out of bounds', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      store.getState().projectActions.removeS7CommDataBlock('S7', 5)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks).toHaveLength(1)
    })

    it('does nothing when index is negative', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.addS7CommDataBlock('S7', makeDataBlock(1))
      store.getState().projectActions.removeS7CommDataBlock('S7', -1)
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.dataBlocks).toHaveLength(1)
    })
  })

  describe('updateS7CommSystemArea', () => {
    it('creates a new system area when it does not exist', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.updateS7CommSystemArea('S7', 'peArea', {
        enabled: true,
        sizeBytes: 16,
      })
      expect(result.ok).toBe(true)
      const slaveConfig = store.getState().project.data.servers![0].s7commSlaveConfig as unknown as Record<
        string,
        unknown
      >
      const peArea = slaveConfig.peArea as { enabled: boolean; sizeBytes: number }
      expect(peArea.enabled).toBe(true)
      expect(peArea.sizeBytes).toBe(16)
    })

    it('updates an existing system area', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.updateS7CommSystemArea('S7', 'mkArea', { enabled: true, sizeBytes: 8 })
      store.getState().projectActions.updateS7CommSystemArea('S7', 'mkArea', { sizeBytes: 32 })
      const slaveConfig = store.getState().project.data.servers![0].s7commSlaveConfig as unknown as Record<
        string,
        unknown
      >
      const mkArea = slaveConfig.mkArea as { enabled: boolean; sizeBytes: number }
      expect(mkArea.enabled).toBe(true)
      expect(mkArea.sizeBytes).toBe(32)
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store
        .getState()
        .projectActions.updateS7CommSystemArea('Modbus', 'peArea', { enabled: true, sizeBytes: 1 })
      expect(result.ok).toBe(true)
    })
  })

  describe('updateS7CommLogging', () => {
    it('updates logging settings', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.updateS7CommLogging('S7', { logDataAccess: true })
      expect(result.ok).toBe(true)
      const logging = store.getState().project.data.servers![0].s7commSlaveConfig!.logging!
      expect(logging.logDataAccess).toBe(true)
      expect(logging.logConnections).toBe(true) // unchanged
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateS7CommLogging('Modbus', { logErrors: false })
      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // OPC-UA
  // =========================================================================
  describe('updateOpcUaServerConfig', () => {
    it('updates OPC-UA server config', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.updateOpcUaServerConfig('OPC', {
        server: { enabled: true, port: 4841 },
      })
      expect(result.ok).toBe(true)
      const srvConfig = store.getState().project.data.servers![0].opcuaServerConfig!.server
      expect(srvConfig.enabled).toBe(true)
      expect(srvConfig.port).toBe(4841)
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateOpcUaServerConfig('Modbus', { enabled: true })
      expect(result.ok).toBe(true)
    })
  })

  describe('addOpcUaSecurityProfile', () => {
    it('adds a security profile', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const profile = makeSecurityProfile('new-profile')
      const result = store.getState().projectActions.addOpcUaSecurityProfile('OPC', profile)
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.securityProfiles).toHaveLength(2) // default + new
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.addOpcUaSecurityProfile('Modbus', makeSecurityProfile('p'))
      expect(result.ok).toBe(true)
    })
  })

  describe('updateOpcUaSecurityProfile', () => {
    it('updates a security profile by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.updateOpcUaSecurityProfile('OPC', 'default-insecure', {
        enabled: false,
      })
      expect(result.ok).toBe(true)
      const profiles = store.getState().project.data.servers![0].opcuaServerConfig!.securityProfiles
      expect(profiles[0].enabled).toBe(false)
    })

    it('does nothing when profile not found', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.updateOpcUaSecurityProfile('OPC', 'missing', { enabled: false })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.securityProfiles[0].enabled).toBe(true)
    })
  })

  describe('removeOpcUaSecurityProfile', () => {
    it('removes a security profile by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaSecurityProfile('OPC', makeSecurityProfile('extra'))
      const result = store.getState().projectActions.removeOpcUaSecurityProfile('OPC', 'default-insecure')
      expect(result.ok).toBe(true)
      const profiles = store.getState().project.data.servers![0].opcuaServerConfig!.securityProfiles
      expect(profiles).toHaveLength(1)
      expect(profiles[0].id).toBe('extra')
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.removeOpcUaSecurityProfile('Modbus', 'x')
      expect(result.ok).toBe(true)
    })
  })

  describe('addOpcUaUser', () => {
    it('adds a user', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.addOpcUaUser('OPC', makeOpcUaUser('u1'))
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.users).toHaveLength(1)
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.addOpcUaUser('Modbus', makeOpcUaUser('u1'))
      expect(result.ok).toBe(true)
    })
  })

  describe('updateOpcUaUser', () => {
    it('updates a user by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaUser('OPC', makeOpcUaUser('u1'))
      const result = store.getState().projectActions.updateOpcUaUser('OPC', 'u1', { role: 'engineer' })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.users[0].role).toBe('engineer')
    })

    it('does nothing when user not found', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaUser('OPC', makeOpcUaUser('u1'))
      store.getState().projectActions.updateOpcUaUser('OPC', 'missing', { role: 'viewer' })
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.users[0].role).toBe('operator')
    })
  })

  describe('removeOpcUaUser', () => {
    it('removes a user by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaUser('OPC', makeOpcUaUser('u1'))
      store.getState().projectActions.addOpcUaUser('OPC', makeOpcUaUser('u2'))
      const result = store.getState().projectActions.removeOpcUaUser('OPC', 'u1')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.users).toHaveLength(1)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.users[0].id).toBe('u2')
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.removeOpcUaUser('Modbus', 'u1')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateOpcUaServerCertificateStrategy', () => {
    it('updates to custom strategy with certificate and key', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store
        .getState()
        .projectActions.updateOpcUaServerCertificateStrategy('OPC', 'custom', 'CERT-PEM', 'KEY-PEM')
      expect(result.ok).toBe(true)
      const security = store.getState().project.data.servers![0].opcuaServerConfig!.security
      expect(security.serverCertificateStrategy).toBe('custom')
      expect(security.serverCertificateCustom).toBe('CERT-PEM')
      expect(security.serverPrivateKeyCustom).toBe('KEY-PEM')
    })

    it('updates to auto_self_signed without changing cert/key when not provided', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.updateOpcUaServerCertificateStrategy('OPC', 'custom', 'CERT', 'KEY')
      store.getState().projectActions.updateOpcUaServerCertificateStrategy('OPC', 'auto_self_signed')
      const security = store.getState().project.data.servers![0].opcuaServerConfig!.security
      expect(security.serverCertificateStrategy).toBe('auto_self_signed')
      // cert/key remain because undefined params are not applied
      expect(security.serverCertificateCustom).toBe('CERT')
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateOpcUaServerCertificateStrategy('Modbus', 'custom', 'C', 'K')
      expect(result.ok).toBe(true)
    })
  })

  describe('addOpcUaTrustedCertificate', () => {
    it('adds a trusted certificate', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.addOpcUaTrustedCertificate('OPC', makeTrustedCert('cert1'))
      expect(result.ok).toBe(true)
      expect(
        store.getState().project.data.servers![0].opcuaServerConfig!.security.trustedClientCertificates,
      ).toHaveLength(1)
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.addOpcUaTrustedCertificate('Modbus', makeTrustedCert('cert1'))
      expect(result.ok).toBe(true)
    })
  })

  describe('removeOpcUaTrustedCertificate', () => {
    it('removes a trusted certificate by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaTrustedCertificate('OPC', makeTrustedCert('cert1'))
      store.getState().projectActions.addOpcUaTrustedCertificate('OPC', makeTrustedCert('cert2'))
      const result = store.getState().projectActions.removeOpcUaTrustedCertificate('OPC', 'cert1')
      expect(result.ok).toBe(true)
      const certs = store.getState().project.data.servers![0].opcuaServerConfig!.security.trustedClientCertificates
      expect(certs).toHaveLength(1)
      expect(certs[0].id).toBe('cert2')
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.removeOpcUaTrustedCertificate('Modbus', 'cert1')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateOpcUaAddressSpaceNamespace', () => {
    it('updates namespace URI', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.updateOpcUaAddressSpaceNamespace('OPC', 'urn:custom:namespace')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.namespaceUri).toBe(
        'urn:custom:namespace',
      )
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateOpcUaAddressSpaceNamespace('Modbus', 'urn:x')
      expect(result.ok).toBe(true)
    })
  })

  describe('addOpcUaNode', () => {
    it('adds a node', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.addOpcUaNode('OPC', makeOpcUaNode('node1'))
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.nodes).toHaveLength(1)
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.addOpcUaNode('Modbus', makeOpcUaNode('node1'))
      expect(result.ok).toBe(true)
    })
  })

  describe('updateOpcUaNode', () => {
    it('updates a node by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaNode('OPC', makeOpcUaNode('node1'))
      const result = store.getState().projectActions.updateOpcUaNode('OPC', 'node1', {
        displayName: 'Updated Node',
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.nodes[0].displayName).toBe(
        'Updated Node',
      )
    })

    it('does nothing when node not found', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaNode('OPC', makeOpcUaNode('node1'))
      store.getState().projectActions.updateOpcUaNode('OPC', 'missing', { displayName: 'Nope' })
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.nodes[0].displayName).toBe(
        'node1',
      )
    })
  })

  describe('removeOpcUaNode', () => {
    it('removes a node by id', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      store.getState().projectActions.addOpcUaNode('OPC', makeOpcUaNode('node1'))
      store.getState().projectActions.addOpcUaNode('OPC', makeOpcUaNode('node2'))
      const result = store.getState().projectActions.removeOpcUaNode('OPC', 'node1')
      expect(result.ok).toBe(true)
      const nodes = store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.nodes
      expect(nodes).toHaveLength(1)
      expect(nodes[0].id).toBe('node2')
    })

    it('does nothing when server has no opcuaServerConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.removeOpcUaNode('Modbus', 'node1')
      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // Remote devices
  // =========================================================================
  describe('updateLibraryManifest', () => {
    it('writes the manifest blob into project.data.libraryManifest', () => {
      // libraryManifest is the .stlib metadata the library editor
      // dumps back into project.json on save; the action is a pure
      // setter, so the assertion is straight value-equality.
      store.getState().projectActions.updateLibraryManifest('# my library')
      expect(store.getState().project.data.libraryManifest).toBe('# my library')
    })
  })

  describe('updateEthercatConfig', () => {
    // Surfaces three explicit failure shapes — exercised separately
    // because the error message is the contract the EtherCAT screen
    // surfaces back to the user.
    it('fails when remoteDevices is undefined', () => {
      store.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, remoteDevices: undefined as unknown as PLCRemoteDevice[] },
        },
      }))
      const result = store.getState().projectActions.updateEthercatConfig('Dev1', { devices: [] })
      expect(result).toEqual({ ok: false, message: 'No remote devices found' })
    })

    it('fails when the named device is missing', () => {
      seedRemoteDevice(store, makeRemoteDevice('Other'))
      const result = store.getState().projectActions.updateEthercatConfig('Missing', { devices: [] })
      expect(result).toEqual({ ok: false, message: 'Remote device not found' })
    })

    it('fails when the device protocol is not ethercat', () => {
      // makeRemoteDevice defaults to modbus-tcp — same guard the
      // EtherCAT screen relies on to refuse cross-protocol writes.
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const result = store.getState().projectActions.updateEthercatConfig('Dev1', { devices: [] })
      expect(result).toEqual({ ok: false, message: 'Device is not an EtherCAT device' })
    })

    it('writes ethercatConfig onto an ethercat-protocol device', () => {
      seedRemoteDevice(store, { name: 'BusA', protocol: 'ethercat' })
      const cfg = {
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, taskPriority: 50 },
        devices: [],
      }
      const result = store.getState().projectActions.updateEthercatConfig('BusA', cfg)
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].ethercatConfig).toEqual(cfg)
    })

    it('reallocates EtherCAT channel addresses through the central registry', () => {
      seedRuntimeV4Board(store)
      seedRemoteDevice(store, { name: 'BusA', protocol: 'ethercat' })
      const cfg = {
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, taskPriority: 50 },
        devices: [
          {
            id: 's1',
            name: 'Slave1',
            channelMappings: [
              { channelId: 'c0', iecLocation: '%IW5', alias: '' },
              { channelId: 'c1', iecLocation: '%IW6', alias: '' },
            ],
          } as unknown as ConfiguredEtherCATDevice,
        ],
      }
      store.getState().projectActions.updateEthercatConfig('BusA', cfg)
      // The central registry compacts the channels to the lowest free %IW slots.
      const mappings = store.getState().project.data.remoteDevices![0].ethercatConfig!.devices[0].channelMappings
      expect(mappings.map((m) => m.iecLocation)).toEqual(['%IW0', '%IW1'])
    })

    it('cascades a channel alias rename onto bound variable locations', () => {
      seedRuntimeV4Board(store)
      seedRemoteDevice(store, { name: 'BusA', protocol: 'ethercat' })
      const withAlias = (alias: string) => ({
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, taskPriority: 50 },
        devices: [
          {
            id: 's1',
            name: 'Slave1',
            channelMappings: [{ channelId: 'c0', iecLocation: '%IW0', alias }],
          } as unknown as ConfiguredEtherCATDevice,
        ],
      })
      // First write establishes the channel alias `ec_in`.
      store.getState().projectActions.updateEthercatConfig('BusA', withAlias('ec_in'))
      // A program variable binds to that alias by name.
      seedPou(store, makePou('Prog', 'program', [locVar('reading', 'ec_in')]))
      // Rewriting the config with a renamed alias must cascade onto the binding.
      store.getState().projectActions.updateEthercatConfig('BusA', withAlias('ec_input'))
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('ec_input')
    })
  })

  describe('createRemoteDevice', () => {
    it('creates a remote device with default modbus config', () => {
      const result = store.getState().projectActions.createRemoteDevice({
        data: { name: 'Dev1', protocol: 'modbus-tcp' },
      })
      expect(result.ok).toBe(true)
      const devices = store.getState().project.data.remoteDevices ?? []
      expect(devices).toHaveLength(1)
      expect(devices[0].modbusTcpConfig).toBeDefined()
      expect(devices[0].modbusTcpConfig?.host).toBe('127.0.0.1')
    })

    it('does not overwrite existing modbus config', () => {
      const result = store.getState().projectActions.createRemoteDevice({
        data: makeRemoteDevice('Dev1'),
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig?.port).toBe(502)
    })

    it('creates a device with non-modbus protocol without adding config', () => {
      const result = store.getState().projectActions.createRemoteDevice({
        data: { name: 'Dev1', protocol: 'ethercat' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig).toBeUndefined()
    })

    it('fails when device name already exists', () => {
      store.getState().projectActions.createRemoteDevice({ data: makeRemoteDevice('Dev1') })
      const result = store.getState().projectActions.createRemoteDevice({ data: makeRemoteDevice('Dev1') })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Remote device already exists')
    })
  })

  describe('deleteRemoteDevice', () => {
    it('removes a remote device by name', () => {
      seedRemoteDevice(store, makeRemoteDevice('A'))
      seedRemoteDevice(store, makeRemoteDevice('B'))
      const result = store.getState().projectActions.deleteRemoteDevice('A')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices).toHaveLength(1)
      expect(store.getState().project.data.remoteDevices![0].name).toBe('B')
    })

    it('returns ok even when device not found', () => {
      const result = store.getState().projectActions.deleteRemoteDevice('NonExistent')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateRemoteDeviceName', () => {
    it('renames a remote device', () => {
      seedRemoteDevice(store, makeRemoteDevice('OldName'))
      const result = store.getState().projectActions.updateRemoteDeviceName('OldName', 'NewName')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].name).toBe('NewName')
    })

    it('fails when new name already exists', () => {
      seedRemoteDevice(store, makeRemoteDevice('A'))
      seedRemoteDevice(store, makeRemoteDevice('B'))
      const result = store.getState().projectActions.updateRemoteDeviceName('A', 'B')
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Device name already exists')
    })

    it('returns ok when device not found (no-op)', () => {
      const result = store.getState().projectActions.updateRemoteDeviceName('NonExistent', 'New')
      expect(result.ok).toBe(true)
    })
  })

  describe('updateRemoteDeviceConfig', () => {
    it('updates device config fields', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const result = store.getState().projectActions.updateRemoteDeviceConfig('Dev1', {
        host: '10.0.0.1',
        port: 503,
        slaveId: 2,
        timeout: 2000,
      })
      expect(result.ok).toBe(true)
      const cfg = store.getState().project.data.remoteDevices![0].modbusTcpConfig!
      expect(cfg.host).toBe('10.0.0.1')
      expect(cfg.port).toBe(503)
      expect(cfg.slaveId).toBe(2)
      expect(cfg.timeout).toBe(2000)
    })

    it('persists RTU (serial) fields and the transport selector', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const result = store.getState().projectActions.updateRemoteDeviceConfig('Dev1', {
        transport: 'rtu',
        serialPort: '/dev/ttyUSB0',
        baudRate: 19200,
        parity: 'E',
        stopBits: 2,
        dataBits: 7,
        slaveId: 7,
      })
      expect(result.ok).toBe(true)
      const cfg = store.getState().project.data.remoteDevices![0].modbusTcpConfig!
      expect(cfg.transport).toBe('rtu')
      expect(cfg.serialPort).toBe('/dev/ttyUSB0')
      expect(cfg.baudRate).toBe(19200)
      expect(cfg.parity).toBe('E')
      expect(cfg.stopBits).toBe(2)
      expect(cfg.dataBits).toBe(7)
      expect(cfg.slaveId).toBe(7)
    })

    it('does nothing when device has no modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.updateRemoteDeviceConfig('EtherCAT', { host: '10.0.0.1' })
      expect(result.ok).toBe(true)
    })

    it('only updates provided fields', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.updateRemoteDeviceConfig('Dev1', { host: '10.0.0.1' })
      const cfg = store.getState().project.data.remoteDevices![0].modbusTcpConfig!
      expect(cfg.host).toBe('10.0.0.1')
      expect(cfg.port).toBe(502) // unchanged
    })
  })

  describe('addIOGroup', () => {
    beforeEach(() => {
      // Cap-gated pool needs a target with modbusTcpRemote capability,
      // otherwise sibling Modbus groups don't count and consecutive
      // addIOGroup calls collide on the same address space. In
      // production the workspace screen seeds availableBoards before
      // the user reaches the remote-device UI, so this mirrors reality.
      seedRuntimeV4Board(store)
    })

    it('adds an IO group and generates IO points', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '3', 3)
      const result = store.getState().projectActions.addIOGroup('Dev1', group)
      expect(result.ok).toBe(true)
      const ioGroups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(ioGroups).toHaveLength(1)
      expect(ioGroups[0].ioPoints).toHaveLength(3)
      expect(ioGroups[0].ioPoints![0].iecLocation).toBe('%IW0')
      expect(ioGroups[0].ioPoints![1].iecLocation).toBe('%IW1')
    })

    it('generates bit addresses for function code 1 (coils)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '1', 2)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%IX0.0')
      expect(points[1].iecLocation).toBe('%IX0.1')
    })

    it('generates output addresses for function code 5', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '5', 2)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%QX0.0')
    })

    it('generates word output addresses for function code 6', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '6', 1)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%QW0')
    })

    it('generates addresses for function code 2 (discrete inputs)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '2', 1)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%IX0.0')
    })

    it('generates addresses for function code 4 (input registers)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '4', 1)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%IW0')
    })

    it('generates addresses for function code 15 (multiple coils)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '15', 2)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%QX0.0')
      expect(points[1].iecLocation).toBe('%QX0.1')
    })

    it('generates addresses for function code 16 (multiple registers)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      const group = makeIOGroup('g1', '16', 2)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%QW0')
      expect(points[1].iecLocation).toBe('%QW1')
    })

    it('avoids duplicate IEC addresses across groups', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '3', 2))
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      const allLocations = groups.flatMap((g) => g.ioPoints!.map((p) => p.iecLocation))
      const uniqueLocations = new Set(allLocations)
      expect(uniqueLocations.size).toBe(allLocations.length)
    })

    it('avoids duplicate IEC bit addresses across groups (bit collision)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      // First group uses bit addresses %IX0.0, %IX0.1
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '1', 2))
      // Second group should skip those addresses
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '1', 2))
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      const allLocations = groups.flatMap((g) => g.ioPoints!.map((p) => p.iecLocation))
      const uniqueLocations = new Set(allLocations)
      expect(uniqueLocations.size).toBe(allLocations.length)
      // Second group should have addresses after the first
      expect(groups[1].ioPoints![0].iecLocation).toBe('%IX0.2')
      expect(groups[1].ioPoints![1].iecLocation).toBe('%IX0.3')
    })

    it('does nothing when device has no modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.addIOGroup('EtherCAT', makeIOGroup('g1', '3', 2))
      expect(result.ok).toBe(true)
    })

    it('handles unknown function code with default case', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      // Force an unknown function code to hit the default case in getFunctionCodeInfo
      const group = makeIOGroup('g1', '99' as ModbusIOGroup['functionCode'], 1)
      store.getState().projectActions.addIOGroup('Dev1', group)
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups).toHaveLength(1)
      // Default returns: type 'Unknown', iecPrefix '%MW', isBit false
      expect(groups[0].ioPoints![0].type).toBe('Unknown')
      expect(groups[0].ioPoints![0].iecLocation).toBe('%MW0')
    })

    it('skips word addresses that are already used (word-based collision)', () => {
      // Create a device and manually seed an IO group with pre-existing word addresses
      const device = makeRemoteDevice('Dev1')
      device.modbusTcpConfig!.ioGroups = [
        {
          id: 'pre-existing',
          name: 'pre-existing',
          functionCode: '3',
          cycleTime: 100,
          offset: '0',
          length: 2,
          errorHandling: 'keep-last-value',
          ioPoints: [
            { id: 'p0', name: 'p0', type: 'Analog Input (Holding Register)', iecLocation: '%IW0', alias: '' },
            { id: 'p1', name: 'p1', type: 'Analog Input (Holding Register)', iecLocation: '%IW1', alias: '' },
          ],
        },
      ]
      seedRemoteDevice(store, device)

      // Add a second group that uses the same function code => same address space
      // The generator should skip %IW0 and %IW1 and start at %IW2
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '3', 2))
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups[1].ioPoints![0].iecLocation).toBe('%IW2')
      expect(groups[1].ioPoints![1].iecLocation).toBe('%IW3')
    })

    it('recompacts bit addresses project-wide, closing a pre-existing gap', () => {
      // A pre-existing group carries a manual gap (%IX0.0 then %IX0.2).
      const device = makeRemoteDevice('Dev1')
      device.modbusTcpConfig!.ioGroups = [
        {
          id: 'pre-existing',
          name: 'pre-existing',
          functionCode: '1',
          cycleTime: 100,
          offset: '0',
          length: 2,
          errorHandling: 'keep-last-value',
          ioPoints: [
            { id: 'p0', name: 'p0', type: 'Digital Input (Coil Status)', iecLocation: '%IX0.0', alias: '' },
            { id: 'p1', name: 'p1', type: 'Digital Input (Coil Status)', iecLocation: '%IX0.2', alias: '' },
          ],
        },
      ]
      seedRemoteDevice(store, device)

      // Adding a group triggers the central recalculation: the whole Modbus
      // space re-packs, so the pre-existing group closes its gap
      // (%IX0.0/%IX0.1) and the new group packs right after (%IX0.2/%IX0.3).
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '1', 2))
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups[0].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IX0.0', '%IX0.1'])
      expect(groups[1].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IX0.2', '%IX0.3'])
    })

    it('ignores VPP claims on a target whose caps do not include vppIo', () => {
      // Regression: a project saved with target SLM-RP4 carries VPP
      // entries in vendorScreenData.io-mapping. When the user switches
      // to plain Runtime v4 (vppIo=false), those claims become
      // inactive — adding a Modbus group must allocate from %IW0
      // upward, not skip past the inactive VPP block.
      store.getState().deviceActions.setVendorScreenData('io-mapping', {
        entries: [
          {
            slot: 1,
            moduleId: 'm',
            moduleName: 'M',
            channelName: 'AI0',
            channelType: 'analogInput',
            dataType: 'INT',
            iecAddress: '%IW0',
            alias: '',
          },
          {
            slot: 1,
            moduleId: 'm',
            moduleName: 'M',
            channelName: 'AI1',
            channelType: 'analogInput',
            dataType: 'INT',
            iecAddress: '%IW1',
            alias: '',
          },
          {
            slot: 1,
            moduleId: 'm',
            moduleName: 'M',
            channelName: 'AI2',
            channelType: 'analogInput',
            dataType: 'INT',
            iecAddress: '%IW2',
            alias: '',
          },
          {
            slot: 1,
            moduleId: 'm',
            moduleName: 'M',
            channelName: 'AI3',
            channelType: 'analogInput',
            dataType: 'INT',
            iecAddress: '%IW3',
            alias: '',
          },
        ],
      })

      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))

      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points[0].iecLocation).toBe('%IW0')
      expect(points[1].iecLocation).toBe('%IW1')
    })
  })

  describe('updateIOGroup', () => {
    beforeEach(() => {
      seedRuntimeV4Board(store)
    })

    it('updates an IO group by id', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const result = store.getState().projectActions.updateIOGroup('Dev1', 'g1', { name: 'renamed' })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].name).toBe('renamed')
    })

    it('does nothing when group not found', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      store.getState().projectActions.updateIOGroup('Dev1', 'missing', { name: 'nope' })
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].name).toBe('group-g1')
    })

    it('does nothing when device has no modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.updateIOGroup('EtherCAT', 'g1', { name: 'x' })
      expect(result.ok).toBe(true)
    })

    it('regenerates ioPoints when the length grows (edit size)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints).toHaveLength(2)

      store.getState().projectActions.updateIOGroup('Dev1', 'g1', { length: 4 })
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points).toHaveLength(4)
      expect(points.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1', '%IW2', '%IW3'])
    })

    it('regenerates ioPoints when the length shrinks (edit size)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 4))
      store.getState().projectActions.updateIOGroup('Dev1', 'g1', { length: 1 })
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points).toHaveLength(1)
      expect(points[0].iecLocation).toBe('%IW0')
    })

    it('re-derives addresses under the new prefix when the function code changes', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2)) // FC3 -> %IW
      store.getState().projectActions.updateIOGroup('Dev1', 'g1', { functionCode: '1' }) // FC1 -> %IX
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points.map((p) => p.iecLocation)).toEqual(['%IX0.0', '%IX0.1'])
    })

    it('recompacts sibling groups project-wide after an edit (central registry)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2)) // %IW0,1
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '3', 2)) // %IW2,3

      // Grow g1 to 3 points. The central recalculation re-packs the whole
      // Modbus space in group order: g1 → %IW0/1/2, g2 slides to %IW3/4.
      store.getState().projectActions.updateIOGroup('Dev1', 'g1', { length: 3 })
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups[0].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1', '%IW2'])
      expect(groups[1].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IW3', '%IW4'])
    })

    it('preserves point aliases positionally when regenerating', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'Temp')

      store.getState().projectActions.updateIOGroup('Dev1', 'g1', { length: 3 })
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points).toHaveLength(3)
      expect(points[0].alias).toBe('Temp') // survived the reshuffle
      expect(points[2].alias).toBe('') // freshly allocated slot
    })
  })

  describe('deleteIOGroup', () => {
    beforeEach(() => {
      seedRuntimeV4Board(store)
    })

    it('deletes an IO group by id', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '3', 2))
      const result = store.getState().projectActions.deleteIOGroup('Dev1', 'g1')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups).toHaveLength(1)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].id).toBe('g2')
    })

    it('does nothing when device has no modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.deleteIOGroup('EtherCAT', 'g1')
      expect(result.ok).toBe(true)
    })

    it('recompacts the surviving groups into the freed slots (bug #4)', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2)) // %IW0,1
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '3', 2)) // %IW2,3
      store.getState().projectActions.deleteIOGroup('Dev1', 'g1')
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups).toHaveLength(1)
      // g2 slides down into the freed slots — no gap left behind.
      expect(groups[0].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1'])
    })
  })

  describe('recalculateIecAddresses (central registry)', () => {
    beforeEach(() => {
      seedRuntimeV4Board(store)
    })

    it('recompacts across devices when a whole device is removed', () => {
      seedRemoteDevice(store, makeRemoteDevice('A'))
      seedRemoteDevice(store, makeRemoteDevice('B'))
      store.getState().projectActions.addIOGroup('A', makeIOGroup('ga', '3', 2)) // %IW0,1
      store.getState().projectActions.addIOGroup('B', makeIOGroup('gb', '3', 2)) // %IW2,3
      store.getState().projectActions.deleteRemoteDevice('A')
      const devices = store.getState().project.data.remoteDevices!
      expect(devices).toHaveLength(1)
      // B's group reclaims device A's freed addresses project-wide.
      expect(devices[0].modbusTcpConfig!.ioGroups[0].ioPoints!.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1'])
    })

    it('is a benign no-op with no remote devices', () => {
      const result = store.getState().projectActions.recalculateIecAddresses()
      expect(result.ok).toBe(true)
    })

    it('activates pin-mapping / VPP kinds when the target supports them', () => {
      // A board that exposes pin mapping AND VPP I/O — exercises those
      // capability branches. Modbus still allocates around them.
      seedVppBoard(store)
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      expect(points.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1'])
    })

    it('reallocates and writes back VPP io-mapping entries (compacting a gap)', () => {
      seedVppBoard(store)
      // A VPP entry sitting at %QX0.5 with a manual gap below it.
      store.getState().deviceActions.setVendorScreenData('io-mapping', {
        entries: [
          {
            slot: 1,
            channelName: 'DO1',
            channelType: 'coil',
            dataType: 'BOOL',
            moduleId: 'mod-a',
            iecAddress: '%QX0.5',
            alias: '',
          },
          // An unparseable address is skipped by the migration → left verbatim.
          {
            slot: 1,
            channelName: 'BAD',
            channelType: 'coil',
            dataType: 'BOOL',
            moduleId: 'mod-a',
            iecAddress: 'NOPE',
            alias: '',
          },
        ],
      })
      store.getState().projectActions.recalculateIecAddresses()
      const entries = (
        store.getState().deviceDefinitions.configuration.vendorScreenData!['io-mapping'] as {
          entries: Array<{ iecAddress: string }>
        }
      ).entries
      // The valid VPP channel compacts to the lowest free %QX slot; the
      // unmapped entry is returned unchanged.
      expect(entries[0].iecAddress).toBe('%QX0.0')
      expect(entries[1].iecAddress).toBe('NOPE')
    })

    it('skips devices without a Modbus config during writeback', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 1))
      const result = store.getState().projectActions.recalculateIecAddresses()
      expect(result.ok).toBe(true)
      expect(
        store.getState().project.data.remoteDevices![1].modbusTcpConfig!.ioGroups[0].ioPoints![0].iecLocation,
      ).toBe('%IW0')
    })

    it('restores a remembered alias onto a reappeared channel via recalc', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 1))
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      // Simulate the alias having been set earlier (recorded in session memory)
      // while the channel is currently alias-less (as after a remove/re-add).
      store.getState().projectActions.rememberChannelAlias(modbusMemoryKey('Dev1', 'g1', pointId), 'temp_sensor')
      store.getState().projectActions.recalculateIecAddresses()
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].alias).toBe(
        'temp_sensor',
      )
    })
  })

  describe('rememberChannelAlias', () => {
    it('stores an alias under its memory key and clears it when emptied', () => {
      const key = vppMemoryKey('mod-a', 1, 'DO1')
      store.getState().projectActions.rememberChannelAlias(key, '  relay_1  ')
      expect(store.getState().iecAliasMemory[key]).toBe('relay_1')
      store.getState().projectActions.rememberChannelAlias(key, '   ')
      expect(store.getState().iecAliasMemory[key]).toBeUndefined()
    })

    it('is reset on a fresh project so aliases do not leak between projects', () => {
      store.getState().projectActions.rememberChannelAlias(vppMemoryKey('mod-a', 1, 'DO1'), 'relay_1')
      store.getState().projectActions.clearProjects()
      expect(store.getState().iecAliasMemory).toEqual({})
    })
  })

  describe('updateIOPointAlias', () => {
    beforeEach(() => {
      seedRuntimeV4Board(store)
    })

    it('updates a point alias', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      const result = store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'Temperature')
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].alias).toBe(
        'Temperature',
      )
    })

    it('does nothing when group not found', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const result = store.getState().projectActions.updateIOPointAlias('Dev1', 'missing', 'p1', 'alias')
      expect(result.ok).toBe(true)
    })

    it('does nothing when point not found', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const result = store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', 'missing-point', 'alias')
      expect(result.ok).toBe(true)
    })

    it('does nothing when device has no modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.updateIOPointAlias('EtherCAT', 'g1', 'p1', 'alias')
      expect(result.ok).toBe(true)
    })

    it('rejects an alias that is already assigned to another channel', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const points = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints!
      // Claim "dup" on the first point, then try to reuse it on the second.
      store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', points[0].id, 'dup')
      const result = store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', points[1].id, 'dup')
      expect(result.ok).toBe(false)
      expect(result.title).toBe('Alias already in use')
      // The rejected write never lands.
      expect(store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![1].alias).toBe('')
    })

    it('cascades a rename onto variables bound to the point’s previous alias', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      // First set an alias, then bind a program variable to it by name.
      store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'sensor_a')
      seedPou(store, makePou('Prog', 'program', [locVar('reading', 'sensor_a')]))
      // Renaming the point alias must follow the binding to the new name.
      store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'sensor_b')
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('sensor_b')
    })
  })

  describe('renameAlias', () => {
    it('cascades onto bound POU and global variable locations, leaving manual literals untouched', () => {
      seedPou(store, makePou('Prog', 'program', [locVar('bound', 'relay_1'), locVar('manual', '%QX0.0')]))
      seedGlobals(store, [locVar('gBound', 'relay_1', 'global')])
      const result = store.getState().projectActions.renameAlias('relay_1', 'relay_2')
      expect(result.renamed).toBe(2)
      const vars = store.getState().project.data.pous[0].interface!.variables!
      expect(vars[0].location).toBe('relay_2') // alias-bound → follows the rename
      expect(vars[1].location).toBe('%QX0.0') // manual literal → untouched
      expect(store.getState().project.data.configurations.resource.globalVariables![0].location).toBe('relay_2')
    })

    it('cascades a case-only change (the alias registry is case-sensitive)', () => {
      seedPou(store, makePou('Prog', 'program', [locVar('bound', 'Relay')]))
      const result = store.getState().projectActions.renameAlias('Relay', 'relay')
      expect(result.renamed).toBe(1)
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('relay')
    })

    it('leaves bound variable locations untouched (orphaned) when the alias is cleared', () => {
      seedPou(store, makePou('Prog', 'program', [locVar('bound', 'relay_1')]))
      const result = store.getState().projectActions.renameAlias('relay_1', '')
      // Clearing an alias is a deletion, not a rename: the bound variable keeps
      // the now-missing alias name and orphans (surfaces the warning glyph),
      // rather than being silently wiped. Same behavior as deleting the device.
      expect(result.renamed).toBe(0)
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('relay_1')
    })

    it('is a no-op when the old alias is empty', () => {
      seedPou(store, makePou('Prog', 'program', [locVar('bound', 'relay_1')]))
      const result = store.getState().projectActions.renameAlias('', 'relay_2')
      expect(result.renamed).toBe(0)
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('relay_1')
    })

    it('is a no-op when the name is unchanged', () => {
      seedPou(store, makePou('Prog', 'program', [locVar('bound', 'relay_1')]))
      const result = store.getState().projectActions.renameAlias('relay_1', 'relay_1')
      expect(result.renamed).toBe(0)
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('relay_1')
    })
  })

  describe('getCompileReadyProjectData', () => {
    beforeEach(() => {
      seedRuntimeV4Board(store)
    })

    it('resolves alias locations to addresses, honours manual literals, and drops missing aliases', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2)) // %IW0, %IW1
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'flow') // flow → %IW0

      seedPou(
        store,
        makePou('Prog', 'program', [
          locVar('aliasBound', 'flow'), // → %IW0
          locVar('manual', '%QX0.0'), // → %QX0.0 (verbatim)
          locVar('ghost', 'no_such_alias'), // → '' (alias gone)
          locVar('unlocated', ''), // → ''
        ]),
      )
      // A POU whose interface carries no `variables` array — the resolver must
      // skip it without throwing (early-return guard).
      const current = store.getState().project
      store.getState().projectActions.setProject({
        ...current,
        data: {
          ...current.data,
          pous: [
            ...current.data.pous,
            {
              name: 'NoVars',
              pouType: 'program',
              interface: {},
              body: makeBody(),
              documentation: '',
            } as unknown as PLCPou,
          ],
        },
      })
      seedGlobals(store, [locVar('gFlow', 'flow', 'global')]) // → %IW0

      const data = store.getState().projectActions.getCompileReadyProjectData()
      const resolved = data.pous[0].interface!.variables!
      expect(resolved.map((v) => v.location)).toEqual(['%IW0', '%QX0.0', '', ''])
      expect(data.configurations.resource.globalVariables![0].location).toBe('%IW0')

      // The live store keeps the alias-name form — only the returned snapshot
      // is resolved.
      expect(store.getState().project.data.pous[0].interface!.variables![0].location).toBe('flow')
    })
  })

  // -------------------------------------------------------------------------
  // Defensive guard coverage — operations on servers missing expected configs
  // -------------------------------------------------------------------------

  describe('defensive guards for missing configs', () => {
    it('deleteVariable by rowId/variableId when variable not found returns fail', () => {
      seedPou(store, makePou('MyProg', 'program'))
      const result = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'MyProg',
        rowId: 99,
      })
      expect(result.ok).toBe(false)
    })

    it('rearrangeStructureVariables when item at rowId does not exist', () => {
      store.getState().projectActions.createDatatype({
        data: { name: 'MyStruct', derivation: 'structure', variable: [] },
      })
      store.getState().projectActions.rearrangeStructureVariables({
        associatedDataType: 'MyStruct',
        rowId: 99,
        newIndex: 0,
      })
      expect(store.getState().project.data.dataTypes[0]).toEqual({
        name: 'MyStruct',
        derivation: 'structure',
        variable: [],
      })
    })

    it('createServer when servers array is initially undefined', () => {
      store.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, servers: undefined as unknown as PLCServer[] },
        },
      }))
      const result = store.getState().projectActions.createServer({
        data: { name: 'S1', protocol: 'modbus-tcp' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers).toHaveLength(1)
    })

    it('deleteServer when servers array is undefined', () => {
      store.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, servers: undefined as unknown as PLCServer[] },
        },
      }))
      const result = store.getState().projectActions.deleteServer('missing')
      expect(result.ok).toBe(true)
    })

    it('updateServerName when servers array is empty', () => {
      const result = store.getState().projectActions.updateServerName('missing', 'newName')
      expect(result.ok).toBe(true)
    })

    it('updateServerConfig on a server without modbusSlaveConfig', () => {
      seedServer(store, { name: 'S7', protocol: 's7comm' })
      const result = store.getState().projectActions.updateServerConfig('S7', { enabled: true })
      expect(result.ok).toBe(true)
    })

    it('updateS7CommServerSettings on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateS7CommServerSettings('Modbus', { enabled: true })
      expect(result.ok).toBe(true)
    })

    it('updateS7CommPlcIdentity on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateS7CommPlcIdentity('Modbus', { name: 'Test' })
      expect(result.ok).toBe(true)
    })

    it('addS7CommDataBlock on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.addS7CommDataBlock('Modbus', {
        dbNumber: 1,
        description: 'DB',
        sizeBytes: 100,
        mapping: { type: 'input', startBuffer: 0, bitAddressing: false },
      })
      expect(result.ok).toBe(true)
    })

    it('updateS7CommDataBlock on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateS7CommDataBlock('Modbus', 0, { description: 'Updated' })
      expect(result.ok).toBe(true)
    })

    it('removeS7CommDataBlock on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.removeS7CommDataBlock('Modbus', 0)
      expect(result.ok).toBe(true)
    })

    it('updateS7CommSystemArea on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateS7CommSystemArea('Modbus', 'peArea', { enabled: true })
      expect(result.ok).toBe(true)
    })

    it('updateS7CommLogging on a server without s7commSlaveConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateS7CommLogging('Modbus', { logErrors: false })
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaServerConfig on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateOpcUaServerConfig('Modbus', { enabled: true })
      expect(result.ok).toBe(true)
    })

    it('addOpcUaSecurityProfile on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.addOpcUaSecurityProfile('Modbus', {
        id: 'p1',
        name: 'test',
        enabled: true,
        securityPolicy: 'None',
        securityMode: 'None',
        authMethods: ['Anonymous'],
      })
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaSecurityProfile on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateOpcUaSecurityProfile('Modbus', 'p1', { enabled: false })
      expect(result.ok).toBe(true)
    })

    it('removeOpcUaSecurityProfile on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.removeOpcUaSecurityProfile('Modbus', 'p1')
      expect(result.ok).toBe(true)
    })

    it('addOpcUaUser on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.addOpcUaUser('Modbus', {
        id: 'u1',
        type: 'password',
        username: 'admin',
        passwordHash: 'hash',
        certificateId: null,
        role: 'engineer',
      })
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaUser on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateOpcUaUser('Modbus', 'u1', { role: 'viewer' })
      expect(result.ok).toBe(true)
    })

    it('removeOpcUaUser on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.removeOpcUaUser('Modbus', 'u1')
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaServerCertificateStrategy on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store
        .getState()
        .projectActions.updateOpcUaServerCertificateStrategy('Modbus', 'custom', 'cert', 'key')
      expect(result.ok).toBe(true)
    })

    it('addOpcUaTrustedCertificate on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.addOpcUaTrustedCertificate('Modbus', { id: 'c1', pem: 'data' })
      expect(result.ok).toBe(true)
    })

    it('removeOpcUaTrustedCertificate on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.removeOpcUaTrustedCertificate('Modbus', 'c1')
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaAddressSpaceNamespace on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateOpcUaAddressSpaceNamespace('Modbus', 'urn:test')
      expect(result.ok).toBe(true)
    })

    it('addOpcUaNode on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.addOpcUaNode('Modbus', {
        id: 'n1',
        pouName: 'MyProg',
        variablePath: 'v',
        variableType: 'BOOL',
        nodeId: 'ns=1;s=v',
        browseName: 'v',
        displayName: 'v',
        description: '',
        permissions: { viewer: 'r', operator: 'rw', engineer: 'rw' },
        nodeType: 'variable',
      })
      expect(result.ok).toBe(true)
    })

    it('updateOpcUaNode on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.updateOpcUaNode('Modbus', 'n1', { displayName: 'Updated' })
      expect(result.ok).toBe(true)
    })

    it('removeOpcUaNode on a server without opcuaServerConfig', () => {
      seedServer(store, { name: 'Modbus', protocol: 'modbus-tcp' })
      const result = store.getState().projectActions.removeOpcUaNode('Modbus', 'n1')
      expect(result.ok).toBe(true)
    })

    it('createRemoteDevice when remoteDevices array is undefined', () => {
      store.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, remoteDevices: undefined as unknown as PLCRemoteDevice[] },
        },
      }))
      const result = store.getState().projectActions.createRemoteDevice({
        data: { name: 'RD1', protocol: 'modbus-tcp' },
      })
      expect(result.ok).toBe(true)
    })

    it('deleteRemoteDevice when remoteDevices array is undefined', () => {
      store.setState((s) => ({
        project: {
          ...s.project,
          data: { ...s.project.data, remoteDevices: undefined as unknown as PLCRemoteDevice[] },
        },
      }))
      const result = store.getState().projectActions.deleteRemoteDevice('missing')
      expect(result.ok).toBe(true)
    })

    it('updateRemoteDeviceConfig on a device without modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.updateRemoteDeviceConfig('EtherCAT', { host: '10.0.0.1' })
      expect(result.ok).toBe(true)
    })

    it('updateRemoteDeviceConfig with partial config (only port, no host)', () => {
      seedRemoteDevice(store, makeRemoteDevice('ModDev'))
      const result = store.getState().projectActions.updateRemoteDeviceConfig('ModDev', { port: 503 })
      expect(result.ok).toBe(true)
      const device = store.getState().project.data.remoteDevices?.find((d) => d.name === 'ModDev')
      expect(device?.modbusTcpConfig?.port).toBe(503)
      // host should remain unchanged (false branch of config.host !== undefined)
      expect(device?.modbusTcpConfig?.host).toBe('127.0.0.1')
    })

    it('addIOGroup on a device without modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.addIOGroup('EtherCAT', makeIOGroup('g1', '3', 2))
      expect(result.ok).toBe(true)
    })

    it('updateIOGroup on a device without modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.updateIOGroup('EtherCAT', 'g1', { name: 'updated' })
      expect(result.ok).toBe(true)
    })

    it('deleteIOGroup on a device without modbusTcpConfig', () => {
      seedRemoteDevice(store, { name: 'EtherCAT', protocol: 'ethercat' })
      const result = store.getState().projectActions.deleteIOGroup('EtherCAT', 'g1')
      expect(result.ok).toBe(true)
    })

    it('clearPendingDeletions resets the array', () => {
      // Create and delete a POU to generate pending deletions
      store.getState().projectActions.createPou({
        type: 'program',
        data: { name: 'TmpPou', language: 'st', body: makeBody(), variables: [], documentation: '' },
      })
      store.getState().projectActions.deletePou('TmpPou')
      expect(store.getState().pendingDeletions.length).toBeGreaterThan(0)

      store.getState().projectActions.clearPendingDeletions()
      expect(store.getState().pendingDeletions).toEqual([])
    })

    it('createVariable fails for illegal variable name', () => {
      seedPou(store, makePou('Main'))
      // Names starting with digits are illegal identifiers
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: {
          ...makeVariable('123invalid'),
        },
      })
      expect(result.ok).toBe(false)
      expect(result.title).toBe('Illegal Variable Name')
    })

    it('updateVariable fails when validation rejects duplicate name', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('alpha'), makeVariable('beta')]))
      // Try to rename 'beta' to 'alpha' (already exists)
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 1,
        data: { name: 'alpha' },
      })
      expect(result.ok).toBe(false)
      expect(result.title).toBe('Variable already exists')
    })

    it('deleteVariable for global scope using variableName', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gVar1', 'global') })
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gVar2', 'global') })
      const result = store.getState().projectActions.deleteVariable({
        scope: 'global',
        variableName: 'gVar1',
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.configurations.resource.globalVariables).toHaveLength(1)
      expect(store.getState().project.data.configurations.resource.globalVariables[0].name).toBe('gVar2')
    })

    it('deleteVariable for global scope blocked by external references', () => {
      // Create a global variable
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('SharedVar', 'global') })
      // Create a POU with an external variable referencing SharedVar
      seedPou(store, {
        ...makePou('Consumer', 'program'),
        interface: {
          variables: [
            {
              name: 'SharedVar',
              class: 'external',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
            },
          ],
        },
      })
      const result = store.getState().projectActions.deleteVariable({
        scope: 'global',
        variableName: 'SharedVar',
      })
      expect(result.ok).toBe(false)
      expect(result.title).toBe('Cannot Delete Global Variable')
      expect(result.message).toContain('Consumer')
    })

    it('updateOpcUaServerConfig with top-level updates (cycleTimeMs)', () => {
      seedServer(store, makeOpcUaServer('OPC'))
      const result = store.getState().projectActions.updateOpcUaServerConfig('OPC', {
        cycleTimeMs: 200,
      } as Record<string, unknown>)
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.servers![0].opcuaServerConfig!.cycleTimeMs).toBe(200)
    })

    it('reconcile no-ops when no editor matches the POU', () => {
      // POU exists but no editor for it — variable-text path can't
      // be active, so reconcile must short-circuit and let the
      // mutation through unchanged.
      seedPou(store, makePou('Untracked', 'program'))
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Untracked',
        data: {
          name: 'V',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
        },
      })
      expect(result.ok).toBe(true)
    })

    it('reconcile no-ops when editor is in table mode', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('Existing')]))
      store.getState().editorActions.addModel({
        type: 'plc-textual',
        meta: { name: 'Main', path: '/Main.st', language: 'st', pouType: 'program' },
        variable: { display: 'table', selectedRow: '-1', classFilter: 'All', description: '' },
      })
      store.getState().editorActions.setEditor({
        type: 'plc-textual',
        meta: { name: 'Main', path: '/Main.st', language: 'st', pouType: 'program' },
        variable: { display: 'table', selectedRow: '-1', classFilter: 'All', description: '' },
      })
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: {
          name: 'NewVar',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
        },
      })
      expect(result.ok).toBe(true)
      // Editor still in table mode — no `editor.variable.code`
      // assignment happened, so display stays 'table'.
      const editor = store.getState().editor
      expect(editor.type).toBe('plc-textual')
      if (editor.type === 'plc-textual') {
        expect(editor.variable.display).toBe('table')
      }
    })

    it('reconcile parses text + regenerate writes back when code-mode buffer is valid', () => {
      // The user has been editing the text directly: text says
      // `Manually` exists, but the table still holds `Original`.
      // A block drop calls `createVariable('FromBlock')` — reconcile
      // must adopt the text's `Manually`, then add `FromBlock`, then
      // re-serialize so the buffer reflects both.
      seedPou(store, makePou('Main', 'program', [makeVariable('Original')]))
      const dirtyText = 'VAR\n\tManually : DINT;\nEND_VAR'
      const model = {
        type: 'plc-textual' as const,
        meta: { name: 'Main', path: '/Main.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'code' as const, code: dirtyText },
      }
      store.getState().editorActions.addModel(model)
      store.getState().editorActions.setEditor(model)

      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: {
          name: 'FromBlock',
          class: 'local',
          type: { definition: 'derived', value: 'testing' },
          location: '',
          documentation: '',
        },
      })

      expect(result.ok).toBe(true)
      const finalVars = store.getState().project.data.pous[0].interface!.variables
      expect(finalVars.map((v) => v.name).sort()).toEqual(['FromBlock', 'Manually'])
      // The buffer is rewritten from the new variables array.
      const editor = store.getState().editor
      if (editor.type === 'plc-textual' && editor.variable.display === 'code') {
        expect(editor.variable.code).toContain('Manually')
        expect(editor.variable.code).toContain('FromBlock')
      } else {
        throw new Error('editor expected to remain in code mode')
      }
    })

    it('reconcile refuses external mutation when code-mode buffer fails to parse', () => {
      // User typed something that doesn't parse; an unrelated block
      // drop must be blocked so the user's invalid edit is not
      // silently clobbered.  The variables array stays untouched.
      seedPou(store, makePou('Main', 'program', [makeVariable('Original')]))
      const brokenText = 'VAR\n\tno colon here\nEND_VAR'
      const model = {
        type: 'plc-textual' as const,
        meta: { name: 'Main', path: '/Main.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'code' as const, code: brokenText },
      }
      store.getState().editorActions.addModel(model)
      store.getState().editorActions.setEditor(model)

      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: {
          name: 'FromBlock',
          class: 'local',
          type: { definition: 'derived', value: 'testing' },
          location: '',
          documentation: '',
        },
      })

      expect(result.ok).toBe(false)
      expect(result.title).toBe('Variables table is invalid')
      expect(store.getState().project.data.pous[0].interface!.variables.map((v) => v.name)).toEqual(['Original'])
    })

    it('reconcile is a no-op when buffer matches serialized variables', () => {
      // Editor in code mode but the buffer is exactly the canonical
      // serialization of the current variables — the user hasn't
      // typed anything, so reconcile should skip the parse entirely
      // (and still regenerate after the new variable lands).
      seedPou(store, makePou('Main', 'program', [makeVariable('Existing')]))
      // Use the production serializer so the byte-for-byte format
      // (2-space block indent, 4-space decl indent, class-grouped
      // VAR blocks) stays in lockstep without us mirroring the
      // template here.
      const existing = store.getState().project.data.pous[0].interface!.variables
      const cleanText = generateIecVariablesToString(existing)
      const model = {
        type: 'plc-textual' as const,
        meta: { name: 'Main', path: '/Main.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'code' as const, code: cleanText },
      }
      store.getState().editorActions.addModel(model)
      store.getState().editorActions.setEditor(model)

      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: {
          name: 'Added',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
        },
      })

      expect(result.ok).toBe(true)
      const editor = store.getState().editor
      if (editor.type === 'plc-textual' && editor.variable.display === 'code') {
        expect(editor.variable.code).toContain('Added')
        expect(editor.variable.code).toContain('Existing')
      } else {
        throw new Error('editor expected to remain in code mode')
      }
    })

    it('reconcile blocks updateVariable + deleteVariable when buffer is invalid', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('X')]))
      // Inside an opened VAR block, a line without `:` triggers the
      // parser's "unrecognized declaration" path — guaranteed to
      // throw, exercising the reconcile-refusal branch.
      const brokenText = 'VAR\n\tno-colon-here garbage\nEND_VAR'
      const model = {
        type: 'plc-textual' as const,
        meta: { name: 'Main', path: '/Main.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'code' as const, code: brokenText },
      }
      store.getState().editorActions.addModel(model)
      store.getState().editorActions.setEditor(model)

      const upd = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 0,
        data: { name: 'X2' },
      })
      expect(upd.ok).toBe(false)

      const del = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 0,
      })
      expect(del.ok).toBe(false)

      // Both mutations were blocked — original variable still there.
      expect(store.getState().project.data.pous[0].interface!.variables.map((v) => v.name)).toEqual(['X'])
    })

    it('reconcile uses inactive-editor snapshot when the active editor is on a different POU', () => {
      // Multi-mount keeps inactive editors live in `state.editors[]`.
      // External mutation on POU A while the user has POU B focused
      // must reconcile A's snapshot, not B's.
      seedPou(store, makePou('A', 'program', [makeVariable('OldA')]))
      seedPou(store, makePou('B', 'program', [makeVariable('OldB')]))
      const modelA = {
        type: 'plc-textual' as const,
        meta: { name: 'A', path: '/A.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'code' as const, code: 'VAR\n\tFromText : DINT;\nEND_VAR' },
      }
      const modelB = {
        type: 'plc-textual' as const,
        meta: { name: 'B', path: '/B.st', language: 'st' as const, pouType: 'program' as const },
        variable: { display: 'table' as const, selectedRow: '-1', classFilter: 'All' as const, description: '' },
      }
      store.getState().editorActions.addModel(modelA)
      store.getState().editorActions.addModel(modelB)
      store.getState().editorActions.setEditor(modelB)

      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'A',
        data: {
          name: 'FromBlock',
          class: 'local',
          type: { definition: 'derived', value: 'testing' },
          location: '',
          documentation: '',
        },
      })

      expect(result.ok).toBe(true)
      const pouA = store.getState().project.data.pous.find((p) => p.name === 'A')!
      expect(pouA.interface!.variables.map((v) => v.name).sort()).toEqual(['FromBlock', 'FromText'])
    })

    it('updateVariable with class change propagates validation data', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        rowId: 0,
        data: { class: 'input' },
      })
      expect(result.ok).toBe(true)
      expect(store.getState().project.data.pous[0].interface?.variables[0].class).toBe('input')
    })

    it('deleteVariable for global scope when variableName not found returns fail', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('exists', 'global') })
      const result = store.getState().projectActions.deleteVariable({
        scope: 'global',
        variableName: 'doesNotExist',
      })
      expect(result.ok).toBe(false)
      // The existing variable should still be there
      expect(store.getState().project.data.configurations.resource.globalVariables).toHaveLength(1)
    })
  })
})
