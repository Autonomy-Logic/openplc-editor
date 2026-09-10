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

export type StructureTableType =
  | {
      display: 'table'
      description: string
      selectedRow: string
    }
  | {
      display: 'code'
      code?: string
    }

export type TaskType = { display: 'table'; selectedRow: string } | { display: 'code' }

export type InstanceType = { display: 'table'; selectedRow: string } | { display: 'code' }

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
  /**
   * Which Monaco surface should consume this cursor jump.
   *
   *   - `body` (default) — targets the POU body editor.  The
   *     variables-code-editor ignores positions tagged this way.
   *   - `variables` — targets the variables panel's text-mode
   *     editor.  Triggers a forced switch to text mode if the panel
   *     is currently in table mode, and the body editor ignores
   *     positions tagged this way.
   *   - `data-type` — targets a data type's `.dt` code view, with the
   *     same forced switch out of table mode.
   *
   * Used by Go to Definition redirects: when the LSP points at a
   * variable declaration (synthesized header line), we surface that
   * line inside the variables panel instead of clamping the cursor
   * to the body's line 1.
   */
  target?: 'body' | 'variables' | 'data-type'
}

// ---------------------------------------------------------------------------
// Editor model — discriminated union for all POU types
// ---------------------------------------------------------------------------

type EditorModelBase = {
  /**
   * Programmatic cursor target.  Set by the Go to Definition redirect,
   * the compile-error click handler, etc.  The editor's reactive
   * effect picks it up and calls `setSelection` on its Monaco
   * instance.  Not used for "remember the user's position across a
   * tab switch" — editors stay mounted across switches now, so
   * Monaco's own internal cursor state is preserved naturally.
   */
  cursorPosition?: CursorPosition
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
        /**
         * A Global Variable List. It reuses `StructureTableType` because it presents the
         * same way a structure does — a table of declarations with a code view behind the
         * same toggle — which is also how CODESYS shows a GVL.
         */
        type: 'plc-global-variable-list'
        meta: {
          name: string
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
          derivation: 'configuration' | 'pin-mapping' | 'orchestrators' | 'runtime-status'
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
    | {
        type: 'plc-vendor-screen'
        meta: {
          name: string
          screenName: string
        }
      }
    | {
        type: 'plc-package-manager'
        meta: {
          name: string
        }
      }
    | {
        type: 'plc-library-manager'
        meta: {
          name: string
        }
      }
    | {
        /** Runtime User Management screen. A device-scoped singleton shown
         *  under the Device tree branch while connected to a runtime. */
        type: 'plc-user-management'
        meta: {
          name: string
        }
      }
    | {
        /** Persistent Storage screen — where the connected runtime keeps its
         *  RETAIN variables. Device-scoped like User Management: the settings
         *  live on the runtime, not in the project. */
        type: 'plc-persistent-storage'
        meta: {
          name: string
        }
      }
    | {
        /** The Library Project's manifest tab — Monaco-wrapped
         *  `library.json` at the project root.  Only ever opened
         *  when `meta.type === 'plc-library'`.  Always present
         *  while a library project is open; the user can close
         *  the tab and re-open it from the project tree. */
        type: 'plc-library-manifest'
        meta: {
          name: string
        }
      }
    | {
        type: 'plc-ethercat-device'
        meta: {
          name: string
          busName: string
          deviceId: string
        }
      }
    | {
        /** Read-only source-control diff tab. Carries only the project-
         *  relative `filePath`; the original (HEAD) and current (working-
         *  tree) contents are derived live from the store at render time so
         *  the diff stays fresh as the user edits. `name` is the unique tab
         *  key (e.g. `Diff: pous/programs/Main.st`). */
        type: 'diff-viewer'
        meta: {
          name: string
          filePath: string
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
  /** `display` is optional so table-mode row/description updates can't flip the view. */
  updateModelStructure: (data: {
    display?: 'code' | 'table'
    selectedRow?: number
    description?: string
    code?: string
  }) => void
  updateModelStructureForName: (
    name: string,
    data: { display?: 'code' | 'table'; selectedRow?: number; description?: string; code?: string },
  ) => void
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
  /**
   * Programmatically update an editor model's cursor position.  Used
   * by navigation into an editor (Go to Definition redirect,
   * compile-error click).  Updates both the model in
   * `state.editors[]` AND `state.editor` when names match — without
   * that double-write the active editor's reactive Monaco useEffect
   * never sees the change.
   *
   * The save-on-tab-switch / restore-on-mount cycle no longer exists
   * (every editor stays mounted across tab switches), so the field
   * is exclusively a programmatic-jump channel.
   */
  setEditorCursor: (name: string, cursorPosition: CursorPosition) => void
  getEditorFromEditors: (name: string) => EditorModel | null
  setMonacoFocused: (focused: boolean) => void
}

export type EditorSlice = EditorState & {
  editorActions: EditorActions
}
