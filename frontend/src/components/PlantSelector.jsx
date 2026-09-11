import { Building2, Database } from 'lucide-react';

export default function PlantSelector({ plants, plantId, onChange }) {
  const current = plants.find((item) => item.id === plantId) || plants[0];

  return (
    <div className="plant-selector panel fade-up">
      <div className="plant-selector-left">
        <div className="plant-selector-icon"><Building2 size={18} /></div>
        <div>
          <div className="plant-selector-label">Planta activa</div>
          <div className="plant-selector-name">{current?.name || 'Sin planta'}</div>
        </div>
      </div>
      <div className="plant-selector-right">
        <div className="plant-selector-connections"><Database size={14} /> {current?.connections?.length || 0} conexión(es)</div>
        <select value={plantId} onChange={(e) => onChange(e.target.value)}>
          {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
        </select>
      </div>
    </div>
  );
}
