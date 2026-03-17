import { TXmlProject } from '../../../../../shared/contracts/types'
import { BaseResponse } from '../base-response.dto'

export type SaveProjectRequestData = {
  projectPath: string
  projectAsObj: TXmlProject
}
export type SaveProjectResponse = BaseResponse
