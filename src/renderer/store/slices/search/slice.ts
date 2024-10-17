import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { SearchSlice } from './type'

const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (setState) => ({
  searchQuery: '',
  searchResults: [],
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
    removeSearchResult: (indexToRemove: number) =>
      setState((state) => ({
        searchResults: state.searchResults.filter((_, index) => index !== indexToRemove),
      })),
  },
})

export { createSearchSlice }
