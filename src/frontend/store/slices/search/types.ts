import type { ProjectSearchMatch } from '../../../utils/PLC/project-search'

export type { ProjectSearchMatch }

/** One search, kept with every occurrence it found: the count is the list's length. */
export type ProjectSearchEntry = {
  searchID: string
  searchQuery: string
  projectName: string
  matches: ProjectSearchMatch[]
  searchCounts: number
}

export type SearchState = {
  searchQuery: string
  searchResults: ProjectSearchEntry[]
  sensitiveCase: boolean
  regularExpression: boolean
  searchNodePosition: { x: number; y: number }
}

export type SearchActions = {
  setSearchQuery: (query: string) => void
  setSearchResults: (project: ProjectSearchEntry) => void
  setSensitiveCase: (sensitiveCase: boolean) => void
  setRegularExpression: (regularExpression: boolean) => void
  removeSearchResult: (itemID: string) => void
  setSearchNodePosition: (position: { x: number; y: number }) => void
  clearSearch: () => void
}

export type SearchSlice = SearchState & { searchActions: SearchActions }
