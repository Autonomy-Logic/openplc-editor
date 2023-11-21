import { ResponseService } from './response';

type Service = {};
export type ProjectDto = {
  projectPath: string;
  projectAsObj?: object;
};

export type TProjectService = Service & {
  createProject: () => Promise<ResponseService<ProjectDto>>;
  saveProject: (data: ProjectDto) => Promise<ResponseService>;
};
