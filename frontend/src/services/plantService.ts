import api from './api';
import type { ID } from '../types';

export const fetchPlantCatalog = async (plantId: ID): Promise<unknown> => {
  const { data } = await api.get<unknown>(`/plants/${plantId}`);
  return data;
};
