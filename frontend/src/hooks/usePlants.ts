import { useEffect, useState } from 'react';
import api from '../services/api';
import type { Plant } from '../types';

export interface UsePlantsPlant extends Plant {
  id: string;
  name: string;
  state: string;
  description: string;
  connections: unknown[];
}

export interface UsePlantsResult {
  plants: UsePlantsPlant[];
  loading: boolean;
}

const fallbackPlants: UsePlantsPlant[] = [
  { id: 'gdl-demo', name: 'ARCA CONTINENTAL', state: 'Jalisco', description: 'Tablero conectado al sistema de monitoreo.', connections: [] },
  { id: 'mt-demo', name: 'Planta MTY Demo', state: 'Nuevo León', description: 'Demo multi-planta.', connections: [] },
];

export function usePlants(): UsePlantsResult {
  const [plants, setPlants] = useState<UsePlantsPlant[]>(fallbackPlants);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<UsePlantsPlant[]>('/plants')
      .then(({ data }) => setPlants(data))
      .catch(() => setPlants(fallbackPlants))
      .finally(() => setLoading(false));
  }, []);

  return { plants, loading };
}
