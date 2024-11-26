import DOMPurify from 'dompurify'
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

    setSearchNodePosition: (searchNodePosition) => {
      setState(
        produce((state: SearchSlice) => {
          state.searchNodePosition = searchNodePosition
        }),
      )
    },

    extractSearchQuery: (body: string, searchQuery: string) => {
      const escapedSearchQuery = escapeRegExp(searchQuery)
      const regex = new RegExp(`(${escapedSearchQuery})`, 'gi')
      const match = body.match(regex)
      if (match) {
        const highlightedHTML = body.replace(
          regex,
          (matched) => `<span class='text-brand-medium dark:text-brand-light'>${matched}</span>`,
        )

        return DOMPurify.sanitize(highlightedHTML)
      }

      return body
    },
  },
})

export { createSearchSlice }
