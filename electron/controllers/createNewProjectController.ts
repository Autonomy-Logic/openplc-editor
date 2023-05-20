import { createNewProjectService } from '../services';

const createNewProjectController = {
  async handle() {
    const result = await createNewProjectService.execute();
    return result;
  },
};

export default createNewProjectController;
