import { TXmlProject } from '../../../../../shared/contracts/types';
import { BaseResponse } from '../base-response.dto';

export type requestData = never;
export type response = BaseResponse<{
  path: string;
  xmlAsObject: TXmlProject;
}>;
