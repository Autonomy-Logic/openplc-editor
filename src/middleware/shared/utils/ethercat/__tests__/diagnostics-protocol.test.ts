/**
 * Diagnostics-protocol parser tests.  Mirrors the scan-modules-protocol tests so both
 * platforms interpret the runtime's diagnostics reply identically.
 */

import {
  buildDiagnosticsRequestBody,
  parseDiagnosticsHttpResponse,
  parseDiagnosticsResponseBody,
} from '../diagnostics-protocol'

describe('buildDiagnosticsRequestBody', () => {
  test('renames the request fields to snake_case the runtime expects', () => {
    expect(buildDiagnosticsRequestBody({ busName: 'bus_ui', slavePosition: 3 })).toEqual({
      bus_name: 'bus_ui',
      slave_position: 3,
    })
  })
})

describe('parseDiagnosticsResponseBody', () => {
  test('returns the parsed snapshot with modules in slot order', () => {
    const result = parseDiagnosticsResponseBody(
      {
        status: 'success',
        bus_name: 'bus_ui',
        slave_position: 1,
        coupler: { status_word: 0xc0, poll_at_ms: 1000 },
        modules: [
          { slot: 2, status_byte: 0x82 },
          { slot: 1, status_byte: 0x00 },
        ],
      },
      { slavePosition: 1 },
    )
    expect(result).toEqual({
      success: true,
      snapshot: {
        coupler: { statusWord: 0xc0, pollAt: 1000 },
        modules: [
          { slot: 1, statusByte: 0x00 },
          { slot: 2, statusByte: 0x82 },
        ],
      },
    })
  })

  test('drops malformed module entries', () => {
    const result = parseDiagnosticsResponseBody(
      {
        coupler: { status_word: 0, poll_at_ms: 10 },
        modules: [
          { slot: 1, status_byte: 0 },
          { slot: 'bad', status_byte: 0 },
          { status_byte: 0 },
          { slot: 2, status_byte: 'nope' },
        ],
      },
      { slavePosition: 1 },
    )
    expect(result).toEqual({
      success: true,
      snapshot: { coupler: { statusWord: 0, pollAt: 10 }, modules: [{ slot: 1, statusByte: 0 }] },
    })
  })

  test('reports the runtime error when the coupler status is missing', () => {
    expect(parseDiagnosticsResponseBody({ status: 'error', error: 'unsupported' }, { slavePosition: 1 })).toEqual({
      success: false,
      error: 'unsupported',
    })
  })

  test('keeps values EtherDOG could not read as null', () => {
    const result = parseDiagnosticsResponseBody(
      {
        coupler: { status_word: null, poll_at_ms: 5 },
        modules: [
          { slot: 2, status_byte: null },
          { slot: 1, status_byte: 0x81 },
        ],
      },
      { slavePosition: 1 },
    )
    expect(result).toEqual({
      success: true,
      snapshot: {
        coupler: { statusWord: null, pollAt: 5 },
        modules: [
          { slot: 1, statusByte: 0x81 },
          { slot: 2, statusByte: null },
        ],
      },
    })
  })

  test('a status word that is neither a number nor null is refused', () => {
    expect(parseDiagnosticsResponseBody({ coupler: { status_word: '64' }, modules: [] }, { slavePosition: 1 })).toEqual(
      { success: false, error: 'diagnostics response did not include coupler.status_word' },
    )
  })

  test('rejects an empty body', () => {
    expect(parseDiagnosticsResponseBody(null, { slavePosition: 1 })).toEqual({
      success: false,
      error: 'diagnostics response was empty',
    })
  })

  test('falls back to Date.now when poll_at_ms is missing', () => {
    const before = Date.now()
    const result = parseDiagnosticsResponseBody({ coupler: { status_word: 0 }, modules: [] }, { slavePosition: 1 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.snapshot.coupler.pollAt).toBeGreaterThanOrEqual(before)
    }
  })
})

describe('parseDiagnosticsHttpResponse', () => {
  test('non-200 surfaces body.error', () => {
    expect(
      parseDiagnosticsHttpResponse({ status_code: 403, body: { error: 'forbidden' } }, { slavePosition: 1 }),
    ).toEqual({ success: false, error: 'forbidden' })
  })

  test('non-200 falls through message then msg', () => {
    expect(
      parseDiagnosticsHttpResponse(
        { status_code: 401, body: { msg: 'Missing Authorization Header' } },
        { slavePosition: 1 },
      ),
    ).toEqual({ success: false, error: 'Missing Authorization Header' })
  })

  test('non-200 with no error names the status code', () => {
    expect(parseDiagnosticsHttpResponse({ status_code: 503, body: {} }, { slavePosition: 1 })).toEqual({
      success: false,
      error: 'diagnostics returned HTTP 503',
    })
  })

  test('200 delegates to the body parser', () => {
    const r = parseDiagnosticsHttpResponse(
      {
        status_code: 200,
        body: { coupler: { status_word: 0x40, poll_at_ms: 42 }, modules: [{ slot: 1, status_byte: 0 }] },
      },
      { slavePosition: 1 },
    )
    expect(r).toEqual({
      success: true,
      snapshot: {
        coupler: { statusWord: 0x40, pollAt: 42 },
        modules: [{ slot: 1, statusByte: 0 }],
      },
    })
  })
})
