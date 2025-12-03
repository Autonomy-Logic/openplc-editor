import * as monaco from 'monaco-editor'

export interface PythonSnippet {
  label: string
  insertText: string
  documentation: string
  kind: monaco.languages.CompletionItemKind
  insertTextRules?: monaco.languages.CompletionItemInsertTextRule
}

export const pythonSnippets: PythonSnippet[] = [
  // Control Flow Structures
  {
    label: 'if',
    insertText: ['if ${1:condition}:', '\t${2:pass}'].join('\n'),
    documentation: 'IF statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'ifelse',
    insertText: ['if ${1:condition}:', '\t${2:pass}', 'else:', '\t${3:pass}'].join('\n'),
    documentation: 'IF-ELSE statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'ifelif',
    insertText: [
      'if ${1:condition}:',
      '\t${2:pass}',
      'elif ${3:condition}:',
      '\t${4:pass}',
      'else:',
      '\t${5:pass}',
    ].join('\n'),
    documentation: 'IF-ELIF-ELSE statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'for',
    insertText: ['for ${1:item} in ${2:iterable}:', '\t${3:pass}'].join('\n'),
    documentation: 'FOR loop',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'forrange',
    insertText: ['for ${1:i} in range(${2:10}):', '\t${3:pass}'].join('\n'),
    documentation: 'FOR loop with range',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'while',
    insertText: ['while ${1:condition}:', '\t${2:pass}'].join('\n'),
    documentation: 'WHILE loop',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'try',
    insertText: ['try:', '\t${1:pass}', 'except ${2:Exception} as ${3:e}:', '\t${4:pass}'].join('\n'),
    documentation: 'TRY-EXCEPT block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'tryfinally',
    insertText: [
      'try:',
      '\t${1:pass}',
      'except ${2:Exception} as ${3:e}:',
      '\t${4:pass}',
      'finally:',
      '\t${5:pass}',
    ].join('\n'),
    documentation: 'TRY-EXCEPT-FINALLY block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'with',
    insertText: ['with ${1:expression} as ${2:variable}:', '\t${3:pass}'].join('\n'),
    documentation: 'WITH statement (context manager)',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Function and Class Definitions
  {
    label: 'def',
    insertText: ['def ${1:function_name}(${2:args}):', '\t"""${3:Description}"""', '\t${4:pass}'].join('\n'),
    documentation: 'Function definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'defret',
    insertText: [
      'def ${1:function_name}(${2:args}) -> ${3:return_type}:',
      '\t"""${4:Description}"""',
      '\treturn ${5:value}',
    ].join('\n'),
    documentation: 'Function definition with return type',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'class',
    insertText: [
      'class ${1:ClassName}:',
      '\t"""${2:Class description}"""',
      '\t',
      '\tdef __init__(self${3:, args}):',
      '\t\t"""Initialize ${1:ClassName}."""',
      '\t\t${4:pass}',
    ].join('\n'),
    documentation: 'Class definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'classinherit',
    insertText: [
      'class ${1:ClassName}(${2:ParentClass}):',
      '\t"""${3:Class description}"""',
      '\t',
      '\tdef __init__(self${4:, args}):',
      '\t\tsuper().__init__(${5:args})',
      '\t\t${6:pass}',
    ].join('\n'),
    documentation: 'Class definition with inheritance',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'method',
    insertText: ['def ${1:method_name}(self${2:, args}):', '\t"""${3:Description}"""', '\t${4:pass}'].join('\n'),
    documentation: 'Method definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'staticmethod',
    insertText: ['@staticmethod', 'def ${1:method_name}(${2:args}):', '\t"""${3:Description}"""', '\t${4:pass}'].join(
      '\n',
    ),
    documentation: 'Static method definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'classmethod',
    insertText: [
      '@classmethod',
      'def ${1:method_name}(cls${2:, args}):',
      '\t"""${3:Description}"""',
      '\t${4:pass}',
    ].join('\n'),
    documentation: 'Class method definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'property',
    insertText: [
      '@property',
      'def ${1:property_name}(self):',
      '\t"""${2:Property description}"""',
      '\treturn self._${1:property_name}',
    ].join('\n'),
    documentation: 'Property definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Lambda and List Comprehensions
  {
    label: 'lambda',
    insertText: 'lambda ${1:args}: ${2:expression}',
    documentation: 'Lambda function',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'listcomp',
    insertText: '[${1:expression} for ${2:item} in ${3:iterable}]',
    documentation: 'List comprehension',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'listcompif',
    insertText: '[${1:expression} for ${2:item} in ${3:iterable} if ${4:condition}]',
    documentation: 'List comprehension with condition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'dictcomp',
    insertText: '{${1:key}: ${2:value} for ${3:item} in ${4:iterable}}',
    documentation: 'Dictionary comprehension',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Import Statements
  {
    label: 'import',
    insertText: 'import ${1:module}',
    documentation: 'Import statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'importas',
    insertText: 'import ${1:module} as ${2:alias}',
    documentation: 'Import with alias',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'from',
    insertText: 'from ${1:module} import ${2:name}',
    documentation: 'From import statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Common Patterns
  {
    label: 'ifmain',
    insertText: ['if __name__ == "__main__":', '\t${1:main()}'].join('\n'),
    documentation: 'If main pattern',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'main',
    insertText: [
      'def main():',
      '\t"""Main function."""',
      '\t${1:pass}',
      '',
      '',
      'if __name__ == "__main__":',
      '\tmain()',
    ].join('\n'),
    documentation: 'Main function pattern',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'dataclass',
    insertText: [
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class ${1:ClassName}:',
      '\t"""${2:Class description}"""',
      '\t${3:field}: ${4:type}',
    ].join('\n'),
    documentation: 'Dataclass definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'enum',
    insertText: [
      'from enum import Enum',
      '',
      'class ${1:EnumName}(Enum):',
      '\t"""${2:Enum description}"""',
      '\t${3:VALUE1} = ${4:1}',
      '\t${5:VALUE2} = ${6:2}',
    ].join('\n'),
    documentation: 'Enum definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Async/Await
  {
    label: 'async',
    insertText: ['async def ${1:function_name}(${2:args}):', '\t"""${3:Description}"""', '\t${4:pass}'].join('\n'),
    documentation: 'Async function definition',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'await',
    insertText: 'await ${1:async_function()}',
    documentation: 'Await expression',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Comments and Documentation
  {
    label: 'docstring',
    insertText: [
      '"""${1:Brief description}.',
      '',
      '${2:Detailed description}',
      '',
      'Args:',
      '\t${3:arg_name}: ${4:Description}',
      '',
      'Returns:',
      '\t${5:Description}',
      '',
      'Raises:',
      '\t${6:ExceptionType}: ${7:Description}',
      '"""',
    ].join('\n'),
    documentation: 'Google-style docstring',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'todo',
    insertText: '# TODO: ${1:Description}',
    documentation: 'TODO comment',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'fixme',
    insertText: '# FIXME: ${1:Description}',
    documentation: 'FIXME comment',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },

  // Print and Debug
  {
    label: 'print',
    insertText: 'print(${1:value})',
    documentation: 'Print statement',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'printf',
    insertText: 'print(f"${1:message}: {${2:variable}}")',
    documentation: 'Print with f-string',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
  {
    label: 'pprint',
    insertText: ['from pprint import pprint', 'pprint(${1:data})'].join('\n'),
    documentation: 'Pretty print',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  },
]
