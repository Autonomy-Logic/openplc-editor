import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces';
import { ResponseService } from './response';

type Service = {};
export type ProjectDto = {
  projectPath: string;
  projectAsObj?: object;
};

export type TProjectService = Service & {
  createProject: () => Promise<ResponseService<ProjectDto>>;
  getProject: (
    projectPath: string,
  ) => Promise<ResponseService<XMLSerializedAsObject>>;
  saveProject: (data: ProjectDto) => Promise<ResponseService>;
};
