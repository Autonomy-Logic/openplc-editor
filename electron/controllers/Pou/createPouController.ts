import { CreatePouDTO } from "@electron/contracts/dtos/create-pou.dto";
import CreatePouService from "@electron/services/Pou/createPouService"

class CreatePouController {

  constructor(private readonly createPouService: typeof CreatePouService) {}
  
  async execute (data: CreatePouDTO): Promise<unknown> {
    const createdPou = this.createPouService(data);
    return createdPou;
  }
}

const createPouController = new CreatePouController(CreatePouService) 

export default createPouController
