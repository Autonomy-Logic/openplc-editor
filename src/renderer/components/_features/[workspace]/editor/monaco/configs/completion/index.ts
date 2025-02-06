import { PLCVariable } from '@root/types/PLC'
import * as monaco from 'monaco-editor'

export const tableVariablesCompletion = ({ range, variables }: { range: monaco.IRange; variables: PLCVariable[] }) => {
  const suggestions = variables.map((variable) => {
    return {
      label: variable.name,
      insertText: variable.name,
      documentation: variable.documentation,
      kind: monaco.languages.CompletionItemKind.Variable,
      range,
    }
  })

  return {
    suggestions,
  }
}
