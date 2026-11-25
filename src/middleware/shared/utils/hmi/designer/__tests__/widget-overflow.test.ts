import { widgetOverflow } from '../widget-overflow'

describe('widgetOverflow', () => {
  const box = { x: 12, y: 12, width: 45, height: 200 }

  it('says on which sides and how far a drawing reaches past the box, within a 1 lu tolerance', () => {
    expect(widgetOverflow({ x: 2, y: 12.5, width: 75, height: 200 }, box)).toBe('10 lu to the left, 20 lu to the right')
    expect(widgetOverflow({ x: 12, y: -8, width: 45, height: 260 }, box)).toBe('20 lu above, 40 lu below')
  })

  it('says nothing for a drawing inside the box, at its edges or for no drawing', () => {
    expect(widgetOverflow({ x: 11.5, y: 12, width: 46, height: 200.5 }, box)).toBeNull()
    expect(widgetOverflow(null, box)).toBeNull()
  })
})
