import { createProjectService } from '../services';

const createProjectController = {
  async handle() {
    const result = await createProjectService.execute();
    return result;
  },
};

export default createProjectController;
