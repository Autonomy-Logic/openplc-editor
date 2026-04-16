import { BaseResponse } from '../base-response.dto'

export type SaveProjectRequestData = {
  projectPath: string
  projectAsObj: Record<string, unknown>
}
export type SaveProjectResponse = BaseResponse
