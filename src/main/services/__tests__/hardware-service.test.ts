import { HardwareService } from '../index'

describe('HardwareService', () => {
  let service: HardwareService

  beforeEach(() => {
    service = new HardwareService()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
