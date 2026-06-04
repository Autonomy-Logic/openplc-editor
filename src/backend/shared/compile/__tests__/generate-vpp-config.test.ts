/**
 * Tests for the vpp_config.h emitter.  Each test pins one aspect of
 * the output shape so an unrelated refactor that drifts the
 * convention (path-naming, scalar formatting, brace-initializer
 * style) fails loudly here.
 */

import { generateVppConfigContent } from '../steps/generate-vpp-config'

const HEADER_OPEN = '#ifndef VPP_CONFIG_H\n#define VPP_CONFIG_H\n'
const HEADER_CLOSE = '#endif // VPP_CONFIG_H\n'

describe('generateVppConfigContent', () => {
  it('emits a minimal include-guarded header when vendorScreenData is undefined', () => {
    const out = generateVppConfigContent({ vendorScreenData: undefined })
    expect(out).toContain('#ifndef VPP_CONFIG_H')
    expect(out).toContain('#define VPP_CONFIG_H')
    expect(out).toContain('#endif // VPP_CONFIG_H')
    // No content between the open and close.
    const body = out.slice(out.indexOf(HEADER_OPEN) + HEADER_OPEN.length, out.indexOf(HEADER_CLOSE))
    expect(body.trim()).toBe('')
  })

  it('emits a minimal include-guarded header when vendorScreenData is an empty object', () => {
    const out = generateVppConfigContent({ vendorScreenData: {} })
    expect(out).toContain('#ifndef VPP_CONFIG_H')
    expect(out).toContain('#endif // VPP_CONFIG_H')
  })

  it('emits scalar leaves with VPP_<SCREEN>_<FIELD> naming', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        'modbus-rtu': { baud_rate: 115200, slave_id: 1, enabled: true, port_name: 'COM3' },
      },
    })
    expect(out).toContain('#define VPP_MODBUS_RTU_BAUD_RATE 115200')
    expect(out).toContain('#define VPP_MODBUS_RTU_SLAVE_ID 1')
    expect(out).toContain('#define VPP_MODBUS_RTU_ENABLED 1')
    expect(out).toContain('#define VPP_MODBUS_RTU_PORT_NAME "COM3"')
  })

  it('boolean false emits as 0; boolean true emits as 1', () => {
    const out = generateVppConfigContent({ vendorScreenData: { net: { dhcp: false, https: true } } })
    expect(out).toContain('#define VPP_NET_DHCP 0')
    expect(out).toContain('#define VPP_NET_HTTPS 1')
  })

  it('emits scalar arrays as brace-initializers with a _COUNT companion', () => {
    const out = generateVppConfigContent({
      vendorScreenData: { 'module-config': { pin_modes: [0, 1, 0, 1] } },
    })
    expect(out).toContain('#define VPP_MODULE_CONFIG_PIN_MODES_COUNT 4')
    expect(out).toContain('#define VPP_MODULE_CONFIG_PIN_MODES { 0, 1, 0, 1 }')
  })

  it('emits an empty array as _COUNT 0 with no brace-initializer (avoids invalid C)', () => {
    const out = generateVppConfigContent({ vendorScreenData: { 'module-config': { slots: [] } } })
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_COUNT 0')
    expect(out).not.toContain('#define VPP_MODULE_CONFIG_SLOTS {')
  })

  it('emits arrays of objects as per-index defines', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        'module-config': {
          slots: [{ moduleId: 'opta-builtin', i1_mode: 'bool' }, { moduleId: 'opta-ext-d1608e' }],
        },
      },
    })
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_COUNT 2')
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_0_MODULEID "opta-builtin"')
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_0_I1_MODE "bool"')
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_1_MODULEID "opta-ext-d1608e"')
    // The FOREACH convenience macro lets the driver unroll the per-
    // index defines into a struct-literal array without enumerating
    // indices by hand: `#define VPP_X(i) { ..._##i##_FIELD, ... }`.
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTS_FOREACH(X) X(0) X(1)')
  })

  it('does not emit a FOREACH macro for empty object arrays', () => {
    const out = generateVppConfigContent({
      vendorScreenData: { 'module-config': { entries: [] } },
    })
    expect(out).toContain('#define VPP_MODULE_CONFIG_ENTRIES_COUNT 0')
    expect(out).not.toContain('VPP_MODULE_CONFIG_ENTRIES_FOREACH')
  })

  it('handles nested objects with dotted-path naming', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        'module-config': {
          slotsConfig: {
            '1': { i1_mode: 'analog', i2_mode: 'bool' },
            '2': { i1_mode: 'bool' },
          },
        },
      },
    })
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTSCONFIG_1_I1_MODE "analog"')
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTSCONFIG_1_I2_MODE "bool"')
    expect(out).toContain('#define VPP_MODULE_CONFIG_SLOTSCONFIG_2_I1_MODE "bool"')
  })

  it('sanitizes non-identifier characters in screen keys (hyphens, dots)', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        'modbus.rtu': { baud_rate: 9600 },
        'my-screen': { value: 1 },
      },
    })
    // hyphens and dots both become underscores.
    expect(out).toContain('#define VPP_MODBUS_RTU_BAUD_RATE 9600')
    expect(out).toContain('#define VPP_MY_SCREEN_VALUE 1')
  })

  it('prefixes numeric-leading sanitized identifiers with _ to stay valid C', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        '4g-network': { apn: 'internet' },
      },
    })
    // Resulting macro must not start with a digit.
    expect(out).toContain('#define VPP__4G_NETWORK_APN "internet"')
  })

  it('escapes string values for valid C string literals', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        net: { description: 'line1\nline2\twith "quotes" and \\backslash' },
      },
    })
    expect(out).toContain('#define VPP_NET_DESCRIPTION "line1\\nline2\twith \\"quotes\\" and \\\\backslash"')
  })

  it('skips null and undefined leaves silently', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        net: { dhcp: true, gateway: null, dns: undefined as unknown as string },
      },
    })
    expect(out).toContain('#define VPP_NET_DHCP 1')
    expect(out).not.toContain('GATEWAY')
    expect(out).not.toContain('DNS')
  })

  it('skips NaN and Infinity (non-representable in C preprocessor)', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        net: { good: 42, bad_nan: NaN, bad_inf: Infinity },
      },
    })
    expect(out).toContain('#define VPP_NET_GOOD 42')
    expect(out).not.toContain('BAD_NAN')
    expect(out).not.toContain('BAD_INF')
  })

  it('is deterministic — same input produces the same output bytes', () => {
    const input = {
      vendorScreenData: {
        b_screen: { z: 1, a: 2 },
        a_screen: { c: 3, b: 4 },
      },
    }
    const out1 = generateVppConfigContent(input)
    const out2 = generateVppConfigContent(input)
    expect(out1).toBe(out2)
  })

  it('sorts top-level screen keys for stable output across runs', () => {
    const out = generateVppConfigContent({
      vendorScreenData: {
        'z-screen': { value: 1 },
        'a-screen': { value: 2 },
      },
    })
    const aIdx = out.indexOf('VPP_A_SCREEN_VALUE')
    const zIdx = out.indexOf('VPP_Z_SCREEN_VALUE')
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(zIdx).toBeGreaterThan(aIdx)
  })

  // ---------------------------------------------------------------
  // End-to-end: Arduino Opta-shaped vendor data
  // ---------------------------------------------------------------

  it('end-to-end: serializes an Opta-shaped vendorScreenData faithfully', () => {
    // What the editor would write after the user puts a built-in + one
    // expansion in the backplane configurator and toggles pin modes.
    const out = generateVppConfigContent({
      vendorScreenData: {
        'module-configuration': {
          slots: ['opta-builtin', 'opta-ext-d1608e'],
          slotsConfig: {
            '1': {
              i1_mode: 'bool',
              i2_mode: 'analog',
              i3_mode: 'bool',
              i4_mode: 'bool',
              i5_mode: 'bool',
              i6_mode: 'bool',
              i7_mode: 'bool',
              i8_mode: 'bool',
            },
            '2': {
              i1_mode: 'analog',
            },
          },
        },
        'modbus-rtu': { enabled: true, baud_rate: 115200, slave_id: 1 },
      },
    })

    // The HAL driver can recover:
    expect(out).toContain('#define VPP_MODULE_CONFIGURATION_SLOTS_COUNT 2')
    expect(out).toContain('#define VPP_MODULE_CONFIGURATION_SLOTS { "opta-builtin", "opta-ext-d1608e" }')
    expect(out).toContain('#define VPP_MODULE_CONFIGURATION_SLOTSCONFIG_1_I1_MODE "bool"')
    expect(out).toContain('#define VPP_MODULE_CONFIGURATION_SLOTSCONFIG_1_I2_MODE "analog"')
    expect(out).toContain('#define VPP_MODULE_CONFIGURATION_SLOTSCONFIG_2_I1_MODE "analog"')
    expect(out).toContain('#define VPP_MODBUS_RTU_ENABLED 1')
    expect(out).toContain('#define VPP_MODBUS_RTU_BAUD_RATE 115200')
  })
})
