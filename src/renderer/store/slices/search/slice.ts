import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { SearchSlice } from './type'

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (setState) => ({
  searchQuery: '',
  searchResults: [],
  sensitiveCase: false,
  regularExpression: false,

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

    extractSearchQuery: (body: string, searchQuery: string) => {
      const escapedSearchQuery = escapeRegExp(searchQuery)
      const regex = new RegExp(`(${escapedSearchQuery})`, 'gi')
      const match = body.match(regex)
      if (match) {
        return body.replace(
          regex,
          (matched) => `<span class='text-brand-medium dark:text-brand-light'>${matched}</span>`,
        )
      }
      return body
    },
  },
})

export { createSearchSlice }
