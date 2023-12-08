import { TXmlProject } from '../../../../../shared/contracts/types';
import { BaseResponse } from '../base-response.dto';

export type response = BaseResponse;
export type request = {
  projectPath: string;
  projectAsObj: TXmlProject;
};
