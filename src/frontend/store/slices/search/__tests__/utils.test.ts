import { describe, expect, it } from '@jest/globals'

import { escapeRegExp, extractSearchQuery, highlightOccurrence } from '../utils'

const parse = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('escapeRegExp', () => {
  it('escapes every regular expression metacharacter', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    )
  })

  it('leaves a plain term untouched', () => {
    expect(escapeRegExp('counter')).toBe('counter')
  })
})

describe('extractSearchQuery', () => {
  it('wraps the match in a highlight span and keeps the surrounding text', () => {
    const host = parse(extractSearchQuery('the counter value', 'counter'))

    expect(host.textContent).toBe('the counter value')
    expect(host.querySelectorAll('span')).toHaveLength(1)
    expect(host.querySelector('span')?.textContent).toBe('counter')
    expect(host.querySelector('span')?.className).toContain('bg-brand-light')
  })

  it('matches regardless of case and highlights every occurrence', () => {
    const host = parse(extractSearchQuery('Counter and counter', 'COUNTER'))

    expect(host.querySelectorAll('span')).toHaveLength(2)
    expect(host.textContent).toBe('Counter and counter')
  })

  it('treats a term with metacharacters as literal text', () => {
    const host = parse(extractSearchQuery('value a.b and axb', 'a.b'))

    expect(host.querySelectorAll('span')).toHaveLength(1)
    expect(host.querySelector('span')?.textContent).toBe('a.b')
  })

  it('returns the body unchanged when nothing matches', () => {
    expect(extractSearchQuery('the counter value', 'missing')).toBe('the counter value')
  })

  it('strips a script element carried by the body', () => {
    const host = parse(extractSearchQuery('counter<script>globalThis.owned = true</script>', 'counter'))

    expect(host.querySelector('script')).toBeNull()
    expect(host.innerHTML).not.toContain('globalThis.owned')
  })

  it('strips an event handler attribute carried by the body', () => {
    const host = parse(extractSearchQuery('<img src="x" onerror="globalThis.owned = true">counter', 'counter'))

    expect(host.querySelector('img')?.getAttribute('onerror')).toBeNull()
    expect(host.innerHTML).not.toContain('onerror')
  })

  it('strips a javascript: anchor carried by the body', () => {
    const host = parse(extractSearchQuery('<a href="javascript:globalThis.owned = true">counter</a>', 'counter'))

    expect(host.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:')
    expect(host.textContent).toBe('counter')
  })
})

describe('highlightOccurrence', () => {
  it('highlights only the occurrence at the given column', () => {
    const host = parse(highlightOccurrence({ preview: 'var counter := counter + 1', previewColumn: 5, length: 7 }))

    expect(host.querySelectorAll('span')).toHaveLength(1)
    expect(host.querySelector('span')?.textContent).toBe('counter')
    expect(host.textContent).toBe('var counter := counter + 1')
  })

  it('escapes markup in the preview instead of rendering it', () => {
    const host = parse(highlightOccurrence({ preview: '<b>counter</b>', previewColumn: 4, length: 7 }))

    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toBe('<b>counter</b>')
  })

  it('escapes markup inside the highlighted slice itself', () => {
    const host = parse(highlightOccurrence({ preview: 'a <img src=x> b', previewColumn: 3, length: 11 }))

    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('a <img src=x> b')
  })

  it('clamps a column before the start of the line', () => {
    const host = parse(highlightOccurrence({ preview: 'counter', previewColumn: 0, length: 7 }))

    expect(host.querySelector('span')?.textContent).toBe('counter')
  })
})
