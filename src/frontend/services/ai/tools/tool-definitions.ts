import type { AIToolDefinition } from '../types'

export const createPouTool: AIToolDefinition = {
  name: 'create_pou',
  description:
    'Create a new POU (Program Organization Unit) in the project. Only textual languages are supported (ST, IL, Python, C++). For graphical languages (LD, FBD), explain to the user that they must be created manually. IMPORTANT: The "body" field must contain ONLY executable code — do NOT include VAR declarations, PROGRAM/FUNCTION/FUNCTION_BLOCK headers, or END keywords. Variables must be created separately using the create_variable tool.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the POU. Must be unique within the project.',
      },
      type: {
        type: 'string',
        enum: ['program', 'function', 'function-block'],
        description: 'POU type.',
      },
      language: {
        type: 'string',
        enum: ['st', 'il', 'python', 'cpp'],
        description: 'Programming language. Use "st" (Structured Text) as default.',
      },
      body: {
        type: 'string',
        description: 'Optional initial executable code body. Must NOT include VAR blocks or POU wrappers.',
      },
    },
    required: ['name', 'type', 'language'],
  },
}

export const updatePouBodyTool: AIToolDefinition = {
  name: 'update_pou_body',
  description:
    'Update the code body of an existing POU. Replaces the entire body. Only works for textual POUs (ST, IL, Python, C++). IMPORTANT: The "code" field must contain ONLY executable code — do NOT include VAR declarations or POU wrapper keywords.',
  input_schema: {
    type: 'object',
    properties: {
      pouName: {
        type: 'string',
        description: 'Name of the POU to update.',
      },
      code: {
        type: 'string',
        description: 'The new executable code body.',
      },
    },
    required: ['pouName', 'code'],
  },
}

export const createVariableTool: AIToolDefinition = {
  name: 'create_variable',
  description:
    'Add a variable to an existing POU or to the global scope. Supports all IEC 61131-3 base types and user-defined types.',
  input_schema: {
    type: 'object',
    properties: {
      pouName: {
        type: 'string',
        description: 'Name of the POU to add the variable to. Omit for global variables.',
      },
      name: {
        type: 'string',
        description: 'Variable name. Must be unique within the scope.',
      },
      class: {
        type: 'string',
        enum: ['input', 'output', 'inOut', 'external', 'local', 'temp'],
        description: 'Variable class. Default is "local".',
      },
      type: {
        type: 'string',
        description: 'Variable type (e.g., "BOOL", "INT", "DINT", "REAL", "STRING").',
      },
      initialValue: {
        type: 'string',
        description: 'Optional initial value (e.g., "0", "TRUE", "T#1s").',
      },
    },
    required: ['name', 'type'],
  },
}

export const deletePouTool: AIToolDefinition = {
  name: 'delete_pou',
  description: 'Delete an existing POU from the project. This action cannot be undone individually.',
  input_schema: {
    type: 'object',
    properties: {
      pouName: {
        type: 'string',
        description: 'Name of the POU to delete.',
      },
    },
    required: ['pouName'],
  },
}

export const updateVariableTool: AIToolDefinition = {
  name: 'update_variable',
  description: 'Update an existing variable in a POU or in the global scope.',
  input_schema: {
    type: 'object',
    properties: {
      pouName: {
        type: 'string',
        description: 'Name of the POU containing the variable. Omit for global variables.',
      },
      currentName: {
        type: 'string',
        description: 'Current name of the variable to update.',
      },
      newName: { type: 'string', description: 'New name. Omit to keep current.' },
      class: {
        type: 'string',
        enum: ['input', 'output', 'inOut', 'external', 'local', 'temp'],
        description: 'New variable class. Omit to keep current.',
      },
      type: { type: 'string', description: 'New variable type. Omit to keep current.' },
      initialValue: { type: 'string', description: 'New initial value. Omit to keep current.' },
    },
    required: ['currentName'],
  },
}

export const deleteVariableTool: AIToolDefinition = {
  name: 'delete_variable',
  description: 'Delete a variable from a POU or from the global scope.',
  input_schema: {
    type: 'object',
    properties: {
      pouName: {
        type: 'string',
        description: 'Name of the POU containing the variable. Omit for global variables.',
      },
      variableName: { type: 'string', description: 'Name of the variable to delete.' },
    },
    required: ['variableName'],
  },
}

