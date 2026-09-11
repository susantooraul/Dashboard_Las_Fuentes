import { useEffect, useMemo, useState } from 'react';
import KpiCard from '../components/KpiCard';
import PlantDashboardCard from '../components/PlantDashboardCard';
import PlantMultiSelector from '../components/PlantMultiSelector';
import PlantsComparisonChart from '../components/PlantsComparisonChart';
import { getMultiPlantMock } from '../data/multiPlantMock';

const mockPlants = getMultiPlantMock();

export default function MultiPlantDashboardPage({ setHeaderMeta }) {
  const [selectedPlantIds, setSelectedPlantIds] = useState(mockPlants.map((plant) => plant.id));

  useEffect(() => {
    setHeaderMeta({
      title: 'Dashboard Multi-planta',
      subtitle: 'Vista global demo para comparar consumo y capacidad entre 18 plantas',
      onExport: () => {},
      onEmail: () => {},
    });
  }, [setHeaderMeta]);

  const visiblePlants = useMemo(
    () => mockPlants.filter((plant) => selectedPlantIds.includes(plant.id)),
    [selectedPlantIds],
  );

  const summary = useMemo(() => {
    const totalConsumption = visiblePlants.reduce((sum, plant) => sum + plant.currentLoad, 0);
    const totalCapacity = visiblePlants.reduce((sum, plant) => sum + plant.capacityTotal, 0);
    const averageUtilization = visiblePlants.length
      ? Math.round(visiblePlants.reduce((sum, plant) => sum + plant.utilizationPct, 0) / visiblePlants.length)
      : 0;
    const criticalPlants = visiblePlants.filter((plant) => plant.indicatorClass === 'critical').length;

    return {
      totalConsumption,
      totalCapacity,
      averageUtilization,
      criticalPlants,
    };
  }, [visiblePlants]);

  const togglePlant = (plantId) => {
    setSelectedPlantIds((current) => (
      current.includes(plantId)
        ? current.filter((id) => id !== plantId)
        : [...current, plantId]
    ));
  };

  return (
    <div className="page-grid">
      <section className="panel hero-panel fade-up">
        <div>
          <div className="eyebrow">Vista global / dominio eléctrico</div>
          <div className="hero-title">Comparativo multi-planta para demo</div>
          <div className="hero-subtitle">
            Dashboard global con selección dinámica de plantas, tarjetas reutilizables y comparativo visual de consumo y uso de capacidad.
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-chip">{visiblePlants.length} visibles</div>
          <div className="hero-chip">{summary.averageUtilization}% uso promedio</div>
          <div className="hero-chip critical">{summary.criticalPlants} críticas</div>
        </div>
      </section>

      <PlantMultiSelector
        plants={mockPlants}
        selectedIds={selectedPlantIds}
        onTogglePlant={togglePlant}
        onSelectAll={() => setSelectedPlantIds(mockPlants.map((plant) => plant.id))}
        onClearSelection={() => setSelectedPlantIds([])}
      />

      <section className="cards-grid stagger-grid">
        <KpiCard
          label="Consumo total"
          value={summary.totalConsumption.toLocaleString('es-MX')}
          unit="kW"
          trend="Suma de plantas visibles"
          accent="red"
        />
        <KpiCard
          label="Capacidad total"
          value={summary.totalCapacity.toLocaleString('es-MX')}
          unit="kW"
          trend="Capacidad instalada visible"
          accent="crimson"
        />
        <KpiCard
          label="Uso promedio"
          value={summary.averageUtilization}
          unit="%"
          trend="Capacidad utilizada"
          accent="wine"
        />
        <KpiCard
          label="Plantas críticas"
          value={summary.criticalPlants}
          unit="uds"
          trend="Seguimiento prioritario"
          accent="brown"
        />
      </section>

      {visiblePlants.length ? (
        <>
          <PlantsComparisonChart plants={visiblePlants} />
          <section className="plant-dashboard-grid stagger-grid">
            {visiblePlants.map((plant) => (
              <PlantDashboardCard key={plant.id} plant={plant} />
            ))}
          </section>
        </>
      ) : (
        <section className="panel empty-state fade-up">
          No hay plantas seleccionadas. Usa el filtro para mostrar una o varias plantas.
        </section>
      )}
    </div>
  );
}
