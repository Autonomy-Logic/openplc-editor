import { EditorState, LibraryState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { PLCProject } from '@root/types/PLC/open-plc'
import * as monaco from 'monaco-editor'

import { pythonSnippets } from '../configs/languages/python/python.snippets'
import { stSnippets } from '../configs/languages/st/st.snippets'
import { parsePouToStText } from '../drag-and-drop/st'

export { cppSignatureHelp, cppSnippetsCompletion, cppStandardLibraryCompletion } from './cpp.completion'

interface SnippetItem {
  label: string
  insertText: string
  documentation: string
  kind: monaco.languages.CompletionItemKind
  insertTextRules?: monaco.languages.CompletionItemInsertTextRule
}

export const languageKeywords = {
  st: [
    'if',
    'end_if',
    'elsif',
    'else',
    'case',
    'of',
    'to',
    '__try',
    '__catch',
    '__finally',
    'do',
    'with',
    'by',
    'while',
    'repeat',
    'end_while',
    'end_repeat',
    'end_case',
    'for',
    'end_for',
    'task',
    'retain',
    'non_retain',
    'constant',
    'with',
    'at',
    'exit',
    'return',
    'interval',
    'priority',
    'address',
    'port',
    'on_channel',
    'then',
    'iec',
    'file',
    'uses',
    'version',
    'packagetype',
    'displayname',
    'copyright',
    'summary',
    'vendor',
    'common_source',
    'from',
    'extends',
    'implements',

    'var',
    'var_input',
    'var_output',
    'var_in_out',
    'var_temp',
    'var_global',
    'var_access',
    'var_external',
    'end_var',
    'type',
    'end_type',
    'struct',
    'end_struct',
    'program',
    'end_program',
    'function',
    'end_function',
    'function_block',
    'end_function_block',
    'interface',
    'end_interface',
    'method',
    'end_method',
    'property',
    'end_property',
    'namespace',
    'end_namespace',
    'configuration',
    'end_configuration',
    'tcp',
    'end_tcp',
    'resource',
    'end_resource',
    'channel',
    'end_channel',
    'library',
    'end_library',
    'folder',
    'end_folder',
    'binaries',
    'end_binaries',
    'includes',
    'end_includes',
    'sources',
    'end_sources',
    'action',
    'end_action',
    'step',
    'initial_step',
    'end_step',
    'transaction',
    'end_transaction',

    'int',
    'sint',
    'dint',
    'lint',
    'usint',
    'uint',
    'udint',
    'ulint',
    'real',
    'lreal',
    'time',
    'date',
    'time_of_day',
    'date_and_time',
    'string',
    'bool',
    'byte',
    'word',
    'dword',
    'array',
    'pointer',
    'lword',
  ],
  il: [
    'LD',
    'LDN',
    'ST',
    'STN',
    'S',
    'R',
    'AND',
    'ANDN',
    '&',
    '&N',
    'OR',
    'ORN',
    'XOR',
    'XORN',
    'NOT',
    'ADD',
    'SUB',
    'MUL',
    'DIV',
    'MOD',
    'GT',
    'GE',
    'EQ',
    'NE',
    'LE',
    'LT',
    'JMP',
    'JMPC',
    'JMPN',
    'CAL',
    'CALC',
    'CALN',
    'RET',
    'RETC',
    'RETN',
  ],
  python: [
    'if',
    'elif',
    'else',
    'for',
    'while',
    'break',
    'continue',
    'pass',
    'return',
    'yield',
    'try',
    'except',
    'finally',
    'raise',
    'with',
    'as',

    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'is',
    'in',

    'def',
    'class',
    'lambda',
    'self',

    'import',
    'from',

    'global',
    'nonlocal',

    'assert',

    'async',
    'await',

    'int',
    'float',
    'str',
    'bool',
    'list',
    'dict',
    'tuple',
    'set',
    'frozenset',
    'bytes',
    'bytearray',

    'print',
    'len',
    'range',
    'enumerate',
    'zip',
    'map',
    'filter',
    'sum',
    'min',
    'max',
    'abs',
    'round',
    'sorted',
    'reversed',
    'any',
    'all',
    'type',
    'isinstance',
    'hasattr',
    'getattr',
    'setattr',
    'delattr',
  ],
}

export const getKeywords = (language: 'st' | 'il' | 'python') => languageKeywords[language]

export const keywordsCompletion = ({ language, range }: { language: 'st' | 'il' | 'python'; range: monaco.IRange }) => {
  const keywords = getKeywords(language)
  const suggestions = keywords.map((keyword) => {
    return {
      label: keyword,
      insertText: keyword,
      documentation: '',
      kind: monaco.languages.CompletionItemKind.Keyword,
      range,
    }
  })
  return {
    suggestions,
  }
}

export const tableVariablesCompletion = ({ range, variables }: { range: monaco.IRange; variables: PLCVariable[] }) => {
  const suggestions = variables.map((variable) => {
    return {
      label: variable.name,
      insertText: variable.name,
      documentation: 'Local variable' + (variable.documentation && ':\n' + variable.documentation),
      kind: monaco.languages.CompletionItemKind.Variable,
      range,
    }
  })

  return {
    suggestions,
  }
}

export const tableGlobalVariablesCompletion = ({
  range,
  variables,
}: {
  range: monaco.IRange
  variables: PLCVariable[]
}) => {
  const suggestions = variables.map((variable) => {
    return {
      label: variable.name,
      insertText: variable.name,
      documentation: 'Global variable' + (variable.documentation && ':\n' + variable.documentation),
      kind: monaco.languages.CompletionItemKind.Field,
      range,
    }
  })

  return {
    suggestions,
  }
}

export const libraryCompletion = ({
  range,
  library,
  pous,
  editor,
}: {
  range: monaco.IRange
  library: LibraryState['libraries']
  pous: PLCProject['data']['pous']
  editor: EditorState['editor']
}) => {
  const systemSuggestions = library.system
    .filter((library) =>
      pous.find((pou) => pou.data.name === editor.meta.name)?.type === 'function'
        ? library.pous.some((pou) => pou.type === 'function')
        : library.pous.some((pou) => pou),
    )
    .flatMap((system) => {
      return system.pous.map((pou) => {
        const text = parsePouToStText(pou)
        return {
          label: pou.name,
          insertText: text,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: pou.documentation,
          kind: monaco.languages.CompletionItemKind.Function,
          range,
        }
      })
    })
  const userSuggestions = library.user
    .filter((userLibrary) => {
      if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
        if (editor.meta.pouType === 'program') {
          return (
            (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
            userLibrary.name !== editor.meta.name
          )
        } else if (editor.meta.pouType === 'function') {
          return userLibrary.type === 'function' && userLibrary.name !== editor.meta.name
        } else if (editor.meta.pouType === 'function-block') {
          return (
            (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
            userLibrary.name !== editor.meta.name
          )
        }
      }

      // Remove userLibrary if its name matches editor.meta.name (fallback case)
      return userLibrary.name !== editor.meta.name
    })
    .flatMap((user) => {
      const pou = pous.find((pou) => pou.data.name === user.name)
      if (!pou) return []

      const data: {
        name: string
        language?: string
        type: string
        body?: string
        documentation?: string
        variables?: {
          name: string
          class: string | undefined
          type: { definition: string; value: string }
        }[]
        extensible?: boolean
      } = {
        name: pou.data.name,
        type: pou.type,
        variables: pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        })),
        documentation: pou.data.documentation,
        extensible: false,
      }
      const text = parsePouToStText(data)

      return {
        label: pou.data.name,
        insertText: text,
        documentation: pou.data.documentation,
        kind: monaco.languages.CompletionItemKind.Function,
        range,
      }
    })

  return {
    suggestions: [...systemSuggestions, ...userSuggestions],
  }
}

