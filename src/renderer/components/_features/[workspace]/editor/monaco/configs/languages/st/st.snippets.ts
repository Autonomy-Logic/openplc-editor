import * as monaco from 'monaco-editor'

export interface STSnippet {
  label: string
  insertText: string
  documentation: string
  kind: monaco.languages.CompletionItemKind
  insertTextRules?: monaco.languages.CompletionItemInsertTextRule
}

export const stSnippets: STSnippet[] = [
  // Control Flow Structures
  {
    label: 'if',
    insertText: ['IF ${1:condition} THEN', '\t${2:// code}', 'END_IF;'].join('\n'),
    documentation: 'IF statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'ifelse',
    insertText: ['IF ${1:condition} THEN', '\t${2:// code}', 'ELSE', '\t${3:// code}', 'END_IF;'].join('\n'),
    documentation: 'IF-ELSE statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'ifelseif',
    insertText: [
      'IF ${1:condition} THEN',
      '\t${2:// code}',
      'ELSIF ${3:condition} THEN',
      '\t${4:// code}',
      'ELSE',
      '\t${5:// code}',
      'END_IF;',
    ].join('\n'),
    documentation: 'IF-ELSIF-ELSE statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'for',
    insertText: ['FOR ${1:i} := ${2:1} TO ${3:10} BY ${4:1} DO', '\t${5:// code}', 'END_FOR;'].join('\n'),
    documentation: 'FOR loop',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'while',
    insertText: ['WHILE ${1:condition} DO', '\t${2:// code}', 'END_WHILE;'].join('\n'),
    documentation: 'WHILE loop',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'repeat',
    insertText: ['REPEAT', '\t${1:// code}', 'UNTIL ${2:condition}', 'END_REPEAT;'].join('\n'),
    documentation: 'REPEAT-UNTIL loop',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'case',
    insertText: [
      'CASE ${1:variable} OF',
      '\t${2:1}: ${3:// code}',
      '\t${4:2}: ${5:// code}',
      '\tELSE ${6:// default code}',
      'END_CASE;',
    ].join('\n'),
    documentation: 'CASE statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Program Structures
  {
    label: 'program',
    insertText: [
      'PROGRAM ${1:ProgramName}',
      'VAR',
      '\t${2:// variables}',
      'END_VAR',
      '',
      'BEGIN',
      '\t${3:// code}',
      'END_PROGRAM',
    ].join('\n'),
    documentation: 'Complete PROGRAM structure',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'function',
    insertText: [
      'FUNCTION ${1:FunctionName} : ${2:BOOL}',
      'VAR_INPUT',
      '\t${3:// input variables}',
      'END_VAR',
      'VAR',
      '\t${4:// local variables}',
      'END_VAR',
      '',
      '\t${5:// code}',
      '\t${1:FunctionName} := ${6:result};',
      'END_FUNCTION',
    ].join('\n'),
    documentation: 'Complete FUNCTION structure',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'function_block',
    insertText: [
      'FUNCTION_BLOCK ${1:FunctionBlockName}',
      'VAR_INPUT',
      '\t${2:// input variables}',
      'END_VAR',
      'VAR_OUTPUT',
      '\t${3:// output variables}',
      'END_VAR',
      'VAR',
      '\t${4:// local variables}',
      'END_VAR',
      '',
      '\t${5:// code}',
      'END_FUNCTION_BLOCK',
    ].join('\n'),
    documentation: 'Complete FUNCTION_BLOCK structure',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'method',
    insertText: [
      'METHOD ${1:MethodName} : ${2:BOOL}',
      'VAR_INPUT',
      '\t${3:// input variables}',
      'END_VAR',
      'VAR',
      '\t${4:// local variables}',
      'END_VAR',
      '',
      '\t${5:// code}',
      '\t${1:MethodName} := ${6:result};',
      'END_METHOD',
    ].join('\n'),
    documentation: 'Complete METHOD structure',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Variable Declarations
  {
    label: 'var',
    insertText: ['VAR', '\t${1:variableName} : ${2:BOOL};', 'END_VAR'].join('\n'),
    documentation: 'Variable declaration block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'var_input',
    insertText: ['VAR_INPUT', '\t${1:inputName} : ${2:BOOL};', 'END_VAR'].join('\n'),
    documentation: 'Input variable declaration block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'var_output',
    insertText: ['VAR_OUTPUT', '\t${1:outputName} : ${2:BOOL};', 'END_VAR'].join('\n'),
    documentation: 'Output variable declaration block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Function Block Calls
  {
    label: 'ton',
    insertText: ['${1:timerName}(', '\tIN := ${2:condition},', '\tPT := ${3:T#1s}', ');'].join('\n'),
    documentation: 'TON Timer call',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'tof',
    insertText: ['${1:timerName}(', '\tIN := ${2:condition},', '\tPT := ${3:T#1s}', ');'].join('\n'),
    documentation: 'TOF Timer call',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'ctu',
    insertText: [
      '${1:counterName}(',
      '\tCU := ${2:condition},',
      '\tRESET := ${3:reset},',
      '\tPV := ${4:10}',
      ');',
    ].join('\n'),
    documentation: 'CTU Counter call',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Common Patterns
  {
    label: 'array',
    insertText: '${1:arrayName} : ARRAY[${2:0..9}] OF ${3:BOOL};',
    documentation: 'Array declaration',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'struct',
    insertText: [
      'TYPE ${1:StructName} :',
      'STRUCT',
      '\t${2:member1} : ${3:BOOL};',
      '\t${4:member2} : ${5:INT};',
      'END_STRUCT',
      'END_TYPE',
    ].join('\n'),
    documentation: 'STRUCT type definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'comment_block',
    insertText: ['(*', ' * ${1:Description}', ' * Author: ${2:Name}', ' * Date: ${3:Date}', ' *)'].join('\n'),
    documentation: 'Block comment template',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
]
