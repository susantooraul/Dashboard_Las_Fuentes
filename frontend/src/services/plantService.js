import api from './api';

export const fetchPlantCatalog = async (plantId) => {
  const { data } = await api.get(`/plants/${plantId}`);
  return data;
};
