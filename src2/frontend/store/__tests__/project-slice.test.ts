import { createStore } from 'zustand/vanilla'

import type {
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
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSlice, ProjectState } from '../slices/project/types'

function makeStore() {
  return createStore<ProjectSlice>()(createProjectSlice)
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
    mapping: { startByte: 0, endByte: 127, iecAddresses: [] },
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
    initialValue: 0,
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

    it('fails when local variable already exists', () => {
      seedPou(store, makePou('Main', 'program', [makeVariable('x')]))
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'Main',
        data: makeVariable('x'),
      })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Variable already exists')
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

    it('fails when global variable already exists', () => {
      store.getState().projectActions.createVariable({ scope: 'global', data: makeVariable('gx', 'global') })
      const result = store.getState().projectActions.createVariable({
        scope: 'global',
        data: makeVariable('gx', 'global'),
      })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Variable already exists')
    })

    it('does nothing for local scope when POU interface is missing', () => {
      const pou: PLCPou = { name: 'NoIface', pouType: 'program', body: makeBody() }
      seedPou(store, pou)
      // Variable is checked against the empty interface -- pou has no interface, so findIndex returns fail
      const result = store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'NoIface',
        data: makeVariable('x'),
      })
      // The pou is found but the pou.interface?.variables is undefined so the check uses []
      // The create succeeds validation but produce does nothing because pou?.interface is falsy
      expect(result.ok).toBe(true)
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
        data: { location: '%QX0.0' },
      })
      expect(store.getState().project.data.configurations.resource.globalVariables[0].location).toBe('%QX0.0')
    })

    it('returns ok even when variable not found (no-op)', () => {
      seedPou(store, makePou('Main'))
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Main',
        variableId: 'nonexistent',
        data: { name: 'foo' },
      })
      expect(result.ok).toBe(true)
    })

    it('returns ok when variables array is not available (POU not found)', () => {
      const result = store.getState().projectActions.updateVariable({
        scope: 'local',
        associatedPou: 'Missing',
        variableId: 'x',
        data: { name: 'foo' },
      })
      expect(result.ok).toBe(true)
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

    it('returns ok even when variables array not available', () => {
      const result = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'Missing',
        variableId: 'x',
      })
      expect(result.ok).toBe(true)
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
        variable: [{ name: 'field1', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }],
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
          { name: 'a', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' },
          { name: 'b', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' },
          { name: 'c', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' },
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
      expect(server.s7commSlaveConfig?.plcIdentity.name).toBe('OpenPLC Runtime')
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
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.plcIdentity.name).toBe('Custom PLC')
      expect(store.getState().project.data.servers![0].s7commSlaveConfig!.plcIdentity.moduleType).toBe(
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
      const slaveConfig = store.getState().project.data.servers![0].s7commSlaveConfig as unknown as Record<string, unknown>
      const peArea = slaveConfig.peArea as { enabled: boolean; sizeBytes: number }
      expect(peArea.enabled).toBe(true)
      expect(peArea.sizeBytes).toBe(16)
    })

    it('updates an existing system area', () => {
      seedServer(store, makeS7CommServer('S7'))
      store.getState().projectActions.updateS7CommSystemArea('S7', 'mkArea', { enabled: true, sizeBytes: 8 })
      store.getState().projectActions.updateS7CommSystemArea('S7', 'mkArea', { sizeBytes: 32 })
      const slaveConfig = store.getState().project.data.servers![0].s7commSlaveConfig as unknown as Record<string, unknown>
      const mkArea = slaveConfig.mkArea as { enabled: boolean; sizeBytes: number }
      expect(mkArea.enabled).toBe(true)
      expect(mkArea.sizeBytes).toBe(32)
    })

    it('does nothing when server has no s7commSlaveConfig', () => {
      seedServer(store, makeModbusTcpServer('Modbus'))
      const result = store.getState().projectActions.updateS7CommSystemArea('Modbus', 'peArea', { enabled: true, sizeBytes: 1 })
      expect(result.ok).toBe(true)
    })
  })

  describe('updateS7CommLogging', () => {
    it('updates logging settings', () => {
      seedServer(store, makeS7CommServer('S7'))
      const result = store.getState().projectActions.updateS7CommLogging('S7', { logDataAccess: true })
      expect(result.ok).toBe(true)
      const logging = store.getState().project.data.servers![0].s7commSlaveConfig!.logging
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
        enabled: true,
        port: 4841,
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
      const result = store.getState().projectActions.updateOpcUaServerCertificateStrategy(
        'OPC',
        'custom',
        'CERT-PEM',
        'KEY-PEM',
      )
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
      const result = store.getState().projectActions.updateOpcUaAddressSpaceNamespace(
        'OPC',
        'urn:custom:namespace',
      )
      expect(result.ok).toBe(true)
      expect(
        store.getState().project.data.servers![0].opcuaServerConfig!.addressSpace.namespaceUri,
      ).toBe('urn:custom:namespace')
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

    it('skips bit addresses that are already used (bit-based collision with gaps)', () => {
      // Create a device with pre-existing bit addresses that have gaps
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
            // Skip %IX0.1 (gap) and use %IX0.2
            { id: 'p1', name: 'p1', type: 'Digital Input (Coil Status)', iecLocation: '%IX0.2', alias: '' },
          ],
        },
      ]
      seedRemoteDevice(store, device)

      // Add a new group; the generator should skip %IX0.0 (used), use %IX0.1 (free), skip %IX0.2 (used), use %IX0.3
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g2', '1', 2))
      const groups = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups
      expect(groups[1].ioPoints![0].iecLocation).toBe('%IX0.1')
      expect(groups[1].ioPoints![1].iecLocation).toBe('%IX0.3')
    })
  })

  describe('updateIOGroup', () => {
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
  })

  describe('deleteIOGroup', () => {
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
  })

  describe('updateIOPointAlias', () => {
    it('updates a point alias', () => {
      seedRemoteDevice(store, makeRemoteDevice('Dev1'))
      store.getState().projectActions.addIOGroup('Dev1', makeIOGroup('g1', '3', 2))
      const pointId = store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
      const result = store.getState().projectActions.updateIOPointAlias('Dev1', 'g1', pointId, 'Temperature')
      expect(result.ok).toBe(true)
      expect(
        store.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].alias,
      ).toBe('Temperature')
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
  })

  // -------------------------------------------------------------------------
  // Defensive guard coverage — operations on servers missing expected configs
  // -------------------------------------------------------------------------

  describe('defensive guards for missing configs', () => {
    it('deleteVariable by rowId/variableId when variable not found', () => {
      seedPou(store, makePou('MyProg', 'program'))
      const result = store.getState().projectActions.deleteVariable({
        scope: 'local',
        associatedPou: 'MyProg',
        rowId: 99,
      })
      expect(result.ok).toBe(true)
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
        mapping: { startByte: 0, endByte: 99, iecAddresses: [] },
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
      const result = store.getState().projectActions.updateOpcUaServerCertificateStrategy('Modbus', 'custom', 'cert', 'key')
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
        initialValue: false,
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
  })
})
