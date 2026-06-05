export type Project = {
  searchQuery: string
  projectName: string
  functions: {
    pous: Record<
      'program' | 'function' | 'function-block',
      Array<{
        name: string
        language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st' | 'python' | 'cpp'
        pouType: 'program' | 'function' | 'function-block'
        body: string
        variable: string | null
      }>
    >
    dataTypes: Array<{
      name: string
      type: 'array' | 'structure' | 'enumerated'
    }>
    resource: {
      globalVariable: string
      task: string
      instance: string
    }
  }
  searchCounts?: number
  searchID: string
}

export type SearchState = {
  searchQuery: string
  searchResults: Project[]
  sensitiveCase: boolean
  regularExpression: boolean
  searchNodePosition: { x: number; y: number }
}

export type SearchActions = {
  setSearchQuery: (query: string) => void
  setSearchResults: (project: Project) => void
  setSensitiveCase: (sensitiveCase: boolean) => void
  setRegularExpression: (regularExpression: boolean) => void
  removeSearchResult: (itemID: string) => void
  setSearchNodePosition: (position: { x: number; y: number }) => void
  clearSearch: () => void
}

export type SearchSlice = SearchState & { searchActions: SearchActions }
