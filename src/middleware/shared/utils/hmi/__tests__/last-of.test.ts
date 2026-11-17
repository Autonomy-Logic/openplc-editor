import { lastOf } from '../last-of'

describe('lastOf', () => {
  it('returns the last item, or undefined for an empty list', () => {
    expect(lastOf([1, 2, 3])).toBe(3)
    expect(lastOf([])).toBeUndefined()
  })
})
