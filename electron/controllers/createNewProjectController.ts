import { CreateNewProjectService } from '../services';

export default class CreateNewProjectController {
  async handle() {
    const createNewProjectService = new CreateNewProjectService();
    const result = await createNewProjectService.execute();
    return result;
  }
}
