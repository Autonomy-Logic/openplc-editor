/**
 * The runtime refuses an upload with HTTP 200 and the reason in `UploadFileFail`.
 * Driven through a mocked `https` so the real upload path decides the outcome.
 */

import { EventEmitter } from 'events'

const requestMock = jest.fn()
jest.mock('https', () => ({ request: (...args: unknown[]) => requestMock(...args) }))

import { deployRuntimeProgram } from '@root/backend/shared/library/deploy-runtime-program'

import { readUploadRefusal, RuntimeApiClient } from '../runtime-api-client'

/** Answer every request with HTTP `statusCode` and `body`. */
function respondWith(body: string, statusCode = 200) {
  requestMock.mockImplementation((_options: unknown, handler: (res: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: jest.fn(),
      destroy: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    })
    const res = Object.assign(new EventEmitter(), { statusCode, headers: {} })
    setImmediate(() => {
      handler(res)
      res.emit('data', Buffer.from(body))
      res.emit('end')
    })
    return req
  })
}

function signedInClient(): RuntimeApiClient {
  const client = new RuntimeApiClient()
  client.setAddress('192.168.1.50')
  client.tokens.setSession('token', { username: 'user', password: 'secret' })
  return client
}

function upload(client: RuntimeApiClient, onUploadAccepted: (body: string) => void) {
  return client.makeRuntimeApiUpload({
    ipAddress: '192.168.1.50',
    fileBuffer: Buffer.from('zip'),
    filename: 'program.zip',
    contentType: 'application/zip',
    cleanBuild: false,
    onUploadAccepted,
  })
}

const REFUSAL =
  'This program was built with an Editor that writes the old EtherCAT configuration (conf/ethercat.json), which runtime 4.3.0 and newer no longer read.'

beforeEach(() => {
  requestMock.mockReset()
})

describe('readUploadRefusal', () => {
  it('returns the reason the runtime gave', () => {
    expect(readUploadRefusal(JSON.stringify({ UploadFileFail: REFUSAL, CompilationStatus: 'FAILED' }))).toBe(REFUSAL)
  })

  it('treats an empty reason as accepted', () => {
    expect(readUploadRefusal(JSON.stringify({ UploadFileFail: '', CompilationStatus: 'COMPILING' }))).toBeNull()
  })

  it('returns the reason exactly as the runtime sent it', () => {
    expect(readUploadRefusal(JSON.stringify({ UploadFileFail: ' disk full\n' }))).toBe(' disk full\n')
  })

  it('treats a body without the field, or one that is not JSON, as accepted', () => {
    expect(readUploadRefusal(JSON.stringify({ CompilationStatus: 'COMPILING' }))).toBeNull()
    expect(readUploadRefusal('not json')).toBeNull()
    expect(readUploadRefusal('null')).toBeNull()
    expect(readUploadRefusal(JSON.stringify({ UploadFileFail: 42 }))).toBeNull()
  })
})

describe('makeRuntimeApiUpload', () => {
  it('fails with the runtime reason and does not report the upload as accepted', async () => {
    respondWith(JSON.stringify({ UploadFileFail: REFUSAL, CompilationStatus: 'FAILED' }))
    const onUploadAccepted = jest.fn()

    const result = await upload(signedInClient(), onUploadAccepted)

    expect(result).toEqual({ success: false, error: REFUSAL })
    expect(onUploadAccepted).not.toHaveBeenCalled()
  })

  it('succeeds when the runtime accepts the program', async () => {
    const body = JSON.stringify({ UploadFileFail: '', CompilationStatus: 'COMPILING' })
    respondWith(body)
    const onUploadAccepted = jest.fn()

    const result = await upload(signedInClient(), onUploadAccepted)

    expect(result).toEqual({ success: true, data: body })
    expect(onUploadAccepted).toHaveBeenCalledWith(body)
  })

  it('still succeeds on an HTTP 200 whose body is not JSON', async () => {
    respondWith('OK')
    const onUploadAccepted = jest.fn()

    const result = await upload(signedInClient(), onUploadAccepted)

    expect(result).toEqual({ success: true, data: 'OK' })
    expect(onUploadAccepted).toHaveBeenCalledWith('OK')
  })
})

describe('a refused upload through deployRuntimeProgram', () => {
  it('ends as UPLOAD_FAILED with the reason logged and nothing polled', async () => {
    respondWith(JSON.stringify({ UploadFileFail: REFUSAL, CompilationStatus: 'FAILED' }))
    const client = signedInClient()
    const logs: Array<{ level: string; message: string }> = []
    const fetchCompilationStatus = jest.fn()
    const fetchStartResponse = jest.fn()

    const outcome = await deployRuntimeProgram({
      uploadProgram: () => upload(client, jest.fn()),
      fetchCompilationStatus,
      fetchStartResponse,
      onLog: (level, message) => logs.push({ level, message }),
    })

    expect(outcome).toBe('UPLOAD_FAILED')
    expect(logs).toContainEqual({ level: 'error', message: `Failed to upload program to runtime: ${REFUSAL}` })
    expect(logs.some((l) => l.message === 'Program uploaded successfully to runtime.')).toBe(false)
    expect(fetchCompilationStatus).not.toHaveBeenCalled()
    expect(fetchStartResponse).not.toHaveBeenCalled()
  })
})
