import {
  createDatatypeObject,
  createEditorObjectForDatatype,
  createEditorObjectForPou,
  createEditorObjectForRemoteDevice,
  createEditorObjectForServer,
  createPouObject,
  createTabObject,
} from '../slices/shared/utils'

describe('shared/utils', () => {
  // -------------------------------------------------------------------------
  // createPouObject
  // -------------------------------------------------------------------------
  describe('createPouObject', () => {
    it('creates a program with ST language and empty string body', () => {
      const result = createPouObject({ type: 'program', name: 'Main', language: 'st' })
      expect(result.type).toBe('program')
      expect(result.data.name).toBe('Main')
      expect(result.data.language).toBe('st')
      expect(result.data.body).toEqual({ language: 'st', value: '' })
      expect(result.data.variables).toEqual([])
      expect(result.data.documentation).toBe('')
    })

    it('creates a program with IL language', () => {
      const result = createPouObject({ type: 'program', name: 'IlProg', language: 'il' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({ language: 'il', value: '' })
    })

    it('creates a program with python language', () => {
      const result = createPouObject({ type: 'program', name: 'PyProg', language: 'python' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({ language: 'python', value: '' })
    })

    it('creates a program with cpp language', () => {
      const result = createPouObject({ type: 'program', name: 'CppProg', language: 'cpp' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({ language: 'cpp', value: '' })
    })

    it('creates a program with LD language and structured body', () => {
      const result = createPouObject({ type: 'program', name: 'LdProg', language: 'ld' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({
        language: 'ld',
        value: { name: 'LdProg', rungs: [] },
      })
    })

    it('creates a program with FBD language and structured body', () => {
      const result = createPouObject({ type: 'program', name: 'FbdProg', language: 'fbd' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({
        language: 'fbd',
        value: { name: 'FbdProg', rung: { comment: '', edges: [], nodes: [] } },
      })
    })

    it('creates a program with SFC language and empty string body', () => {
      const result = createPouObject({ type: 'program', name: 'SfcProg', language: 'sfc' })
      expect(result.type).toBe('program')
      expect(result.data.body).toEqual({ language: 'sfc', value: '' })
    })

    it('creates a function with returnType defaulting to BOOL', () => {
      const result = createPouObject({ type: 'function', name: 'Add', language: 'st' })
      expect(result.type).toBe('function')
      expect(result.data.name).toBe('Add')
      if (result.type === 'function') {
        expect(result.data.returnType).toBe('BOOL')
      }
    })

    it('creates a function-block without returnType', () => {
      const result = createPouObject({ type: 'function-block', name: 'Counter', language: 'st' })
      expect(result.type).toBe('function-block')
      expect(result.data.name).toBe('Counter')
      expect('returnType' in result.data).toBe(false)
    })

    it('creates a function with LD language', () => {
      const result = createPouObject({ type: 'function', name: 'LdFunc', language: 'ld' })
      expect(result.type).toBe('function')
      expect(result.data.body).toEqual({
        language: 'ld',
        value: { name: 'LdFunc', rungs: [] },
      })
    })

    it('creates a function-block with FBD language', () => {
      const result = createPouObject({ type: 'function-block', name: 'FbdBlock', language: 'fbd' })
      expect(result.type).toBe('function-block')
      expect(result.data.body).toEqual({
        language: 'fbd',
        value: { name: 'FbdBlock', rung: { comment: '', edges: [], nodes: [] } },
      })
    })
  })

  // -------------------------------------------------------------------------
  // createDatatypeObject
  // -------------------------------------------------------------------------
  describe('createDatatypeObject', () => {
    it('creates an array data type with base-type bool and empty initial value', () => {
      const result = createDatatypeObject({ name: 'IntArray', derivation: 'array' })
      expect(result.name).toBe('IntArray')
      expect(result.derivation).toBe('array')
      if (result.derivation === 'array') {
        expect(result.baseType).toEqual({ definition: 'base-type', value: 'BOOL' })
        // Empty stays empty — codegen omits `:= ...` for falsy
        // values, which keeps the array compile-clean if the user
        // later changes the base type without touching the initial
        // value field.
        expect(result.initialValue).toBe('')
        expect(result.dimensions).toEqual([])
      }
    })

    it('creates an enumerated data type with empty values', () => {
      const result = createDatatypeObject({ name: 'Colors', derivation: 'enumerated' })
      expect(result.name).toBe('Colors')
      expect(result.derivation).toBe('enumerated')
      if (result.derivation === 'enumerated') {
        expect(result.values).toEqual([])
        expect(result.initialValue).toBe('')
      }
    })

    it('creates a structure data type with empty variable list', () => {
      const result = createDatatypeObject({ name: 'Point', derivation: 'structure' })
      expect(result.name).toBe('Point')
      expect(result.derivation).toBe('structure')
      if (result.derivation === 'structure') {
        expect(result.variable).toEqual([])
      }
    })
  })

  // -------------------------------------------------------------------------
  // createEditorObjectForPou
  // -------------------------------------------------------------------------
  describe('createEditorObjectForPou', () => {
    it('creates a textual editor for ST program', () => {
      const result = createEditorObjectForPou('Main', 'program', 'st')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta).toEqual({ name: 'Main', path: 'Main', pouType: 'program', language: 'st' })
        expect(result.variable).toEqual({ display: 'table', description: '', classFilter: 'All', selectedRow: '' })
      }
    })

    it('creates a textual editor for IL function', () => {
      const result = createEditorObjectForPou('IlFunc', 'function', 'il')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('il')
        expect(result.meta.pouType).toBe('function')
      }
    })

    it('creates a textual editor for python function-block', () => {
      const result = createEditorObjectForPou('PyFB', 'function-block', 'python')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('python')
        expect(result.meta.pouType).toBe('function-block')
      }
    })

    it('creates a textual editor for cpp program', () => {
      const result = createEditorObjectForPou('CppProg', 'program', 'cpp')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('cpp')
      }
    })

    it('creates a graphical LD editor with openedRungs', () => {
      const result = createEditorObjectForPou('LdProg', 'program', 'ld')
      expect(result.type).toBe('plc-graphical')
      if (result.type === 'plc-graphical') {
        expect(result.meta).toEqual({ name: 'LdProg', path: 'LdProg', pouType: 'program', language: 'ld' })
        expect(result.graphical).toEqual({ language: 'ld', openedRungs: [] })
        expect(result.variable).toEqual({ display: 'table', description: '', classFilter: 'All', selectedRow: '' })
      }
    })

    it('creates a graphical FBD editor with hovering and zoom flags', () => {
      const result = createEditorObjectForPou('FbdProg', 'function-block', 'fbd')
      expect(result.type).toBe('plc-graphical')
      if (result.type === 'plc-graphical') {
        expect(result.meta.language).toBe('fbd')
        expect(result.graphical).toEqual({
          language: 'fbd',
          hoveringElement: { elementId: null, hovering: false },
          canEditorZoom: true,
          canEditorPan: true,
        })
      }
    })

    it('creates a graphical SFC editor', () => {
      const result = createEditorObjectForPou('SfcProg', 'program', 'sfc')
      expect(result.type).toBe('plc-graphical')
      if (result.type === 'plc-graphical') {
        expect(result.meta.language).toBe('sfc')
        expect(result.graphical).toEqual({ language: 'sfc' })
      }
    })

    it('normalizes language to lowercase', () => {
      const result = createEditorObjectForPou('Prog', 'program', 'ST')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('st')
      }
    })

    it('uses the name as the path', () => {
      const result = createEditorObjectForPou('MyPou', 'function', 'st')
      if (result.type === 'plc-textual') {
        expect(result.meta.path).toBe('MyPou')
      }
    })
  })

  // -------------------------------------------------------------------------
  // createEditorObjectForDatatype
  // -------------------------------------------------------------------------
  describe('createEditorObjectForDatatype', () => {
    it('creates a datatype editor for array', () => {
      const result = createEditorObjectForDatatype('IntArray', 'array')
      expect(result).toEqual({
        type: 'plc-datatype',
        meta: { name: 'IntArray', derivation: 'array' },
        structure: { description: '', selectedRow: '' },
      })
    })

    it('creates a datatype editor for structure', () => {
      const result = createEditorObjectForDatatype('Point', 'structure')
      expect(result.type).toBe('plc-datatype')
      if (result.type === 'plc-datatype') {
        expect(result.meta.derivation).toBe('structure')
      }
    })

    it('creates a datatype editor for enumerated', () => {
      const result = createEditorObjectForDatatype('Colors', 'enumerated')
      expect(result.type).toBe('plc-datatype')
      if (result.type === 'plc-datatype') {
        expect(result.meta.derivation).toBe('enumerated')
      }
    })
  })

  // -------------------------------------------------------------------------
  // createEditorObjectForServer
  // -------------------------------------------------------------------------
  describe('createEditorObjectForServer', () => {
    it('creates a server editor for modbus-tcp', () => {
      const result = createEditorObjectForServer('ModbusServer', 'modbus-tcp')
      expect(result).toEqual({
        type: 'plc-server',
        meta: { name: 'ModbusServer', protocol: 'modbus-tcp' },
      })
    })

    it('creates a server editor for s7comm', () => {
      const result = createEditorObjectForServer('S7Server', 's7comm')
      expect(result.type).toBe('plc-server')
      if (result.type === 'plc-server') {
        expect(result.meta.protocol).toBe('s7comm')
      }
    })

    it('creates a server editor for opcua', () => {
      const result = createEditorObjectForServer('OpcServer', 'opcua')
      expect(result.type).toBe('plc-server')
      if (result.type === 'plc-server') {
        expect(result.meta.protocol).toBe('opcua')
      }
    })

    it('creates a server editor for ethernet-ip', () => {
      const result = createEditorObjectForServer('EipServer', 'ethernet-ip')
      expect(result.type).toBe('plc-server')
      if (result.type === 'plc-server') {
        expect(result.meta.protocol).toBe('ethernet-ip')
      }
    })
  })

  // -------------------------------------------------------------------------
  // createEditorObjectForRemoteDevice
  // -------------------------------------------------------------------------
  describe('createEditorObjectForRemoteDevice', () => {
    it('creates a remote device editor for modbus-tcp', () => {
      const result = createEditorObjectForRemoteDevice('Device1', 'modbus-tcp')
      expect(result).toEqual({
        type: 'plc-remote-device',
        meta: { name: 'Device1', protocol: 'modbus-tcp' },
      })
    })

    it('creates a remote device editor for ethernet-ip', () => {
      const result = createEditorObjectForRemoteDevice('EipDevice', 'ethernet-ip')
      expect(result.type).toBe('plc-remote-device')
      if (result.type === 'plc-remote-device') {
        expect(result.meta.protocol).toBe('ethernet-ip')
      }
    })

    it('creates a remote device editor for ethercat', () => {
      const result = createEditorObjectForRemoteDevice('EcatDevice', 'ethercat')
      expect(result.type).toBe('plc-remote-device')
      if (result.type === 'plc-remote-device') {
        expect(result.meta.protocol).toBe('ethercat')
      }
    })

    it('creates a remote device editor for profinet', () => {
      const result = createEditorObjectForRemoteDevice('PnDevice', 'profinet')
      expect(result.type).toBe('plc-remote-device')
      if (result.type === 'plc-remote-device') {
        expect(result.meta.protocol).toBe('profinet')
      }
    })
  })

  // -------------------------------------------------------------------------
  // createTabObject
  // -------------------------------------------------------------------------
  describe('createTabObject', () => {
    it('creates a tab object for a program', () => {
      const result = createTabObject('Main', 'program', 'st')
      expect(result).toEqual({ type: 'program', name: 'Main', language: 'st' })
    })

    it('creates a tab object for a function', () => {
      const result = createTabObject('Add', 'function', 'il')
      expect(result).toEqual({ type: 'function', name: 'Add', language: 'il' })
    })

    it('creates a tab object for a function-block', () => {
      const result = createTabObject('Counter', 'function-block', 'ld')
      expect(result).toEqual({ type: 'function-block', name: 'Counter', language: 'ld' })
    })
  })
})
