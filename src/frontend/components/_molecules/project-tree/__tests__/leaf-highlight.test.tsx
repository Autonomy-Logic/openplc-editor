import { render, screen } from '@testing-library/react'

import { ProjectTreeExpandableLeaf, ProjectTreeLeaf } from '../index'

// https://github.com/Autonomy-Logic/openplc-editor/issues/640
// The explorer used to pass a search-highlight HTML string as the leaf `label`,
// which ProjectTreeLeaf renders as plain text — after any project search, the
// matching POU's name appeared in the tree as literal markup
// (`<span class="bg-brand-light...`). The label must stay the element's real
// name; highlighting is applied safely inside the leaf via `highlightQuery`.
describe('ProjectTreeLeaf search highlight', () => {
  it('renders the plain name and applies a safe highlight when highlightQuery matches', () => {
    const { container } = render(
      <ProjectTreeLeaf leafLang='fbd' leafType='function-block' label='Taktgeber' highlightQuery='Takt' />,
    )

    expect(screen.getByText(/Takt/).textContent).not.toContain('<span')
    expect(container.textContent).toBe('Taktgeber')

    const highlight = container.querySelector('span.bg-brand-light')
    expect(highlight).not.toBeNull()
    expect(highlight?.textContent).toBe('Takt')
  })

  it('renders the plain name without highlight markup when there is no query', () => {
    const { container } = render(<ProjectTreeLeaf leafLang='fbd' leafType='function-block' label='Taktgeber' />)

    expect(container.textContent).toBe('Taktgeber')
    expect(container.querySelector('span.bg-brand-light')).toBeNull()
  })

  it('never shows literal markup for a non-matching query', () => {
    const { container } = render(
      <ProjectTreeLeaf leafLang='fbd' leafType='function-block' label='Taktgeber' highlightQuery='zzz' />,
    )

    expect(container.textContent).toBe('Taktgeber')
    expect(container.textContent).not.toContain('<span')
  })

  it('applies the same safe highlighting on expandable leaves', () => {
    const { container } = render(
      <ProjectTreeExpandableLeaf leafLang='remoteDevice' leafType='remote-device' label='EtherBus' highlightQuery='Ether' />,
    )

    expect(container.textContent).toContain('EtherBus')
    expect(container.textContent).not.toContain('<span')
    const highlight = container.querySelector('span.bg-brand-light')
    expect(highlight?.textContent).toBe('Ether')
  })
})
