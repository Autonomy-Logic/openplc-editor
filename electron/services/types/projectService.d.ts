export interface IProjectService {
  createProject: () => Promise<ServiceResponse<string>>
  getProject: (
    filePath: string,
  ) => Promise<ServiceResponse<XMLSerializedAsObject>>
  saveProject: (
    filePath: string,
    xmlSerializedAsObject: XMLSerializedAsObject,
  ) => Promise<ServiceResponse<string>>
}
