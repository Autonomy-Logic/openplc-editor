export type VariableReferenceLocation = {
  pouName: string
  editorType: 'ladder' | 'fbd' | 'st' | 'il' | 'python' | 'cpp'
  nodeId?: string
  rungId?: string
  elementType?: 'contact' | 'coil' | 'block-instance' | 'block-connection' | 'variable'
  connectionIndex?: number
  lineNumber?: number
  columnStart?: number
  columnEnd?: number
}

export type ReferenceImpactAnalysis = {
  totalReferences: number
  byPou: Map<string, number>
  byEditorType: Map<string, number>
  references: VariableReferenceLocation[]
}
