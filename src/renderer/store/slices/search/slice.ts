import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { SearchSlice } from './type'

const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (setState) => ({
  searchQuery: '',
  searchResults: [],
  sensitiveCase: false,
  regularExpression: false,
  searchNodePosition: { x: 0, y: 0 },

  searchActions: {
    setSearchQuery: (searchQuery) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchQuery = searchQuery
        }),
      )
    },
    setSearchResults: (newSearchResult) => {
      setState(
        produce((state: SearchSlice) => {
          const index = state.searchResults.findIndex((result) => result.searchQuery === newSearchResult.searchQuery)
          if (index !== -1) {
            state.searchResults.splice(index, 1)
          }
          state.searchResults.push(newSearchResult)
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
    setRegularExpression: (regularExpression) => {
      setState(
        produce((state: SearchSlice) => {
          state.regularExpression = regularExpression
        }),
      )
    },
    removeSearchResult: (itemID: string) =>
      setState((state) => ({
        searchResults: state.searchResults.filter((item) => item.searchID !== itemID),
      })),

    setSearchNodePosition: (searchNodePosition: { x: number; y: number }) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchNodePosition = searchNodePosition
        }),
      )
    },
  },
})

export { createSearchSlice }
