import { fireEvent, render, screen } from '@testing-library/react'

import type { ProjectSearchMatch } from '../../../../../store/slices/search'
import { createStoreWrapper, createTestStore } from '../../../../../store/testing'
import { Search } from '../index'

/** A row is a place in the project, not a label: clicking one has to land the editor on it. */
const bodyMatch = (line: number, preview: string): ProjectSearchMatch => ({
  id: `body-${line}`,
  container: { kind: 'pou', name: 'main', pouType: 'program', language: 'st' },
  field: 'body',
  line,
  column: 4,
  preview,
  previewColumn: 4,
  length: 5,
})

const entry = (matches: ProjectSearchMatch[]) => ({
  searchID: 'search-1',
  searchQuery: 'Motor',
  projectName: 'Plant',
  matches,
  searchCounts: matches.length,
})

const renderPanel = (matches: ProjectSearchMatch[]) => {
  const store = createTestStore()
  render(<Search items={[entry(matches)]} />, { wrapper: createStoreWrapper(store) })
  return store
}

describe('Search results panel', () => {
  it('lists one row per occurrence, and the count equals the rows', () => {
    renderPanel([bodyMatch(3, 'Motor := TRUE;'), bodyMatch(5, 'IF Motor THEN')])

    expect(screen.getByText(/2 matches/)).toBeTruthy()
    expect(screen.getByText(/Line 3:/)).toBeTruthy()
    expect(screen.getByText(/Line 5:/)).toBeTruthy()
  })

  it('opens the POU on the occurrence that was clicked', () => {
    const store = renderPanel([bodyMatch(5, 'IF Motor THEN')])

    fireEvent.click(screen.getByText(/Line 5:/))

    const editor = store.getState().editors.find((model) => model.meta.name === 'main')
    expect(store.getState().tabs.map((tab) => tab.name)).toContain('main')
    expect(editor?.cursorPosition).toEqual({ lineNumber: 5, column: 4, offset: 0, target: 'body' })
  })

  it('asks the graphical editor to select the node an occurrence sits on', () => {
    const store = renderPanel([
      {
        id: 'node-1',
        container: { kind: 'pou', name: 'ladderPou', pouType: 'program', language: 'ld' },
        field: 'body',
        nodeId: 'contact-0',
        rungId: 'rung-1',
        preview: 'Motor',
        previewColumn: 1,
        length: 5,
      },
    ])

    fireEvent.click(screen.getByText('Motor', { selector: 'span' }))

    const editor = store.getState().editors.find((model) => model.meta.name === 'ladderPou')
    expect(editor?.graphicalFocus).toEqual({ nodeId: 'contact-0', rungId: 'rung-1' })
  })
})
