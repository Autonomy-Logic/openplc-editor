import type { TabsProps } from '../slices/tabs/types'
import {
  CreateDeviceEditor,
  CreateDiffViewerEditor,
  CreateEditorModelObject,
  CreateEditorObjectFromTab,
  CreatePLCGraphicalObject,
  CreatePLCTextualObject,
  CreateRemoteDeviceEditor,
  CreateResourceEditor,
  CreateServerEditor,
} from '../slices/tabs/utils'

describe('tabs/utils', () => {
  // -------------------------------------------------------------------------
  // CreatePLCTextualObject
  // -------------------------------------------------------------------------
  describe('CreatePLCTextualObject', () => {
    it('creates a plc-textual editor for ST program', () => {
      const result = CreatePLCTextualObject('Main', 'st', 'program')
      expect(result).toEqual({
        type: 'plc-textual',
        meta: { name: 'Main', language: 'st', path: '/data/pous/program/st/Main', pouType: 'program' },
        variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
      })
    })

    it('creates a plc-textual editor for IL function', () => {
      const result = CreatePLCTextualObject('Func1', 'il', 'function')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('il')
        expect(result.meta.path).toBe('/data/pous/function/il/Func1')
      }
    })

    it('creates a plc-textual editor for python function-block', () => {
      const result = CreatePLCTextualObject('FB1', 'python', 'function-block')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('python')
        expect(result.meta.pouType).toBe('function-block')
      }
    })

    it('creates a plc-textual editor for cpp', () => {
      const result = CreatePLCTextualObject('CppProg', 'cpp', 'program')
      expect(result.type).toBe('plc-textual')
      if (result.type === 'plc-textual') {
        expect(result.meta.language).toBe('cpp')
      }
    })
  })

  // -------------------------------------------------------------------------
  // CreatePLCGraphicalObject
  // -------------------------------------------------------------------------
  describe('CreatePLCGraphicalObject', () => {
    it('creates LD graphical editor with openedRungs', () => {
      const result = CreatePLCGraphicalObject('LdProg', 'ld', 'program')
      expect(result.type).toBe('plc-graphical')
      if (result.type === 'plc-graphical') {
        expect(result.graphical).toEqual({ language: 'ld', openedRungs: [] })
        expect(result.meta.path).toBe('/data/pous/program/ld/LdProg')
      }
    })

    it('creates FBD graphical editor with hover/zoom/pan', () => {
      const result = CreatePLCGraphicalObject('FbdProg', 'fbd', 'function')
      if (result.type === 'plc-graphical') {
        expect(result.graphical).toEqual({
          language: 'fbd',
          hoveringElement: { elementId: null, hovering: false },
          canEditorZoom: true,
          canEditorPan: true,
        })
      }
    })

    it('creates SFC graphical editor', () => {
      const result = CreatePLCGraphicalObject('SfcProg', 'sfc', 'function-block')
      if (result.type === 'plc-graphical') {
        expect(result.graphical).toEqual({ language: 'sfc' })
      }
    })
  })

  // -------------------------------------------------------------------------
  // CreateEditorModelObject
  // -------------------------------------------------------------------------
  describe('CreateEditorModelObject', () => {
    it('creates a datatype editor when derivation is provided', () => {
      const result = CreateEditorModelObject('MyEnum', null, null, 'enumerated')
      expect(result.type).toBe('plc-datatype')
      if (result.type === 'plc-datatype') {
        expect(result.meta.derivation).toBe('enumerated')
        expect(result.structure).toEqual({ selectedRow: '-1', description: '' })
      }
    })

    it('creates a graphical editor for ld language', () => {
      const result = CreateEditorModelObject('LdProg', 'ld', 'program')
      expect(result.type).toBe('plc-graphical')
    })

    it('creates a graphical editor for sfc language', () => {
      const result = CreateEditorModelObject('SfcProg', 'sfc', 'function')
      expect(result.type).toBe('plc-graphical')
    })

    it('creates a graphical editor for fbd language', () => {
      const result = CreateEditorModelObject('FbdProg', 'fbd', 'function-block')
      expect(result.type).toBe('plc-graphical')
    })

    it('creates a textual editor for st language', () => {
      const result = CreateEditorModelObject('StProg', 'st', 'program')
      expect(result.type).toBe('plc-textual')
    })

    it('creates a textual editor for il language', () => {
      const result = CreateEditorModelObject('IlProg', 'il', 'function')
      expect(result.type).toBe('plc-textual')
    })

    it('throws when language and pouType are null without derivation', () => {
      expect(() => CreateEditorModelObject('NoLang', null, null)).toThrow('Language and pouType must be defined')
    })

    it('throws when language is null without derivation', () => {
      expect(() => CreateEditorModelObject('NoLang', null, 'program')).toThrow('Language and pouType must be defined')
    })

    it('throws when pouType is null without derivation', () => {
      expect(() => CreateEditorModelObject('NoType', 'st', null)).toThrow('Language and pouType must be defined')
    })
  })

  // -------------------------------------------------------------------------
  // CreateResourceEditor
  // -------------------------------------------------------------------------
  describe('CreateResourceEditor', () => {
    it('creates a resource editor with default name', () => {
      const result = CreateResourceEditor()
      expect(result).toEqual({
        type: 'plc-resource',
        meta: { name: 'Resource', path: '/data/configuration/resource' },
        variable: { display: 'table', description: '', selectedRow: '-1' },
        task: { display: 'table', selectedRow: '-1' },
        instance: { display: 'table', selectedRow: '-1' },
      })
    })

    it('creates a resource editor with custom name', () => {
      const result = CreateResourceEditor('CustomRes')
      expect(result.type).toBe('plc-resource')
      if (result.type === 'plc-resource') {
        expect(result.meta.name).toBe('CustomRes')
      }
    })
  })

  // -------------------------------------------------------------------------
  // CreateDeviceEditor
  // -------------------------------------------------------------------------
  describe('CreateDeviceEditor', () => {
    it('creates a device editor for configuration', () => {
      const result = CreateDeviceEditor('Dev', 'configuration')
      expect(result).toEqual({
        type: 'plc-device',
        meta: { name: 'Dev', derivation: 'configuration' },
      })
    })

    it('creates a device editor for pin-mapping', () => {
      const result = CreateDeviceEditor('Dev', 'pin-mapping')
      if (result.type === 'plc-device') {
        expect(result.meta.derivation).toBe('pin-mapping')
      }
    })

    it('creates a device editor for orchestrators', () => {
      const result = CreateDeviceEditor('Dev', 'orchestrators')
      if (result.type === 'plc-device') {
        expect(result.meta.derivation).toBe('orchestrators')
      }
    })

    it('uses default name when not provided', () => {
      const result = CreateDeviceEditor(undefined, 'configuration')
      if (result.type === 'plc-device') {
        expect(result.meta.name).toBe('device')
      }
    })

    it('throws when derivation is falsy', () => {
      // Force a falsy derivation at runtime to cover the throw branch
      expect(() => CreateDeviceEditor('Dev', '' as 'configuration')).toThrow('Invalid derivation value')
    })
  })

  // -------------------------------------------------------------------------
  // CreateRemoteDeviceEditor
  // -------------------------------------------------------------------------
  describe('CreateRemoteDeviceEditor', () => {
    it('creates a remote device editor', () => {
      const result = CreateRemoteDeviceEditor('RemDev', 'modbus-tcp')
      expect(result).toEqual({
        type: 'plc-remote-device',
        meta: { name: 'RemDev', protocol: 'modbus-tcp' },
      })
    })
  })

  // -------------------------------------------------------------------------
  // CreateServerEditor
  // -------------------------------------------------------------------------
  describe('CreateServerEditor', () => {
    it('creates a server editor', () => {
      const result = CreateServerEditor('Srv', 'opcua')
      expect(result).toEqual({
        type: 'plc-server',
        meta: { name: 'Srv', protocol: 'opcua' },
      })
    })
  })

  // -------------------------------------------------------------------------
  // CreateDiffViewerEditor
  // -------------------------------------------------------------------------
  describe('CreateDiffViewerEditor', () => {
    it('creates a diff-viewer editor carrying name + filePath', () => {
      const result = CreateDiffViewerEditor('Diff: pous/programs/Main.st', 'pous/programs/Main.st')
      expect(result).toEqual({
        type: 'diff-viewer',
        meta: { name: 'Diff: pous/programs/Main.st', filePath: 'pous/programs/Main.st' },
      })
    })
  })

  // -------------------------------------------------------------------------
  // CreateEditorObjectFromTab
  // -------------------------------------------------------------------------
  describe('CreateEditorObjectFromTab', () => {
    it('creates editor from program tab', () => {
      const tab: TabsProps = { name: 'Prog', elementType: { type: 'program', language: 'st' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-textual')
      expect(result.meta.name).toBe('Prog')
    })

    it('creates editor from function tab', () => {
      const tab: TabsProps = { name: 'Func', elementType: { type: 'function', language: 'il' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-textual')
    })

    it('creates editor from function-block tab', () => {
      const tab: TabsProps = { name: 'FB', elementType: { type: 'function-block', language: 'ld' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-graphical')
    })

    it('creates editor from data-type tab', () => {
      const tab: TabsProps = { name: 'DT', elementType: { type: 'data-type', derivation: 'structure' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-datatype')
    })

    it('creates editor from resource tab', () => {
      const tab: TabsProps = { name: 'Res', elementType: { type: 'resource' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-resource')
    })

    it('creates editor from device tab', () => {
      const tab: TabsProps = { name: 'Dev', elementType: { type: 'device', derivation: 'pin-mapping' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-device')
    })

    it('creates editor from remote-device tab', () => {
      const tab: TabsProps = { name: 'RD', elementType: { type: 'remote-device', protocol: 'ethercat' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-remote-device')
    })

    it('creates editor from server tab', () => {
      const tab: TabsProps = { name: 'Srv', elementType: { type: 'server', protocol: 's7comm' } }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('plc-server')
    })

    it('creates editor from diff-viewer tab', () => {
      const tab: TabsProps = {
        name: 'Diff: devices/configuration.json',
        elementType: { type: 'diff-viewer', filePath: 'devices/configuration.json' },
      }
      const result = CreateEditorObjectFromTab(tab)
      expect(result.type).toBe('diff-viewer')
      if (result.type === 'diff-viewer') {
        expect(result.meta.filePath).toBe('devices/configuration.json')
        expect(result.meta.name).toBe('Diff: devices/configuration.json')
      }
    })
  })
})
