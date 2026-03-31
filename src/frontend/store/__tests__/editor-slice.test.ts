import { createStore } from 'zustand/vanilla'

import { createEditorSlice } from '../slices/editor/slice'
import type { EditorModel, EditorSlice } from '../slices/editor/types'

function makeStore() {
  return createStore<EditorSlice>()(createEditorSlice)
}

// Helpers to create editor models
function makeTextualEditor(
  name: string,
  overrides?: Partial<{ language: 'il' | 'st' | 'python' | 'cpp'; pouType: 'program' | 'function' | 'function-block' }>,
): EditorModel {
  return {
    type: 'plc-textual',
    meta: {
      name,
      path: `/data/pous/program/st/${name}`,
      language: overrides?.language ?? 'st',
      pouType: overrides?.pouType ?? 'program',
    },
    variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '-1' },
  }
}

function makeGraphicalEditor(name: string, language: 'ld' | 'sfc' | 'fbd' = 'ld'): EditorModel {
  const base = {
    type: 'plc-graphical' as const,
    meta: {
      name,
      path: `/data/pous/program/${language}/${name}`,
      language,
      pouType: 'program' as const,
    },
    variable: { display: 'table' as const, description: '', classFilter: 'All' as const, selectedRow: '-1' },
  }
  if (language === 'ld') {
    return { ...base, graphical: { language: 'ld', openedRungs: [] } }
  }
  if (language === 'fbd') {
    return {
      ...base,
      graphical: {
        language: 'fbd',
        hoveringElement: { elementId: null, hovering: false },
        canEditorZoom: true,
        canEditorPan: true,
      },
    }
  }
  return { ...base, graphical: { language: 'sfc' } }
}

function makeResourceEditor(name = 'Resource'): EditorModel {
  return {
    type: 'plc-resource',
    meta: { name, path: '/data/configuration/resource' },
    variable: { display: 'table', description: '', selectedRow: '-1' },
    task: { display: 'table', selectedRow: '-1' },
    instance: { display: 'table', selectedRow: '-1' },
  }
}

function makeDatatypeEditor(name: string): EditorModel {
  return {
    type: 'plc-datatype',
    meta: { name, derivation: 'structure' },
    structure: { selectedRow: '-1', description: '' },
  }
}

