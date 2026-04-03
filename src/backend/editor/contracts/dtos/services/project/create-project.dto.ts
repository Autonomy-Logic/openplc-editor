import { BaseResponse } from '../base-response.dto'

export type CreateProjectRequestData = never
export type CreateProjectResponse = BaseResponse<{
  path: string
  xmlAsObject: Record<string, unknown>
}>
