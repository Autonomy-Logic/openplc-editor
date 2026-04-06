import { createStore } from 'zustand/vanilla'

import { createEditorSlice } from '../slices/editor/slice'
import type { EditorModel, EditorSlice } from '../slices/editor/types'

const makeStore = () => createStore<EditorSlice>()(createEditorSlice)

function makeTextual(name: string): EditorModel {
  return {
    type: 'plc-textual',
    meta: { name, path: `/pous/${name}`, language: 'st', pouType: 'program' },
    variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
  }
}

function makeGraphical(name: string, language: 'ld' | 'sfc' | 'fbd' = 'ld'): EditorModel {
  const base = {
    type: 'plc-graphical' as const,
    meta: { name, path: `/pous/${name}`, language, pouType: 'program' as const },
    variable: { display: 'table' as const, description: '', classFilter: 'All' as const, selectedRow: '-1' },
  }
  if (language === 'ld') return { ...base, graphical: { language: 'ld', openedRungs: [] } }
  if (language === 'fbd')
    return {
      ...base,
      graphical: {
        language: 'fbd',
        hoveringElement: { elementId: null, hovering: false },
        canEditorZoom: true,
        canEditorPan: true,
      },
    }
  return { ...base, graphical: { language: 'sfc' } }
}

function makeResource(name = 'Resource'): EditorModel {
  return {
    type: 'plc-resource',
    meta: { name, path: '/config/resource' },
    variable: { display: 'table', description: '', selectedRow: '-1' },
    task: { display: 'table', selectedRow: '-1' },
    instance: { display: 'table', selectedRow: '-1' },
  }
}

function makeDatatype(name: string): EditorModel {
  return {
    type: 'plc-datatype',
    meta: { name, derivation: 'structure' },
    structure: { selectedRow: '-1', description: '' },
  }
}

