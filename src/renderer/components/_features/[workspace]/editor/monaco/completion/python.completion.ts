import * as monaco from 'monaco-editor'

import { language as pythonLanguage } from '../configs/languages/python/python'

export function providePythonCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionList {
  const word = model.getWordUntilPosition(position)
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  }

  const suggestions: monaco.languages.CompletionItem[] = []

  const keywords = pythonLanguage.keywords as string[]
  keywords.forEach((keyword) => {
    suggestions.push({
      label: keyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      detail: 'Python keyword',
    })
  })

  const builtins = pythonLanguage.builtins as string[]
  builtins.forEach((builtin) => {
    suggestions.push({
      label: builtin,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: builtin,
      range,
      detail: 'Python builtin',
    })
  })

  const constants = pythonLanguage.constants as string[]
  constants.forEach((constant) => {
    suggestions.push({
      label: constant,
      kind: monaco.languages.CompletionItemKind.Constant,
      insertText: constant,
      range,
      detail: 'Python constant',
    })
  })

  const exceptions = pythonLanguage.exceptions as string[]
  exceptions.forEach((exception) => {
    suggestions.push({
      label: exception,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: exception,
      range,
      detail: 'Python exception',
    })
  })

  const text = model.getValue()
  const variablePattern = /(?:^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm
  const variables = new Set<string>()
  let match

  while ((match = variablePattern.exec(text)) !== null) {
    const varName = match[1]
    if (
      !keywords.includes(varName) &&
      !builtins.includes(varName) &&
      !constants.includes(varName) &&
      !exceptions.includes(varName)
    ) {
      variables.add(varName)
    }
  }

  const functionPattern = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
  while ((match = functionPattern.exec(text)) !== null) {
    const funcName = match[1]
    if (!keywords.includes(funcName) && !builtins.includes(funcName)) {
      suggestions.push({
        label: funcName,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: funcName,
        range,
        detail: 'User-defined function',
      })
    }
  }

  const classPattern = /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
  while ((match = classPattern.exec(text)) !== null) {
    const className = match[1]
    suggestions.push({
      label: className,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: className,
      range,
      detail: 'User-defined class',
    })
  }

  variables.forEach((varName) => {
    suggestions.push({
      label: varName,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: varName,
      range,
      detail: 'User-defined variable',
    })
  })

  return { suggestions }
}
