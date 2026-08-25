import { evaluatePreBuildPlcGate } from '../pre-build-plc-gate'

describe('evaluatePreBuildPlcGate', () => {
  it('demands a stop only when a device-side build meets a running PLC', () => {
    const verdict = evaluatePreBuildPlcGate({ buildsOnDevice: true, connected: true, running: true })
    expect(verdict.kind).toBe('must-stop')
    expect(verdict.kind === 'must-stop' && verdict.reason).toMatch(/scan deadlines/)
  })

  it('ignores a running PLC for a target flashed over USB', () => {
    // Those builds happen on the host, so what the device is doing is irrelevant.
    expect(evaluatePreBuildPlcGate({ buildsOnDevice: false, connected: true, running: true })).toEqual({
      kind: 'proceed',
    })
  })

  it('proceeds when the PLC is stopped', () => {
    expect(evaluatePreBuildPlcGate({ buildsOnDevice: true, connected: true, running: false })).toEqual({
      kind: 'proceed',
    })
  })

  it('proceeds when nothing is connected', () => {
    // The build's own upload step reports an unreachable target better than a
    // pre-flight guess, and a compile-only build never touches the device.
    expect(evaluatePreBuildPlcGate({ buildsOnDevice: true, connected: false, running: true })).toEqual({
      kind: 'proceed',
    })
  })
})