export const createDatatypeTool: AIToolDefinition = {
  name: 'create_datatype',
  description: 'Create a new user-defined data type. Supports structures (STRUCT), enumerations (ENUM), and arrays.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the data type. Must be unique.' },
      derivation: {
        type: 'string',
        enum: ['structure', 'enumerated', 'array'],
        description: 'Type of data type.',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
          },
          required: ['name', 'type'],
        },
        description: 'For structures: array of fields with name and type.',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'For enumerations: array of enum value names.',
      },
      baseType: { type: 'string', description: 'For arrays: the base element type.' },
      dimensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'For arrays: dimension ranges (e.g., ["0..9"]).',
      },
      initialValue: { type: 'string', description: 'Optional initial value.' },
    },
    required: ['name', 'derivation'],
  },
}

export const updateDatatypeTool: AIToolDefinition = {
  name: 'update_datatype',
  description:
    'Update an existing user-defined data type. The derivation (structure/enumerated/array) cannot be changed after creation — if you need a different derivation, delete and re-create the type. Sections you omit are preserved unchanged, so you can rename without re-sending fields, or replace only the values list of an enum.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Current name of the data type to update.',
      },
      newName: {
        type: 'string',
        description: 'New name for the data type. Omit to keep the current name.',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
          },
          required: ['name', 'type'],
        },
        description:
          'For structures: the complete new list of fields (replaces all existing fields). Omit to keep fields unchanged.',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description:
          'For enumerations: the complete new list of values (replaces all existing values). Omit to keep values unchanged.',
      },
      baseType: {
        type: 'string',
        description: 'For arrays: the new base element type. Omit to keep unchanged.',
      },
      dimensions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'For arrays: the complete new list of dimension ranges (replaces all existing). Omit to keep unchanged.',
      },
      initialValue: {
        type: 'string',
        description: 'New initial value for enum/array types. Omit to keep current.',
      },
    },
    required: ['name'],
  },
}

export const deleteDatatypeTool: AIToolDefinition = {
  name: 'delete_datatype',
  description:
    'Delete an existing user-defined data type from the project. Closes any open editor tab for it and removes it from the library. Variables that reference the deleted type will become invalid — consider whether to remove or retype those first.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the data type to delete.',
      },
    },
    required: ['name'],
  },
}

export const readProjectStateTool: AIToolDefinition = {
  name: 'read_project_state',
  description: 'Read the current project state including all POUs, variables, data types, and globals.',
  input_schema: {
    type: 'object',
    properties: {},
  },
}

/**
 * Read one POU's body verbatim.
 *
 * The escape hatch that makes context completeness a non-issue: whatever the
 * chat payload could not carry (or the model wants to re-read exactly), it can
 * pull on demand. Graphical POUs return their transpiled ST equivalent — the
 * stored XYFlow graph is node coordinates, which is not something a model can
 * reason about.
 */
const readPouBodyTool: AIToolDefinition = {
  name: 'read_pou_body',
  description:
    "Read a POU's full source code, verbatim and untruncated. For graphical POUs (LD/FBD/SFC) this returns the transpiled Structured Text equivalent. Use this whenever you need to see a POU's complete implementation.",
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the POU to read. Must match an existing POU exactly (case-insensitive).',
      },
    },
    required: ['name'],
  },
}

/** All available tools for the AI chat */
export const AI_TOOLS: AIToolDefinition[] = [
  createPouTool,
  updatePouBodyTool,
  createVariableTool,
  deletePouTool,
  updateVariableTool,
  deleteVariableTool,
  createDatatypeTool,
  updateDatatypeTool,
  deleteDatatypeTool,
  readProjectStateTool,
  readPouBodyTool,
]

/** Tool names that mutate project state. Used to gate the diff-review UI and the per-turn status list. */
export const MUTATING_TOOL_NAMES = new Set<string>([
  'create_pou',
  'update_pou_body',
  'create_variable',
  'delete_pou',
  'update_variable',
  'delete_variable',
  'create_datatype',
  'update_datatype',
  'delete_datatype',
])

export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOL_NAMES.has(toolName)
}

/**
 * Mutating tools whose result produces a reviewable diff in the editor
 * (a `pendingDiffs` entry of per-hunk accept/reject controls). Everything
 * else in `MUTATING_TOOL_NAMES` (variable/datatype CRUD, POU deletion)
 * changes project state without any hunks to review.
 */
export const DIFF_PRODUCING_TOOL_NAMES = new Set<string>(['create_pou', 'update_pou_body'])

/**
 * A mutating tool that does NOT surface per-hunk diff controls. The chat
 * panel uses this to decide whether resolving every pending hunk fully
 * resolves the turn: if a turn only ran diff-producing tools, clearing all
 * hunks means there's nothing left to keep/undo, so the Keep/Undo bar can
 * hide. If a non-diff mutation also ran, the bar stays so the user can still
 * keep or revert those changes.
 */
export function isNonDiffMutatingTool(toolName: string): boolean {
  return MUTATING_TOOL_NAMES.has(toolName) && !DIFF_PRODUCING_TOOL_NAMES.has(toolName)
}
