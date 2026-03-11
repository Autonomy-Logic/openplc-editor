// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export type VariablesTable =
  | {
      display: 'table'
      description: string
      classFilter: 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp'
      selectedRow: string
    }
  | {
      display: 'code'
      code?: string
    }

export type GlobalVariablesTableType =
  | {
      display: 'table'
      description: string
      selectedRow: string
    }
  | {
      display: 'code'
      code?: string
    }

export type StructureTableType = {
  description: string
  selectedRow: string
}

export type TaskType =
  | { display: 'table'; selectedRow: string }
  | { display: 'code' }

export type InstanceType =
  | { display: 'table'; selectedRow: string }
  | { display: 'code' }

// ---------------------------------------------------------------------------
// Graphical schemas
// ---------------------------------------------------------------------------

export type GraphicalType =
  | {
      language: 'ld'
      openedRungs: Array<{ rungId: string; open: boolean }>
    }
  | {
      language: 'sfc'
    }
  | {
      language: 'fbd'
      hoveringElement: { elementId: string | null; hovering: boolean }
      canEditorZoom: boolean
      canEditorPan: boolean
    }

// ---------------------------------------------------------------------------
// Cursor / scroll / FBD position
// ---------------------------------------------------------------------------

export type CursorPosition = {
  lineNumber: number
  column: number
  offset: number
}

export type ScrollPosition = {
  top: number
  left: number
}

export type FbdPosition = {
  x: number
  y: number
  zoom: number
}

// ---------------------------------------------------------------------------
// Editor model — discriminated union for all POU types
// ---------------------------------------------------------------------------

type EditorModelBase = {
  cursorPosition?: CursorPosition
  scrollPosition?: ScrollPosition
  fbdPosition?: FbdPosition
}

export type EditorModel = EditorModelBase &
  (
    | {
        type: 'available'
        meta: { name: string }
      }
    | {
        type: 'plc-textual'
        meta: {
          name: string
          path: string
          language: 'il' | 'st' | 'python' | 'cpp'
          pouType: 'program' | 'function' | 'function-block'
        }
        variable: VariablesTable
      }
    | {
        type: 'plc-graphical'
        meta: {
          name: string
          path: string
          language: 'ld' | 'sfc' | 'fbd'
          pouType: 'program' | 'function' | 'function-block'
        }
        variable: VariablesTable
        graphical: GraphicalType
      }
    | {
        type: 'plc-datatype'
        meta: {
          name: string
          derivation: 'enumerated' | 'structure' | 'array'
        }
        structure: StructureTableType
      }
    | {
        type: 'plc-resource'
        meta: {
          name: string
          path: string
        }
        variable: GlobalVariablesTableType
        task: TaskType
        instance: InstanceType
      }
    | {
        type: 'plc-device'
        meta: {
          name: string
          derivation: 'configuration' | 'pin-mapping' | 'orchestrators'
        }
      }
    | {
        type: 'plc-server'
        meta: {
          name: string
          protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua'
        }
      }
    | {
        type: 'plc-remote-device'
        meta: {
          name: string
          protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'
        }
      }
  )

// ---------------------------------------------------------------------------
// Editor State & Actions
// ---------------------------------------------------------------------------

export type EditorState = {
  editors: EditorModel[]
  editor: EditorModel
  isMonacoFocused: boolean
}

export type EditorActions = {
  addModel: (editor: EditorModel) => void
  removeModel: (name: string) => void
  updateEditorModel: (currentEditor: string, newEditor: string) => void
  updateEditorName: (oldName: string, newName: string) => void
  updateModelVariables: (variables: {
    display: 'code' | 'table'
    selectedRow?: number
    classFilter?: 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp'
    description?: string
    code?: string
  }) => void
  updateModelVariablesForName: (
    name: string,
    variables: {
      display: 'code' | 'table'
      selectedRow?: number
      classFilter?: 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp'
      description?: string
      code?: string
    },
  ) => void
  updateModelStructure: (data: { selectedRow?: number; description?: string }) => void
  updateModelTasks: (tasks: { selectedRow?: number; display: 'code' | 'table' }) => void
  updateModelInstances: (instances: { selectedRow?: number; display: 'code' | 'table' }) => void
  updateModelLadder: (data: { openRung?: { rungId: string; open: boolean } }) => void
  getIsRungOpen: (data: { rungId: string }) => boolean
  updateModelFBD: (data: {
    hoveringElement?: { elementId: string | null; hovering: boolean }
    canEditorZoom?: boolean
    canEditorPan?: boolean
  }) => void
  setEditor: (newEditor: EditorModel) => void
  clearEditor: () => void
  saveEditorViewState: (data: {
    prevEditorName: string
    cursorPosition?: CursorPosition
    scrollPosition?: ScrollPosition
    fbdPosition?: FbdPosition
  }) => void
  getEditorFromEditors: (name: string) => EditorModel | null
  setMonacoFocused: (focused: boolean) => void
}

export type EditorSlice = EditorState & {
  editorActions: EditorActions
}
