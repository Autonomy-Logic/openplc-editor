import { TXmlProject } from '../../../../../shared/contracts/types';
import { BaseResponse } from '../base-response.dto';

export type CreateProjectRequestData = never;
export type CreateProjectResponse = BaseResponse<{
  path: string;
  xmlAsObject: TXmlProject;
}>;
