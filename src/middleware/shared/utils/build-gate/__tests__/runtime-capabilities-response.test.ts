import { capabilitiesFromResponse } from '../runtime-capabilities-response'

describe('capabilitiesFromResponse', () => {
  test('a 200 answer gives its string features and version', () => {
    expect(
      capabilitiesFromResponse({
        statusCode: 200,
        body: {
          available: true,
          features: ['ethercat.dynamic_alloc', 7, 'ethercat.sdo_byte_string'],
          version: '1.0.0',
        },
      }),
    ).toEqual({ features: ['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'], runtimeVersion: '1.0.0' })
  })

  test('a 200 answer without a features array advertises none', () => {
    expect(capabilitiesFromResponse({ statusCode: 200, body: { available: true } })).toEqual({ features: [] })
  })

  test('EtherDOG not running leaves the features unknown, with the runtime message', () => {
    expect(
      capabilitiesFromResponse({
        statusCode: 200,
        body: { available: false, features: [], version: null, message: 'not installed' },
      }),
    ).toEqual({ features: null, error: 'EtherDOG is not running on the target (not installed)' })
  })

  test('a runtime without the endpoint (404) advertises no features', () => {
    expect(capabilitiesFromResponse({ statusCode: 404, error: 'Not Found' })).toEqual({ features: [] })
  })

  test('other failures leave the features unknown', () => {
    expect(capabilitiesFromResponse({ statusCode: 500, error: 'boom' })).toEqual({ features: null, error: 'boom' })
    expect(capabilitiesFromResponse({ statusCode: 502, error: '' })).toEqual({ features: null, error: 'HTTP 502' })
    expect(capabilitiesFromResponse({ statusCode: undefined, error: 'ECONNREFUSED' })).toEqual({
      features: null,
      error: 'ECONNREFUSED',
    })
    expect(capabilitiesFromResponse({ statusCode: undefined })).toEqual({
      features: null,
      error: 'no answer from the runtime',
    })
  })

  test('a 200 answer that is not an object leaves the features unknown', () => {
    expect(capabilitiesFromResponse({ statusCode: 200, body: ['x'] }).features).toBeNull()
    expect(capabilitiesFromResponse({ statusCode: 200, body: null }).features).toBeNull()
  })
})
