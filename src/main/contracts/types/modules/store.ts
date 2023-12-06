import { z } from 'zod';

import { StoreSchema } from '../../validations/store-validation';

export type TStoreType = z.infer<typeof StoreSchema>;
