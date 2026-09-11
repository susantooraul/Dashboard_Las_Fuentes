import { useEffect, useState } from 'react';
import api from '../services/api';

const fallbackPlants = [
  { id: 'gdl-demo', name: 'ARCA CONTINENTAL', state: 'Jalisco', description: 'Tablero conectado al sistema de monitoreo.', connections: [] },
  { id: 'mt-demo', name: 'Planta MTY Demo', state: 'Nuevo León', description: 'Demo multi-planta.', connections: [] },
];

export function usePlants() {
  const [plants, setPlants] = useState(fallbackPlants);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/plants')
      .then(({ data }) => setPlants(data))
      .catch(() => setPlants(fallbackPlants))
      .finally(() => setLoading(false));
  }, []);

  return { plants, loading };
}
