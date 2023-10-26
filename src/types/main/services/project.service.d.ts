import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces';
import { ResponseService } from './response';

type Service = {};
export type ProjectDto = {
  filePath: string;
  projectAsObj?: object;
};

export type TProjectService = Service & {
  createProject: () => Promise<ResponseService<ProjectDto>>;
  getProject: (
    filePath: string,
  ) => Promise<ResponseService<XMLSerializedAsObject>>;
  saveProject: (data: ProjectDto) => Promise<ResponseService>;
};
