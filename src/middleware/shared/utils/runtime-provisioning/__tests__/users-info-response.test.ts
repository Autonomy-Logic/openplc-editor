import { usersInfoFromFacts } from '../users-info-response'

describe('usersInfoFromFacts', () => {
  describe('a runtime that answered', () => {
    it('reads 404 as the first-user bootstrap state, with no error', () => {
      expect(
        usersInfoFromFacts({ kind: 'response', statusCode: 404, body: '', runtimeVersion: '4.1.0' }),
      ).toStrictEqual({ hasUsers: false, runtimeVersion: '4.1.0' })
    })

    it('keeps reading a 404 with an HTML body as the bootstrap state', () => {
      expect(
        usersInfoFromFacts({ kind: 'response', statusCode: 404, body: '<html><body>Not Found</body></html>' }),
      ).toStrictEqual({ hasUsers: false })
    })

    it('reads 200 as a runtime with users', () => {
      expect(
        usersInfoFromFacts({ kind: 'response', statusCode: 200, body: '{"has_users":true}', runtimeVersion: '4.1.0' }),
      ).toStrictEqual({ hasUsers: true, runtimeVersion: '4.1.0' })
    })

    it('does not parse the body of a 200', () => {
      expect(usersInfoFromFacts({ kind: 'response', statusCode: 200, body: 'not json at all' })).toStrictEqual({
        hasUsers: true,
      })
    })

    it.each([
      [500, 'Internal Server Error'],
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [302, 'Found'],
    ])('reports status %p with its body as the error and no failure kind', (statusCode, body) => {
      expect(usersInfoFromFacts({ kind: 'response', statusCode, body, runtimeVersion: '4.1.0' })).toStrictEqual({
        hasUsers: false,
        error: body,
        runtimeVersion: '4.1.0',
      })
    })

    it.each([500, 401, 403])('reports status %p with an empty body as an unexpected status', (statusCode) => {
      expect(usersInfoFromFacts({ kind: 'response', statusCode, body: '' })).toStrictEqual({
        hasUsers: false,
        error: `Unexpected status: ${statusCode}`,
      })
    })
  })

  describe('a transport error', () => {
    it('passes a timeout message through unchanged and marks it as a timeout', () => {
      expect(usersInfoFromFacts({ kind: 'error', message: 'Connection timeout', timedOut: true })).toStrictEqual({
        hasUsers: false,
        error: 'Connection timeout',
        failure: 'timeout',
      })
    })

    it.each([
      ['ECONNREFUSED', 'connect ECONNREFUSED 192.168.1.50:8443', 'refused'],
      ['ETIMEDOUT', 'connect ETIMEDOUT 192.168.1.50:8443', 'timeout'],
      ['EHOSTUNREACH', 'connect EHOSTUNREACH 192.168.1.50:8443', 'host-unreachable'],
      ['ENETUNREACH', 'connect ENETUNREACH 192.168.1.50:8443', 'network-unreachable'],
      ['ECONNRESET', 'socket hang up', 'other'],
      ['EPROTO', 'write EPROTO SSL routines:ssl3_get_record:wrong version number', 'other'],
      ['ERR_SSL_WRONG_VERSION_NUMBER', 'wrong version number', 'other'],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND plc-missing.local', 'other'],
    ])('keeps the message of %s and classifies it', (code, message, failure) => {
      expect(usersInfoFromFacts({ kind: 'error', code, message, timedOut: false })).toStrictEqual({
        hasUsers: false,
        error: message,
        failure,
      })
    })

    it('classifies an error without a code as other', () => {
      expect(usersInfoFromFacts({ kind: 'error', message: 'Something broke', timedOut: false })).toStrictEqual({
        hasUsers: false,
        error: 'Something broke',
        failure: 'other',
      })
    })
  })
})
