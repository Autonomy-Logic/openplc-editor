import { edgeTriggerInstanceName, edgeTriggerTypeForVariant } from '../edge-trigger-instance'

describe('edgeTriggerTypeForVariant', () => {
  it('maps only the edge variants', () => {
    expect(edgeTriggerTypeForVariant('risingEdge')).toBe('R_TRIG')
    expect(edgeTriggerTypeForVariant('fallingEdge')).toBe('F_TRIG')
    expect(edgeTriggerTypeForVariant('default')).toBeNull()
    expect(edgeTriggerTypeForVariant('negated')).toBeNull()
  })
})

describe('edgeTriggerInstanceName', () => {
  it('derives the name from an integer numericId, as a number or a canonical string', () => {
    expect(edgeTriggerInstanceName('R_TRIG', 2645420)).toBe('_TMP_R_TRIG2645420')
    expect(edgeTriggerInstanceName('F_TRIG', '42')).toBe('_TMP_F_TRIG42')
    expect(edgeTriggerInstanceName('R_TRIG', '0')).toBe('_TMP_R_TRIG0')
  })

  it('refuses anything that is not a canonical non-negative integer', () => {
    for (const bad of [undefined, null, '', '042', '4.2', '-1', 'CONTACT_uuid', 1.5, -3, Number.NaN]) {
      expect(edgeTriggerInstanceName('R_TRIG', bad)).toBeNull()
    }
  })
})
