export default function PlantMultiSelector({
  plants,
  selectedIds,
  onTogglePlant,
  onSelectAll,
  onClearSelection,
}) {
  return (
    <section className="panel filters-panel plant-multi-selector fade-up">
      <div className="plant-multi-selector-head">
        <div>
          <div className="panel-title small">Filtrar plantas</div>
          <div className="panel-subtitle">Selecciona qué plantas deseas visualizar en el dashboard.</div>
        </div>
        <div className="plant-multi-selector-actions">
          <button type="button" className="header-button" onClick={onSelectAll}>Seleccionar todas</button>
          <button type="button" className="header-button" onClick={onClearSelection}>Limpiar</button>
        </div>
      </div>

      <div className="filters-summary">
        Mostrando <strong>{selectedIds.length}</strong> de <strong>{plants.length}</strong> plantas.
      </div>

      <div className="plant-checkbox-grid">
        {plants.map((plant) => {
          const checked = selectedIds.includes(plant.id);
          return (
            <label key={plant.id} className={`plant-checkbox-item ${checked ? 'checked' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onTogglePlant(plant.id)}
              />
              <span>{plant.name}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
