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
    setRegularExpression: (regularExpression) => {
      setState(
        produce((state: SearchSlice) => {
          state.regularExpression = regularExpression
        }),
      )
    },
    removeSearchResult: (indexToRemove: number) =>
      setState((state) => ({
        searchResults: state.searchResults.filter((_, index) => index !== indexToRemove),
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
