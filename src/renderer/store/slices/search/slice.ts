import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { SearchSlice } from './type'

const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (setState) => ({
  searchQuery: '',
  searchResults: [],
  sensitiveCase: false,
  searchActions: {
    setSearchQuery: (searchQuery) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchQuery = searchQuery
        }),
      )
    },
    setSearchResults: (searchResults) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchResults.push(searchResults)
        }),
      )
    },
    setSensitiveCase: (sensitiveCase) => {
      setState(
        produce((state: SearchSlice) => {
          state.sensitiveCase = sensitiveCase
        }),
      )
    },
    removeSearchResult: (indexToRemove: number) =>
      setState((state) => ({
        searchResults: state.searchResults.filter((_, index) => index !== indexToRemove),
      })),
  },
})

export { createSearchSlice }