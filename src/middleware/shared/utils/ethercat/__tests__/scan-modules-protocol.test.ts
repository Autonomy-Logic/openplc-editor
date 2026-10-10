import {
  buildScanModulesRequestBody,
  canonicaliseIdent,
  parseScanModulesHttpResponse,
  parseScanModulesResponseBody,
} from '../scan-modules-protocol'

describe('scan-modules-protocol', () => {
  describe('canonicaliseIdent', () => {
    it('zero-pads short hex to 32 bits in lower case', () => {
      expect(canonicaliseIdent('0x1A0F')).toBe('0x00001a0f')
      expect(canonicaliseIdent('0x1a10')).toBe('0x00001a10')
    })
    it('normalises an already-32-bit ident to lower case', () => {
      expect(canonicaliseIdent('0x00001A0F')).toBe('0x00001a0f')
    })
    it('keeps a longer-than-32-bit ident untruncated', () => {
      expect(canonicaliseIdent('0x100001a0f')).toBe('0x100001a0f')
    })
    it('leaves non-hex strings untouched (callers detect empty slots)', () => {
      expect(canonicaliseIdent('')).toBe('')
      expect(canonicaliseIdent('garbage')).toBe('garbage')
    })
  })

  describe('buildScanModulesRequestBody', () => {
    it('renames the request fields to snake_case the runtime expects', () => {
      expect(buildScanModulesRequestBody({ busName: 'bus_ui', slavePosition: 3 })).toEqual({
        bus_name: 'bus_ui',
        slave_position: 3,
      })
    })
  })

  describe('parseScanModulesResponseBody', () => {
    it('returns the modules the runtime reported, canonicalised', () => {
      const result = parseScanModulesResponseBody(
        {
          status: 'success',
          bus_name: 'bus_ui',
          slave_position: 1,
          modules: [
            { slot: 1, ident: '0x1A0F' },
            { slot: 2, ident: '0x00001A10' },
          ],
        },
        { slavePosition: 7 },
      )
      expect(result).toEqual({
        success: true,
        scan: {
          slavePosition: 1,
          modules: [
            { slot: 1, ident: '0x00001a0f' },
            { slot: 2, ident: '0x00001a10' },
          ],
        },
      })
    })

    it('falls back to the requested slavePosition when the runtime omits it', () => {
      const result = parseScanModulesResponseBody({ modules: [] }, { slavePosition: 4 })
      expect(result).toEqual({ success: true, scan: { slavePosition: 4, modules: [] } })
    })

    it('drops module entries missing a numeric slot or ident string', () => {
      const result = parseScanModulesResponseBody(
        {
          slave_position: 1,
          modules: [
            { slot: 1, ident: '0x1a0f' },
            { slot: 'bad', ident: '0x1a10' },
            { slot: 2 },
            { ident: '0x9999' },
            { slot: 3, ident: '0xdead' },
          ],
        },
        { slavePosition: 1 },
      )
      expect(result).toEqual({
        success: true,
        scan: {
          slavePosition: 1,
          modules: [
            { slot: 1, ident: '0x00001a0f' },
            { slot: 3, ident: '0x0000dead' },
          ],
        },
      })
    })

    it('reports the runtime-provided error when the body carries no modules list', () => {
      const result = parseScanModulesResponseBody(
        { status: 'error', error: 'slave is not modular' },
        { slavePosition: 1 },
      )
      expect(result).toEqual({ success: false, error: 'slave is not modular' })
    })

    it('rejects an empty body with a generic reason', () => {
      expect(parseScanModulesResponseBody(null, { slavePosition: 1 })).toEqual({
        success: false,
        error: 'scan-modules response was empty',
      })
    })
  })

  describe('parseScanModulesHttpResponse', () => {
    it('surfaces non-200 with the runtime error field when present', () => {
      const r = parseScanModulesHttpResponse({ status_code: 403, body: { error: 'forbidden' } }, { slavePosition: 1 })
      expect(r).toEqual({ success: false, error: 'forbidden' })
    })

    it('falls back through message then msg for non-200 bodies', () => {
      const message = parseScanModulesHttpResponse(
        { status_code: 500, body: { message: 'boom' } },
        { slavePosition: 1 },
      )
      expect(message).toEqual({ success: false, error: 'boom' })

      const msg = parseScanModulesHttpResponse(
        { status_code: 401, body: { msg: 'Missing Authorization Header' } },
        { slavePosition: 1 },
      )
      expect(msg).toEqual({ success: false, error: 'Missing Authorization Header' })
    })

    it('reports the status code when the error body is empty', () => {
      const r = parseScanModulesHttpResponse({ status_code: 503, body: {} }, { slavePosition: 1 })
      expect(r).toEqual({ success: false, error: 'scan-modules returned HTTP 503' })
    })

    it('delegates to the body parser on 200', () => {
      const r = parseScanModulesHttpResponse(
        { status_code: 200, body: { slave_position: 2, modules: [{ slot: 1, ident: '0xabcd' }] } },
        { slavePosition: 2 },
      )
      expect(r).toEqual({
        success: true,
        scan: { slavePosition: 2, modules: [{ slot: 1, ident: '0x0000abcd' }] },
      })
    })
  })
})
