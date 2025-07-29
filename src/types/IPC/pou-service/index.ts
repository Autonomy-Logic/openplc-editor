import { PLCPou } from '@root/types/PLC/open-plc'

export * from './create-pou-file'

export type PouServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    filePath?: string
    pou?: PLCPou
  }
}
