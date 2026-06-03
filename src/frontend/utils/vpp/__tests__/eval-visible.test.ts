/**
 * Tests for the VPP screen conditional-visibility evaluator.
 *
 * Drives the show/hide behaviour of declarative `form` and
 * `module-slots` fields. Failures here mean a screen author's
 * `visible` clause stops matching the form values — fields that
 * should hide stay visible (or vice-versa).
 */

import { evalVisible, type VisibleCondition } from '../eval-visible'

describe('evalVisible', () => {
  it('treats a missing clause as always visible', () => {
    expect(evalVisible(undefined, {})).toBe(true)
  })

  describe('fields. prefix handling', () => {
    it('strips the canonical fields. prefix before lookup', () => {
      const clause: VisibleCondition = { condition: 'fields.enabled', operator: 'equals', value: true }
      expect(evalVisible(clause, { enabled: true })).toBe(true)
      expect(evalVisible(clause, { enabled: false })).toBe(false)
    })

    it('honors a bare (un-prefixed) reference', () => {
      const clause: VisibleCondition = { condition: 'enabled', operator: 'equals', value: true }
      expect(evalVisible(clause, { enabled: true })).toBe(true)
    })
  })

  describe('leaf operators', () => {
    it('equals', () => {
      const clause: VisibleCondition = { condition: 'mode', operator: 'equals', value: 'advanced' }
      expect(evalVisible(clause, { mode: 'advanced' })).toBe(true)
      expect(evalVisible(clause, { mode: 'simple' })).toBe(false)
    })

    it('not-equals', () => {
      const clause: VisibleCondition = { condition: 'mode', operator: 'not-equals', value: 'simple' }
      expect(evalVisible(clause, { mode: 'advanced' })).toBe(true)
      expect(evalVisible(clause, { mode: 'simple' })).toBe(false)
    })

    it('in', () => {
      const clause: VisibleCondition = { condition: 'protocol', operator: 'in', value: ['SPI', 'I2C'] }
      expect(evalVisible(clause, { protocol: 'SPI' })).toBe(true)
      expect(evalVisible(clause, { protocol: 'UART' })).toBe(false)
    })

    it('in returns false when the clause value is not an array', () => {
      const clause: VisibleCondition = { condition: 'protocol', operator: 'in', value: 'SPI' }
      expect(evalVisible(clause, { protocol: 'SPI' })).toBe(false)
    })

    it('exists', () => {
      const clause: VisibleCondition = { condition: 'name', operator: 'exists' }
      expect(evalVisible(clause, { name: 'foo' })).toBe(true)
      expect(evalVisible(clause, { name: '' })).toBe(false)
      expect(evalVisible(clause, {})).toBe(false)
    })

    it('not-exists', () => {
      const clause: VisibleCondition = { condition: 'name', operator: 'not-exists' }
      expect(evalVisible(clause, {})).toBe(true)
      expect(evalVisible(clause, { name: '' })).toBe(true)
      expect(evalVisible(clause, { name: 'foo' })).toBe(false)
    })

    it('greater-than', () => {
      const clause: VisibleCondition = { condition: 'channels', operator: 'greater-than', value: 0 }
      expect(evalVisible(clause, { channels: 4 })).toBe(true)
      expect(evalVisible(clause, { channels: 0 })).toBe(false)
      // Non-numeric operands never satisfy a numeric comparison.
      expect(evalVisible(clause, { channels: 'four' })).toBe(false)
    })

    it('less-than', () => {
      const clause: VisibleCondition = { condition: 'retries', operator: 'less-than', value: 10 }
      expect(evalVisible(clause, { retries: 3 })).toBe(true)
      expect(evalVisible(clause, { retries: 10 })).toBe(false)
      expect(evalVisible(clause, { retries: 'three' })).toBe(false)
    })

    it('greater-than returns false when the clause value is not numeric', () => {
      const clause: VisibleCondition = { condition: 'channels', operator: 'greater-than', value: 'lots' }
      expect(evalVisible(clause, { channels: 4 })).toBe(false)
    })

    it('shows the field for an unknown operator (forgiving default)', () => {
      const clause: VisibleCondition = { condition: 'x', operator: 'weird-op', value: 1 }
      expect(evalVisible(clause, { x: 1 })).toBe(true)
    })
  })

  describe('composite operators', () => {
    const enabled: VisibleCondition = { condition: 'fields.enabled', operator: 'equals', value: true }
    const dhcpOff: VisibleCondition = { condition: 'fields.enable_dhcp', operator: 'equals', value: false }

    it('and requires every condition', () => {
      const clause: VisibleCondition = { operator: 'and', conditions: [enabled, dhcpOff] }
      expect(evalVisible(clause, { enabled: true, enable_dhcp: false })).toBe(true)
      expect(evalVisible(clause, { enabled: true, enable_dhcp: true })).toBe(false)
      expect(evalVisible(clause, { enabled: false, enable_dhcp: false })).toBe(false)
    })

    it('or requires at least one condition', () => {
      const clause: VisibleCondition = { operator: 'or', conditions: [enabled, dhcpOff] }
      expect(evalVisible(clause, { enabled: false, enable_dhcp: false })).toBe(true)
      expect(evalVisible(clause, { enabled: true, enable_dhcp: true })).toBe(true)
      expect(evalVisible(clause, { enabled: false, enable_dhcp: true })).toBe(false)
    })

    it('nests composites', () => {
      const clause: VisibleCondition = {
        operator: 'and',
        conditions: [enabled, { operator: 'or', conditions: [dhcpOff] }],
      }
      expect(evalVisible(clause, { enabled: true, enable_dhcp: false })).toBe(true)
      expect(evalVisible(clause, { enabled: true, enable_dhcp: true })).toBe(false)
    })
  })
})
