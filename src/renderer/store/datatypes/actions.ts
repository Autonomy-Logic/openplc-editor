import { Datatype } from '../../models/datatype';
import { createAction, createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '../..';

export const addDatatype = createAction<Datatype>('datatypes/add');

export const updateDatatype = createAction<Partial<Datatype> & { id: string }>('datatypes/update');

export const deleteDatatype = createAction<string>('datatypes/delete');

export const loadDatatypes = createAsyncThunk(
  'datatypes/load',
  async () => {
    // Implementation would go here
    return [] as Datatype[];
  }
);