describe('createEditorSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = store.getState()
    expect(state.editors).toEqual([])
    expect(state.editor).toEqual({ type: 'available', meta: { name: 'available' } })
    expect(state.isMonacoFocused).toBe(false)
  })

  // -------------------------------------------------------------------------
  // addModel
  // -------------------------------------------------------------------------
  it('addModel adds a new editor to editors array', () => {
    const editor = makeTextualEditor('Main')
    store.getState().editorActions.addModel(editor)
    expect(store.getState().editors).toHaveLength(1)
    expect(store.getState().editors[0].meta.name).toBe('Main')
  })

  it('addModel does not add duplicate', () => {
    const editor = makeTextualEditor('Main')
    store.getState().editorActions.addModel(editor)
    store.getState().editorActions.addModel(editor)
    expect(store.getState().editors).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // removeModel
  // -------------------------------------------------------------------------
  it('removeModel removes an editor by name', () => {
    store.getState().editorActions.addModel(makeTextualEditor('Main'))
    store.getState().editorActions.addModel(makeTextualEditor('Helper'))
    store.getState().editorActions.removeModel('Main')
    expect(store.getState().editors).toHaveLength(1)
    expect(store.getState().editors[0].meta.name).toBe('Helper')
  })

  // -------------------------------------------------------------------------
  // updateModelVariables
  // -------------------------------------------------------------------------
  describe('updateModelVariables', () => {
    it('updates table variables for plc-resource editor', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariables({
        display: 'table',
        selectedRow: 3,
        description: 'desc',
      })

      const editor = store.getState().editor
      expect(editor.type).toBe('plc-resource')
      if (editor.type === 'plc-resource') {
        expect(editor.variable).toEqual({ display: 'table', selectedRow: '3', description: 'desc' })
      }
    })

    it('updates code variables for plc-resource editor', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariables({
        display: 'code',
        code: 'VAR x: INT; END_VAR',
      })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.variable).toEqual({ display: 'code', code: 'VAR x: INT; END_VAR' })
      }
    })

    it('preserves existing code when switching to code display without new code (plc-resource)', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'existing code' })
      store.getState().editorActions.updateModelVariables({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.variable).toEqual({ display: 'code', code: 'existing code' })
      }
    })

    it('sets code to undefined when switching from table to code without code value (plc-resource)', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariables({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.variable).toEqual({ display: 'code', code: undefined })
      }
    })

    it('uses default selectedRow and description for plc-resource table when not provided', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariables({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.variable).toEqual({ display: 'table', selectedRow: '-1', description: '' })
      }
    })

    it('updates table variables for plc-textual editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariables({
        display: 'table',
        selectedRow: 2,
        classFilter: 'Input',
        description: 'my desc',
      })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual') {
        expect(editor.variable).toEqual({
          display: 'table',
          selectedRow: '2',
          classFilter: 'Input',
          description: 'my desc',
        })
      }
    })

    it('updates code variables for plc-textual editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'my code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual') {
        expect(editor.variable).toEqual({ display: 'code', code: 'my code' })
      }
    })

    it('preserves existing code for plc-textual when no code provided', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'saved code' })
      store.getState().editorActions.updateModelVariables({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual') {
        expect(editor.variable).toEqual({ display: 'code', code: 'saved code' })
      }
    })

    it('sets code to undefined when no existing code on plc-textual', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariables({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual') {
        expect(editor.variable).toEqual({ display: 'code', code: undefined })
      }
    })

    it('uses defaults for table when selectedRow/classFilter/description not provided (plc-textual)', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariables({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual') {
        expect(editor.variable).toEqual({
          display: 'table',
          selectedRow: '-1',
          classFilter: 'All',
          description: '',
        })
      }
    })

    it('updates table variables for plc-graphical editor', () => {
      const graphical = makeGraphicalEditor('Main', 'ld')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.setEditor(graphical)

      store.getState().editorActions.updateModelVariables({
        display: 'table',
        selectedRow: 5,
        classFilter: 'Output',
        description: 'graphical desc',
      })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical') {
        expect(editor.variable).toEqual({
          display: 'table',
          selectedRow: '5',
          classFilter: 'Output',
          description: 'graphical desc',
        })
      }
    })

    it('does nothing for available editor type', () => {
      store.getState().editorActions.updateModelVariables({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('available')
    })

    it('switches plc-resource from code to table, using defaults for prev code display', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      // First switch to code display
      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'some code' })
      // Now switch back to table -- prevSelectedRow/prevDescription come from else branches
      store.getState().editorActions.updateModelVariables({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource' && editor.variable.display === 'table') {
        expect(editor.variable.selectedRow).toBe('-1')
        expect(editor.variable.description).toBe('')
      }
    })

    it('switches plc-textual from code to table, using defaults for prev code display', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      // First switch to code display
      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'some code' })
      // Now switch back to table
      store.getState().editorActions.updateModelVariables({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-textual' && editor.variable.display === 'table') {
        expect(editor.variable.selectedRow).toBe('-1')
        expect(editor.variable.classFilter).toBe('All')
        expect(editor.variable.description).toBe('')
      }
    })

    it('switches plc-graphical from code to table, using defaults for prev code display', () => {
      const graphical = makeGraphicalEditor('Main', 'ld')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.setEditor(graphical)

      store.getState().editorActions.updateModelVariables({ display: 'code', code: 'some code' })
      store.getState().editorActions.updateModelVariables({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.variable.display === 'table') {
        expect(editor.variable.selectedRow).toBe('-1')
        expect(editor.variable.classFilter).toBe('All')
        expect(editor.variable.description).toBe('')
      }
    })
  })

  // -------------------------------------------------------------------------
  // updateModelVariablesForName
  // -------------------------------------------------------------------------
  describe('updateModelVariablesForName', () => {
    it('updates the active editor when name matches', () => {
      const resource = makeResourceEditor('Res')
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelVariablesForName('Res', {
        display: 'table',
        selectedRow: 1,
        description: 'updated',
      })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.variable.display).toBe('table')
        if (editor.variable.display === 'table') {
          expect(editor.variable.description).toBe('updated')
        }
      }
    })

    it('updates an editor in the editors array when name does not match current editor', () => {
      const res = makeResourceEditor('Res')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(res)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Res', {
        display: 'table',
        selectedRow: 7,
        description: 'indirect',
      })

      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      expect(target).toBeDefined()
      if (target?.type === 'plc-resource' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('7')
      }
    })

    it('does nothing when name not found', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('NonExistent', { display: 'table', selectedRow: 1 })
      expect(store.getState().editors).toHaveLength(1)
    })

    it('updates code for plc-resource target in editors array', () => {
      const res = makeResourceEditor('Res')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(res)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'code', code: 'new code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      if (target?.type === 'plc-resource') {
        expect(target.variable).toEqual({ display: 'code', code: 'new code' })
      }
    })

    it('preserves existing code for plc-resource when no code provided', () => {
      const res = makeResourceEditor('Res')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(res)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'code', code: 'saved' })
      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      if (target?.type === 'plc-resource') {
        expect(target.variable).toEqual({ display: 'code', code: 'saved' })
      }
    })

    it('uses defaults for plc-resource table when not provided', () => {
      const res = makeResourceEditor('Res')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(res)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'table' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      if (target?.type === 'plc-resource' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('-1')
        expect(target.variable.description).toBe('')
      }
    })

    it('updates plc-textual target with table data', () => {
      const textual1 = makeTextualEditor('Prog1')
      const textual2 = makeTextualEditor('Prog2')
      store.getState().editorActions.addModel(textual1)
      store.getState().editorActions.addModel(textual2)
      store.getState().editorActions.setEditor(textual1)

      store.getState().editorActions.updateModelVariablesForName('Prog2', {
        display: 'table',
        selectedRow: 3,
        classFilter: 'Local',
        description: 'textual desc',
      })

      const target = store.getState().editors.find((e) => e.meta.name === 'Prog2')
      if (target?.type === 'plc-textual' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('3')
        expect(target.variable.classFilter).toBe('Local')
        expect(target.variable.description).toBe('textual desc')
      }
    })

    it('updates plc-textual target with code data', () => {
      const textual1 = makeTextualEditor('Prog1')
      const textual2 = makeTextualEditor('Prog2')
      store.getState().editorActions.addModel(textual1)
      store.getState().editorActions.addModel(textual2)
      store.getState().editorActions.setEditor(textual1)

      store.getState().editorActions.updateModelVariablesForName('Prog2', { display: 'code', code: 'the code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Prog2')
      if (target?.type === 'plc-textual') {
        expect(target.variable).toEqual({ display: 'code', code: 'the code' })
      }
    })

    it('preserves existing code for plc-textual when no code provided', () => {
      const textual1 = makeTextualEditor('Prog1')
      const textual2 = makeTextualEditor('Prog2')
      store.getState().editorActions.addModel(textual1)
      store.getState().editorActions.addModel(textual2)
      store.getState().editorActions.setEditor(textual1)

      store.getState().editorActions.updateModelVariablesForName('Prog2', { display: 'code', code: 'saved' })
      store.getState().editorActions.updateModelVariablesForName('Prog2', { display: 'code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Prog2')
      if (target?.type === 'plc-textual') {
        expect(target.variable).toEqual({ display: 'code', code: 'saved' })
      }
    })

    it('uses defaults for plc-textual/plc-graphical table when not provided', () => {
      const graphical = makeGraphicalEditor('Graph', 'ld')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'table' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Graph')
      if (target?.type === 'plc-graphical' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('-1')
        expect(target.variable.classFilter).toBe('All')
        expect(target.variable.description).toBe('')
      }
    })

    it('updates plc-graphical target with code data', () => {
      const graphical = makeGraphicalEditor('Graph', 'ld')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'code', code: 'graphical code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Graph')
      if (target?.type === 'plc-graphical') {
        expect(target.variable).toEqual({ display: 'code', code: 'graphical code' })
      }
    })

    it('preserves existing code for plc-graphical when no code provided', () => {
      const graphical = makeGraphicalEditor('Graph', 'ld')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'code', code: 'saved' })
      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'code' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Graph')
      if (target?.type === 'plc-graphical') {
        expect(target.variable).toEqual({ display: 'code', code: 'saved' })
      }
    })

    it('switches plc-resource target from code to table in editors array', () => {
      const res = makeResourceEditor('Res')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(res)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      // Switch to code first
      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'code', code: 'code' })
      // Switch back to table
      store.getState().editorActions.updateModelVariablesForName('Res', { display: 'table' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Res')
      if (target?.type === 'plc-resource' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('-1')
        expect(target.variable.description).toBe('')
      }
    })

    it('switches plc-textual target from code to table in editors array', () => {
      const textual1 = makeTextualEditor('Prog1')
      const textual2 = makeTextualEditor('Prog2')
      store.getState().editorActions.addModel(textual1)
      store.getState().editorActions.addModel(textual2)
      store.getState().editorActions.setEditor(textual1)

      store.getState().editorActions.updateModelVariablesForName('Prog2', { display: 'code', code: 'code' })
      store.getState().editorActions.updateModelVariablesForName('Prog2', { display: 'table' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Prog2')
      if (target?.type === 'plc-textual' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('-1')
        expect(target.variable.classFilter).toBe('All')
        expect(target.variable.description).toBe('')
      }
    })

    it('switches plc-graphical target from code to table in editors array', () => {
      const graphical = makeGraphicalEditor('Graph', 'ld')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(graphical)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'code', code: 'code' })
      store.getState().editorActions.updateModelVariablesForName('Graph', { display: 'table' })

      const target = store.getState().editors.find((e) => e.meta.name === 'Graph')
      if (target?.type === 'plc-graphical' && target.variable.display === 'table') {
        expect(target.variable.selectedRow).toBe('-1')
        expect(target.variable.classFilter).toBe('All')
        expect(target.variable.description).toBe('')
      }
    })

    it('skips non-matching editor types (e.g., plc-device, plc-datatype)', () => {
      const datatype = makeDatatypeEditor('MyType')
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(datatype)
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelVariablesForName('MyType', { display: 'table', selectedRow: 1 })

      const target = store.getState().editors.find((e) => e.meta.name === 'MyType')
      if (target?.type === 'plc-datatype') {
        expect(target.structure.selectedRow).toBe('-1')
      }
    })
  })

  // -------------------------------------------------------------------------
  // updateModelTasks
  // -------------------------------------------------------------------------
  describe('updateModelTasks', () => {
    it('updates task to table display with selectedRow', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelTasks({ display: 'table', selectedRow: 2 })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.task).toEqual({ display: 'table', selectedRow: '2' })
      }
    })

    it('updates task to table display with default selectedRow when undefined', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelTasks({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.task).toEqual({ display: 'table', selectedRow: '-1' })
      }
    })

    it('updates task to code display', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelTasks({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.task).toEqual({ display: 'code' })
      }
    })

    it('does nothing for non-resource editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelTasks({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  // -------------------------------------------------------------------------
  // updateModelInstances
  // -------------------------------------------------------------------------
  describe('updateModelInstances', () => {
    it('updates instance to table display with selectedRow', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelInstances({ display: 'table', selectedRow: 4 })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.instance).toEqual({ display: 'table', selectedRow: '4' })
      }
    })

    it('updates instance to table display with default selectedRow', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelInstances({ display: 'table' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.instance).toEqual({ display: 'table', selectedRow: '-1' })
      }
    })

    it('updates instance to code display', () => {
      const resource = makeResourceEditor()
      store.getState().editorActions.addModel(resource)
      store.getState().editorActions.setEditor(resource)

      store.getState().editorActions.updateModelInstances({ display: 'code' })

      const editor = store.getState().editor
      if (editor.type === 'plc-resource') {
        expect(editor.instance).toEqual({ display: 'code' })
      }
    })

    it('does nothing for non-resource editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelInstances({ display: 'table', selectedRow: 1 })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  // -------------------------------------------------------------------------
  // updateModelStructure
  // -------------------------------------------------------------------------
  describe('updateModelStructure', () => {
    it('updates structure selectedRow and description', () => {
      const datatype = makeDatatypeEditor('MyStruct')
      store.getState().editorActions.addModel(datatype)
      store.getState().editorActions.setEditor(datatype)

      store.getState().editorActions.updateModelStructure({ selectedRow: 3, description: 'my desc' })

      const editor = store.getState().editor
      if (editor.type === 'plc-datatype') {
        expect(editor.structure).toEqual({ selectedRow: '3', description: 'my desc' })
      }
    })

    it('keeps existing selectedRow when undefined', () => {
      const datatype = makeDatatypeEditor('MyStruct')
      store.getState().editorActions.addModel(datatype)
      store.getState().editorActions.setEditor(datatype)

      store.getState().editorActions.updateModelStructure({ selectedRow: 5 })
      store.getState().editorActions.updateModelStructure({ description: 'updated' })

      const editor = store.getState().editor
      if (editor.type === 'plc-datatype') {
        expect(editor.structure).toEqual({ selectedRow: '5', description: 'updated' })
      }
    })

    it('keeps existing description when empty string is provided', () => {
      const datatype = makeDatatypeEditor('MyStruct')
      store.getState().editorActions.addModel(datatype)
      store.getState().editorActions.setEditor(datatype)

      store.getState().editorActions.updateModelStructure({ description: 'orig' })
      store.getState().editorActions.updateModelStructure({ description: '' })

      const editor = store.getState().editor
      if (editor.type === 'plc-datatype') {
        // empty string is falsy, so it keeps the old description
        expect(editor.structure.description).toBe('orig')
      }
    })

    it('does nothing for non-datatype editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelStructure({ selectedRow: 1, description: 'test' })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  // -------------------------------------------------------------------------
  // updateModelLadder
  // -------------------------------------------------------------------------
  describe('updateModelLadder', () => {
    it('adds a new rung when not found', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: true } })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        expect(editor.graphical.openedRungs).toEqual([{ rungId: 'r1', open: true }])
      }
    })

    it('updates an existing rung', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: false } })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        expect(editor.graphical.openedRungs).toEqual([{ rungId: 'r1', open: false }])
      }
    })

    it('updates one rung while preserving others in the map', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r2', open: true } })
      // Update r1 while r2 stays the same (hits the else branch of the ternary in map)
      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: false } })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        expect(editor.graphical.openedRungs).toEqual([
          { rungId: 'r1', open: false },
          { rungId: 'r2', open: true },
        ])
      }
    })

    it('does nothing when openRung is undefined', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelLadder({})

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        expect(editor.graphical.openedRungs).toEqual([])
      }
    })

    it('does nothing for non-ld graphical editor', () => {
      const fbd = makeGraphicalEditor('FbdProg', 'fbd')
      store.getState().editorActions.addModel(fbd)
      store.getState().editorActions.setEditor(fbd)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
        expect(editor.graphical).not.toHaveProperty('openedRungs')
      }
    })

    it('does nothing for non-graphical editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: true } })
      expect(store.getState().editor.type).toBe('plc-textual')
    })
  })

  // -------------------------------------------------------------------------
  // getIsRungOpen
  // -------------------------------------------------------------------------
  describe('getIsRungOpen', () => {
    it('returns true by default when rung not found', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      expect(store.getState().editorActions.getIsRungOpen({ rungId: 'nonexistent' })).toBe(true)
    })

    it('returns the open state of a found rung', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelLadder({ openRung: { rungId: 'r1', open: false } })
      expect(store.getState().editorActions.getIsRungOpen({ rungId: 'r1' })).toBe(false)
    })

    it('returns true for non-ld editor', () => {
      const fbd = makeGraphicalEditor('FbdProg', 'fbd')
      store.getState().editorActions.addModel(fbd)
      store.getState().editorActions.setEditor(fbd)

      expect(store.getState().editorActions.getIsRungOpen({ rungId: 'r1' })).toBe(true)
    })

    it('returns true for non-graphical editor', () => {
      expect(store.getState().editorActions.getIsRungOpen({ rungId: 'r1' })).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // updateModelFBD
  // -------------------------------------------------------------------------
  describe('updateModelFBD', () => {
    it('updates hoveringElement', () => {
      const fbd = makeGraphicalEditor('FbdProg', 'fbd')
      store.getState().editorActions.addModel(fbd)
      store.getState().editorActions.setEditor(fbd)

      store.getState().editorActions.updateModelFBD({
        hoveringElement: { elementId: 'elem1', hovering: true },
      })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
        expect(editor.graphical.hoveringElement).toEqual({ elementId: 'elem1', hovering: true })
      }
    })

    it('updates canEditorZoom and canEditorPan', () => {
      const fbd = makeGraphicalEditor('FbdProg', 'fbd')
      store.getState().editorActions.addModel(fbd)
      store.getState().editorActions.setEditor(fbd)

      store.getState().editorActions.updateModelFBD({ canEditorZoom: false, canEditorPan: false })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
        expect(editor.graphical.canEditorZoom).toBe(false)
        expect(editor.graphical.canEditorPan).toBe(false)
      }
    })

    it('does nothing for non-fbd graphical editor', () => {
      const ld = makeGraphicalEditor('LdProg', 'ld')
      store.getState().editorActions.addModel(ld)
      store.getState().editorActions.setEditor(ld)

      store.getState().editorActions.updateModelFBD({ canEditorZoom: false })
      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        expect(editor.graphical).not.toHaveProperty('canEditorZoom')
      }
    })

    it('does nothing for non-graphical editor', () => {
      store.getState().editorActions.updateModelFBD({ canEditorZoom: false })
      expect(store.getState().editor.type).toBe('available')
    })

    it('does not update hoveringElement when not provided', () => {
      const fbd = makeGraphicalEditor('FbdProg', 'fbd')
      store.getState().editorActions.addModel(fbd)
      store.getState().editorActions.setEditor(fbd)

      store.getState().editorActions.updateModelFBD({ canEditorZoom: false })

      const editor = store.getState().editor
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
        expect(editor.graphical.hoveringElement).toEqual({ elementId: null, hovering: false })
      }
    })
  })

  // -------------------------------------------------------------------------
  // updateEditorModel
  // -------------------------------------------------------------------------
  describe('updateEditorModel', () => {
    it('renames editor in editors array and current editor', () => {
      const textual = makeTextualEditor('OldName')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorModel('OldName', 'NewName')

      expect(store.getState().editors[0].meta.name).toBe('NewName')
      expect(store.getState().editor.meta.name).toBe('NewName')
    })

    it('does nothing when currentEditor equals newEditor', () => {
      const textual = makeTextualEditor('Same')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorModel('Same', 'Same')
      expect(store.getState().editor.meta.name).toBe('Same')
    })

    it('does nothing when editor not found in editors array', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorModel('NonExistent', 'NewName')
      expect(store.getState().editors[0].meta.name).toBe('Main')
    })
  })

  // -------------------------------------------------------------------------
  // updateEditorName
  // -------------------------------------------------------------------------
  describe('updateEditorName', () => {
    it('renames editor in editors array and current editor', () => {
      const textual = makeTextualEditor('OldName')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorName('OldName', 'NewName')

      expect(store.getState().editors[0].meta.name).toBe('NewName')
      expect(store.getState().editor.meta.name).toBe('NewName')
    })

    it('does nothing when oldName equals newName', () => {
      const textual = makeTextualEditor('Same')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorName('Same', 'Same')
      expect(store.getState().editor.meta.name).toBe('Same')
    })

    it('renames only in editors array when current editor has different name', () => {
      const first = makeTextualEditor('First')
      const second = makeTextualEditor('Second')
      store.getState().editorActions.addModel(first)
      store.getState().editorActions.addModel(second)
      store.getState().editorActions.setEditor(first)

      store.getState().editorActions.updateEditorName('Second', 'Renamed')

      expect(store.getState().editor.meta.name).toBe('First')
      const renamed = store.getState().editors.find((e) => e.meta.name === 'Renamed')
      expect(renamed).toBeDefined()
    })

    it('does nothing when editor name not found in editors array and not current', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.updateEditorName('NonExistent', 'NewName')
      expect(store.getState().editors[0].meta.name).toBe('Main')
      expect(store.getState().editor.meta.name).toBe('Main')
    })
  })

  // -------------------------------------------------------------------------
  // setEditor
  // -------------------------------------------------------------------------
  describe('setEditor', () => {
    it('sets a new editor and does not push old available editor to editors', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      expect(store.getState().editor.meta.name).toBe('Main')
      // The initial 'available' editor should not be saved to editors
      expect(store.getState().editors).toHaveLength(1)
    })

    it('swaps current editor back into editors array when switching', () => {
      const first = makeTextualEditor('First')
      const second = makeTextualEditor('Second')
      store.getState().editorActions.addModel(first)
      store.getState().editorActions.addModel(second)
      store.getState().editorActions.setEditor(first)

      // Now switch to second editor
      store.getState().editorActions.setEditor(second)
      expect(store.getState().editor.meta.name).toBe('Second')

      // First should be stored back in the editors array
      const firstInEditors = store.getState().editors.find((e) => e.meta.name === 'First')
      expect(firstInEditors).toBeDefined()
    })

    it('does nothing when setting the same editor', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      const prevState = store.getState()
      store.getState().editorActions.setEditor(makeTextualEditor('Main'))
      // Same name means no-op; state should remain unchanged
      expect(store.getState().editor.meta.name).toBe(prevState.editor.meta.name)
    })
  })

  // -------------------------------------------------------------------------
  // clearEditor
  // -------------------------------------------------------------------------
  it('clearEditor resets editors array and current editor', () => {
    store.getState().editorActions.addModel(makeTextualEditor('Main'))
    store.getState().editorActions.setEditor(makeTextualEditor('Main'))
    store.getState().editorActions.clearEditor()

    expect(store.getState().editors).toEqual([])
    expect(store.getState().editor).toEqual({ type: 'available', meta: { name: 'available' } })
  })

  // -------------------------------------------------------------------------
  // saveEditorViewState
  // -------------------------------------------------------------------------
  describe('saveEditorViewState', () => {
    it('saves cursor, scroll, and fbd positions', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      const cursor = { lineNumber: 10, column: 5, offset: 100 }
      const scroll = { top: 200, left: 0 }
      const fbdPos = { x: 50, y: 50, zoom: 1.5 }

      store.getState().editorActions.saveEditorViewState({
        prevEditorName: 'Main',
        cursorPosition: cursor,
        scrollPosition: scroll,
        fbdPosition: fbdPos,
      })

      const model = store.getState().editors.find((e) => e.meta.name === 'Main')
      expect(model?.cursorPosition).toEqual(cursor)
      expect(model?.scrollPosition).toEqual(scroll)
      expect(model?.fbdPosition).toEqual(fbdPos)
    })

    it('does nothing when editor is available type', () => {
      // Editor is 'available' by default
      store.getState().editorActions.saveEditorViewState({
        prevEditorName: 'available',
        cursorPosition: { lineNumber: 1, column: 1, offset: 0 },
      })
      expect(store.getState().editors).toEqual([])
    })

    it('does nothing when prevEditorName not found in editors', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      store.getState().editorActions.saveEditorViewState({
        prevEditorName: 'NonExistent',
        cursorPosition: { lineNumber: 1, column: 1, offset: 0 },
      })

      const model = store.getState().editors.find((e) => e.meta.name === 'Main')
      expect(model?.cursorPosition).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // getEditorFromEditors
  // -------------------------------------------------------------------------
  describe('getEditorFromEditors', () => {
    it('returns the current editor when name matches', () => {
      const textual = makeTextualEditor('Main')
      store.getState().editorActions.addModel(textual)
      store.getState().editorActions.setEditor(textual)

      const result = store.getState().editorActions.getEditorFromEditors('Main')
      expect(result?.meta.name).toBe('Main')
    })

    it('returns editor from editors array when not current', () => {
      const first = makeTextualEditor('First')
      const second = makeTextualEditor('Second')
      store.getState().editorActions.addModel(first)
      store.getState().editorActions.addModel(second)
      store.getState().editorActions.setEditor(first)

      const result = store.getState().editorActions.getEditorFromEditors('Second')
      expect(result?.meta.name).toBe('Second')
    })

    it('returns null when editor not found', () => {
      const result = store.getState().editorActions.getEditorFromEditors('NonExistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // setMonacoFocused
  // -------------------------------------------------------------------------
  it('setMonacoFocused', () => {
    store.getState().editorActions.setMonacoFocused(true)
    expect(store.getState().isMonacoFocused).toBe(true)

    store.getState().editorActions.setMonacoFocused(false)
    expect(store.getState().isMonacoFocused).toBe(false)
  })
})