export const snippetsCompletion = ({ language, range }: { language: 'st' | 'il' | 'python'; range: monaco.IRange }) => {
  let snippets: SnippetItem[] = []

  switch (language) {
    case 'st':
      snippets = stSnippets
      break
    case 'python':
      snippets = pythonSnippets
      break
    case 'il':
    default:
      return { suggestions: [] }
  }

  const suggestions = snippets.map((snippet) => ({
    label: snippet.label,
    insertText: snippet.insertText,
    documentation: snippet.documentation,
    kind: snippet.kind,
    insertTextRules: snippet.insertTextRules,
    range,
  }))

  return { suggestions }
}

export const snippetsSTCompletion = ({ language, range }: { language: 'st' | 'il'; range: monaco.IRange }) => {
  if (language !== 'st') {
    return { suggestions: [] }
  }

  const suggestions = stSnippets.map((snippet) => ({
    label: snippet.label,
    insertText: snippet.insertText,
    documentation: snippet.documentation,
    kind: snippet.kind,
    insertTextRules: snippet.insertTextRules,
    range,
  }))

  return { suggestions }
}

export const pythonBuiltinsCompletion = ({ range }: { range: monaco.IRange }) => {
  const builtinFunctions = [
    'abs',
    'all',
    'any',
    'ascii',
    'bin',
    'bool',
    'breakpoint',
    'bytearray',
    'bytes',
    'callable',
    'chr',
    'classmethod',
    'compile',
    'complex',
    'delattr',
    'dict',
    'dir',
    'divmod',
    'enumerate',
    'eval',
    'exec',
    'filter',
    'float',
    'format',
    'frozenset',
    'getattr',
    'globals',
    'hasattr',
    'hash',
    'help',
    'hex',
    'id',
    'input',
    'int',
    'isinstance',
    'issubclass',
    'iter',
    'len',
    'list',
    'locals',
    'map',
    'max',
    'memoryview',
    'min',
    'next',
    'object',
    'oct',
    'open',
    'ord',
    'pow',
    'print',
    'property',
    'range',
    'repr',
    'reversed',
    'round',
    'set',
    'setattr',
    'slice',
    'sorted',
    'staticmethod',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'vars',
    'zip',
  ]

  const suggestions = builtinFunctions.map((func) => ({
    label: func,
    insertText: func + '(${1})',
    documentation: `Python built-in function: ${func}`,
    kind: monaco.languages.CompletionItemKind.Function,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }))

  return { suggestions }
}
