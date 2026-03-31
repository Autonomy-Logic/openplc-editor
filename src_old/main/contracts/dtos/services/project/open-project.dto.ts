import { TXmlProject } from '../../../../../shared/contracts/types'
import { BaseResponse } from '../base-response.dto'

export type OpenProjectRequestData = never
export type OpenProjectResponse = BaseResponse<{
  path: string
  xmlAsObject: TXmlProject
}>