describe('editor slice', () => {
  let store: ReturnType<typeof makeStore>
  beforeEach(() => {
    store = makeStore()
  })

  it('has correct initial state', () => {
    const s = store.getState()
    expect(s.editors).toEqual([])
    expect(s.editor).toEqual({ type: 'available', meta: { name: 'available' } })
    expect(s.isMonacoFocused).toBe(false)
  })

  it('addModel: adds new, skips duplicate', () => {
    const { editorActions: a } = store.getState()
    const e = makeTextual('Main')
    a.addModel(e)
    expect(store.getState().editors).toHaveLength(1)
    a.addModel(e)
    expect(store.getState().editors).toHaveLength(1)
  })

  it('removeModel: filters by name', () => {
    const { editorActions: a } = store.getState()
    a.addModel(makeTextual('A'))
    a.addModel(makeTextual('B'))
    a.removeModel('A')
    expect(store.getState().editors.map((e) => e.meta.name)).toEqual(['B'])
  })

  describe('updateModelVariables', () => {
    it('resource: table ↔ code cycle', () => {
      const { editorActions: a } = store.getState()
      const res = makeResource()
      a.addModel(res)
      a.setEditor(res)

      // table with values (prev is table → ternary left sides)
      a.updateModelVariables({ display: 'table', selectedRow: 3, description: 'desc' })
      // table without values → prev table selected (ternary left + ?? right sides)
      a.updateModelVariables({ display: 'table' })
      // code with value (prev table → existingCode=undefined)
      a.updateModelVariables({ display: 'code', code: 'VAR x: INT; END_VAR' })
      // code without value (prev code → existingCode defined, preserves)
      a.updateModelVariables({ display: 'code' })
      expect((store.getState().editor as any).variable.code).toBe('VAR x: INT; END_VAR')
      // table from code (prev code → ternary right sides for defaults)
      a.updateModelVariables({ display: 'table' })
      expect((store.getState().editor as any).variable.selectedRow).toBe('-1')
    })

    it('textual: table ↔ code cycle', () => {
      const { editorActions: a } = store.getState()
      const txt = makeTextual('Main')
      a.addModel(txt)
      a.setEditor(txt)

      a.updateModelVariables({ display: 'table', selectedRow: 2, classFilter: 'Input', description: 'd' })
      a.updateModelVariables({ display: 'table' })
      a.updateModelVariables({ display: 'code', code: 'c' })
      a.updateModelVariables({ display: 'code' })
      expect((store.getState().editor as any).variable.code).toBe('c')
      a.updateModelVariables({ display: 'table' })
      expect((store.getState().editor as any).variable.classFilter).toBe('All')
    })

    it('graphical enters the || plc-graphical branch', () => {
      const { editorActions: a } = store.getState()
      const g = makeGraphical('G', 'ld')
      a.addModel(g)
      a.setEditor(g)
      a.updateModelVariables({ display: 'table', selectedRow: 1 })
      expect((store.getState().editor as any).variable.selectedRow).toBe('1')
    })

    it('no-op for non-matching editor type', () => {
      store.getState().editorActions.updateModelVariables({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('available')
    })
  })

  describe('updateModelVariablesForName', () => {
    it('updates active editor when name matches', () => {
      const { editorActions: a } = store.getState()
      const res = makeResource('Res')
      a.addModel(res)
      a.setEditor(res)
      a.updateModelVariablesForName('Res', { display: 'table', selectedRow: 1, description: 'u' })
      expect((store.getState().editor as any).variable.description).toBe('u')
    })

    it('resource in array: table ↔ code cycle', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeResource('Res'))
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))

      a.updateModelVariablesForName('Res', { display: 'table', selectedRow: 7, description: 'd' })
      a.updateModelVariablesForName('Res', { display: 'table' })
      a.updateModelVariablesForName('Res', { display: 'code', code: 'c' })
      a.updateModelVariablesForName('Res', { display: 'code' })
      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      expect((target as any).variable.code).toBe('c')
      a.updateModelVariablesForName('Res', { display: 'table' })
      expect((store.getState().editors.find((e) => e.meta.name === 'Res') as any).variable.selectedRow).toBe('-1')
    })

    it('textual in array: table ↔ code cycle', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('P1'))
      a.addModel(makeTextual('P2'))
      a.setEditor(makeTextual('P1'))

      a.updateModelVariablesForName('P2', { display: 'table', selectedRow: 3, classFilter: 'Local', description: 'd' })
      a.updateModelVariablesForName('P2', { display: 'table' })
      a.updateModelVariablesForName('P2', { display: 'code', code: 'c' })
      a.updateModelVariablesForName('P2', { display: 'code' })
      a.updateModelVariablesForName('P2', { display: 'table' })
      expect((store.getState().editors.find((e) => e.meta.name === 'P2') as any).variable.classFilter).toBe('All')
    })

    it('graphical in array enters || plc-graphical branch', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeGraphical('G', 'ld'))
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateModelVariablesForName('G', { display: 'table', selectedRow: 1 })
      expect((store.getState().editors.find((e) => e.meta.name === 'G') as any).variable.selectedRow).toBe('1')
    })

    it('no-op when name not found', () => {
      store.getState().editorActions.updateModelVariablesForName('X', { display: 'table' })
      expect(store.getState().editors).toHaveLength(0)
    })

    it('skips non-resource/textual/graphical types', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeDatatype('DT'))
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateModelVariablesForName('DT', { display: 'table', selectedRow: 1 })
      expect((store.getState().editors.find((e) => e.meta.name === 'DT') as any).structure.selectedRow).toBe('-1')
    })
  })

  describe('updateModelTasks', () => {
    it('table with selectedRow, default selectedRow, and code', () => {
      const { editorActions: a } = store.getState()
      const res = makeResource()
      a.addModel(res)
      a.setEditor(res)

      a.updateModelTasks({ display: 'table', selectedRow: 2 })
      expect((store.getState().editor as any).task).toEqual({ display: 'table', selectedRow: '2' })
      a.updateModelTasks({ display: 'table' })
      expect((store.getState().editor as any).task).toEqual({ display: 'table', selectedRow: '-1' })
      a.updateModelTasks({ display: 'code' })
      expect((store.getState().editor as any).task).toEqual({ display: 'code' })
    })

    it('no-op for non-resource', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateModelTasks({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  describe('updateModelInstances', () => {
    it('table with selectedRow, default selectedRow, and code', () => {
      const { editorActions: a } = store.getState()
      const res = makeResource()
      a.addModel(res)
      a.setEditor(res)

      a.updateModelInstances({ display: 'table', selectedRow: 4 })
      expect((store.getState().editor as any).instance).toEqual({ display: 'table', selectedRow: '4' })
      a.updateModelInstances({ display: 'table' })
      expect((store.getState().editor as any).instance).toEqual({ display: 'table', selectedRow: '-1' })
      a.updateModelInstances({ display: 'code' })
      expect((store.getState().editor as any).instance).toEqual({ display: 'code' })
    })

    it('no-op for non-resource', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateModelInstances({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  describe('updateModelStructure', () => {
    it('updates selectedRow and description, preserves when falsy', () => {
      const { editorActions: a } = store.getState()
      const dt = makeDatatype('S')
      a.addModel(dt)
      a.setEditor(dt)

      a.updateModelStructure({ selectedRow: 3, description: 'desc' })
      expect((store.getState().editor as any).structure).toEqual({ selectedRow: '3', description: 'desc' })
      // undefined selectedRow → keeps; empty description → keeps (falsy)
      a.updateModelStructure({ description: '' })
      expect((store.getState().editor as any).structure).toEqual({ selectedRow: '3', description: 'desc' })
    })

    it('no-op for non-datatype', () => {
      store.getState().editorActions.updateModelStructure({ selectedRow: 1, description: 'x' })
      expect(store.getState().editor.type).toBe('available')
    })
  })

  describe('updateModelLadder', () => {
    it('adds new rung, updates existing, preserves others', () => {
      const { editorActions: a } = store.getState()
      const ld = makeGraphical('L', 'ld')
      a.addModel(ld)
      a.setEditor(ld)

      a.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      a.updateModelLadder({ openRung: { rungId: 'r2', open: true } })
      a.updateModelLadder({ openRung: { rungId: 'r1', open: false } })
      expect((store.getState().editor as any).graphical.openedRungs).toEqual([
        { rungId: 'r1', open: false },
        { rungId: 'r2', open: true },
      ])
    })

    it('no-op when openRung undefined', () => {
      const { editorActions: a } = store.getState()
      const ld = makeGraphical('L', 'ld')
      a.addModel(ld)
      a.setEditor(ld)
      a.updateModelLadder({})
      expect((store.getState().editor as any).graphical.openedRungs).toEqual([])
    })

    it('no-op for non-ld and non-graphical', () => {
      const { editorActions: a } = store.getState()
      const fbd = makeGraphical('F', 'fbd')
      a.addModel(fbd)
      a.setEditor(fbd)
      a.updateModelLadder({ openRung: { rungId: 'r1', open: true } })

      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  describe('getIsRungOpen', () => {
    it('returns rung state or true by default', () => {
      const { editorActions: a } = store.getState()
      // non-graphical → true
      expect(a.getIsRungOpen({ rungId: 'r1' })).toBe(true)

      const ld = makeGraphical('L', 'ld')
      a.addModel(ld)
      a.setEditor(ld)
      // ld, rung not found → true
      expect(a.getIsRungOpen({ rungId: 'r1' })).toBe(true)
      // ld, rung found
      a.updateModelLadder({ openRung: { rungId: 'r1', open: false } })
      expect(a.getIsRungOpen({ rungId: 'r1' })).toBe(false)

      // fbd → true
      const fbd = makeGraphical('F', 'fbd')
      a.addModel(fbd)
      a.setEditor(fbd)
      expect(a.getIsRungOpen({ rungId: 'r1' })).toBe(true)
    })
  })

  describe('updateModelFBD', () => {
    it('updates hovering, zoom, and pan', () => {
      const { editorActions: a } = store.getState()
      const fbd = makeGraphical('F', 'fbd')
      a.addModel(fbd)
      a.setEditor(fbd)

      a.updateModelFBD({
        hoveringElement: { elementId: 'e1', hovering: true },
        canEditorZoom: false,
        canEditorPan: false,
      })
      const g = (store.getState().editor as any).graphical
      expect(g.hoveringElement).toEqual({ elementId: 'e1', hovering: true })
      expect(g.canEditorZoom).toBe(false)
      expect(g.canEditorPan).toBe(false)
    })

    it('skips hoveringElement, zoom, and pan when not provided', () => {
      const { editorActions: a } = store.getState()
      const fbd = makeGraphical('F', 'fbd')
      a.addModel(fbd)
      a.setEditor(fbd)
      a.updateModelFBD({})
      expect((store.getState().editor as any).graphical.hoveringElement).toEqual({ elementId: null, hovering: false })
      expect((store.getState().editor as any).graphical.canEditorZoom).toBe(true)
      expect((store.getState().editor as any).graphical.canEditorPan).toBe(true)
    })

    it('no-op for non-fbd and non-graphical', () => {
      const { editorActions: a } = store.getState()
      a.updateModelFBD({ canEditorZoom: false })
      expect(store.getState().editor.type).toBe('available')

      const ld = makeGraphical('L', 'ld')
      a.addModel(ld)
      a.setEditor(ld)
      a.updateModelFBD({ canEditorZoom: false })
    })
  })

  describe('updateEditorModel', () => {
    it('renames in array and current editor', () => {
      const { editorActions: a } = store.getState()
      const txt = makeTextual('Old')
      a.addModel(txt)
      a.setEditor(txt)
      a.updateEditorModel('Old', 'New')
      expect(store.getState().editors[0].meta.name).toBe('New')
      expect(store.getState().editor.meta.name).toBe('New')
    })

    it('no-op when same name or not found', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateEditorModel('M', 'M')
      a.updateEditorModel('X', 'Y')
      expect(store.getState().editors[0].meta.name).toBe('M')
    })
  })

  describe('updateEditorName', () => {
    it('renames in array and current editor', () => {
      const { editorActions: a } = store.getState()
      const txt = makeTextual('Old')
      a.addModel(txt)
      a.setEditor(txt)
      a.updateEditorName('Old', 'New')
      expect(store.getState().editors[0].meta.name).toBe('New')
      expect(store.getState().editor.meta.name).toBe('New')
    })

    it('renames only in array when current editor differs', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('A'))
      a.addModel(makeTextual('B'))
      a.setEditor(makeTextual('A'))
      a.updateEditorName('B', 'C')
      expect(store.getState().editor.meta.name).toBe('A')
      expect(store.getState().editors.find((e) => e.meta.name === 'C')).toBeDefined()
    })

    it('no-op when same name or not found', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.updateEditorName('M', 'M')
      a.updateEditorName('X', 'Y')
      expect(store.getState().editor.meta.name).toBe('M')
    })
  })

  describe('setEditor', () => {
    it('sets editor and swaps previous into array', () => {
      const { editorActions: a } = store.getState()
      const first = makeTextual('First')
      const second = makeTextual('Second')
      a.addModel(first)
      a.addModel(second)

      // from available → does not save available to array
      a.setEditor(first)
      expect(store.getState().editor.meta.name).toBe('First')
      expect(store.getState().editors).toHaveLength(2)

      // from non-available → saves old editor back
      a.setEditor(second)
      expect(store.getState().editor.meta.name).toBe('Second')
    })

    it('no-op when same editor name', () => {
      const { editorActions: a } = store.getState()
      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      expect(store.getState().editor.meta.name).toBe('M')
    })
  })

  it('clearEditor resets state', () => {
    const { editorActions: a } = store.getState()
    a.addModel(makeTextual('M'))
    a.setEditor(makeTextual('M'))
    a.clearEditor()
    expect(store.getState().editors).toEqual([])
    expect(store.getState().editor.type).toBe('available')
  })

  describe('saveEditorViewState', () => {
    it('saves cursor, scroll, fbd positions', () => {
      const { editorActions: a } = store.getState()
      const txt = makeTextual('M')
      a.addModel(txt)
      a.setEditor(txt)
      a.saveEditorViewState({
        prevEditorName: 'M',
        cursorPosition: { lineNumber: 10, column: 5, offset: 100 },
        scrollPosition: { top: 200, left: 0 },
        fbdPosition: { x: 50, y: 50, zoom: 1.5 },
      })
      expect(store.getState().editors.find((e) => e.meta.name === 'M')?.cursorPosition).toEqual({
        lineNumber: 10,
        column: 5,
        offset: 100,
      })
    })

    it('no-op for available editor or missing name', () => {
      const { editorActions: a } = store.getState()
      a.saveEditorViewState({ prevEditorName: 'X', cursorPosition: { lineNumber: 1, column: 1, offset: 0 } })
      expect(store.getState().editors).toEqual([])

      a.addModel(makeTextual('M'))
      a.setEditor(makeTextual('M'))
      a.saveEditorViewState({ prevEditorName: 'NotFound', cursorPosition: { lineNumber: 1, column: 1, offset: 0 } })
    })
  })

  describe('getEditorFromEditors', () => {
    it('returns current editor, array editor, or null', () => {
      const { editorActions: a } = store.getState()
      expect(a.getEditorFromEditors('X')).toBeNull()

      a.addModel(makeTextual('First'))
      a.addModel(makeTextual('Second'))
      a.setEditor(makeTextual('First'))

      expect(a.getEditorFromEditors('First')?.meta.name).toBe('First')
      expect(a.getEditorFromEditors('Second')?.meta.name).toBe('Second')
      expect(a.getEditorFromEditors('None')).toBeNull()
    })
  })

  it('setMonacoFocused toggles state', () => {
    const { editorActions: a } = store.getState()
    a.setMonacoFocused(true)
    expect(store.getState().isMonacoFocused).toBe(true)
    a.setMonacoFocused(false)
    expect(store.getState().isMonacoFocused).toBe(false)
  })
})
