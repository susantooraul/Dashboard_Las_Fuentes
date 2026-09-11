export default function DataTable({ rows, showVoltage = false }) {
  const format = (value, digits = 2) => Number(value || 0).toFixed(digits);
  return (
    <div className="table-wrapper panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Últimas mediciones</div>
          <div className="panel-subtitle">Más recientes arriba · lecturas reales del rango seleccionado</div>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Sistema</th>
              <th>kW</th>
              <th>kWh</th>
              <th>kVARh</th>
              {showVoltage ? <th>Voltaje</th> : null}
              <th>Corriente</th>
              <th>FP</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.timestamp}-${row.system_name}`}>
                <td>{new Date(row.timestamp).toLocaleString('es-MX')}</td>
                <td>{row.system_name}</td>
                <td>{format(row.kw)}</td>
                <td>{format(row.kwh)}</td>
                <td>{format(row.kvarh)}</td>
                {showVoltage ? <td>{format(row.voltage)}</td> : null}
                <td>{format(row.current)}</td>
                <td>{format(row.power_factor, 3)}</td>
                <td><span className={`status-pill ${String(row.status || 'normal').toLowerCase()}`}>{String(row.status || 'NORMAL').toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
