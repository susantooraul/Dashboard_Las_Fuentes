import { useMemo, useState } from 'react';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import type { DateRange } from '../types';
import {
  downloadFiveMinuteHistoryExcel,
  validateFiveMinuteExportRange,
  type FiveMinuteExportModule,
} from '../../../services/waterFiveMinuteExportService';

interface FiveMinuteExcelExportButtonProps {
  module: FiveMinuteExportModule;
  sensorId?: number | null;
  range: DateRange;
}

export default function FiveMinuteExcelExportButton({ module, sensorId, range }: FiveMinuteExcelExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const validation = useMemo(
    () => validateFiveMinuteExportRange(String(range.startDate || ''), String(range.endDate || '')),
    [range.startDate, range.endDate],
  );

  const exportExcel = async () => {
    if (!sensorId) {
      setHasError(true);
      setMessage('No hay un sensor válido para exportar.');
      return;
    }
    if (validation) {
      setHasError(true);
      setMessage(validation);
      return;
    }
    setLoading(true);
    setHasError(false);
    setMessage('');
    try {
      await downloadFiveMinuteHistoryExcel({
        module,
        sensorId,
        startDate: String(range.startDate),
        endDate: String(range.endDate),
      });
      setHasError(false);
      setMessage('Excel de 5 minutos generado.');
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : 'No fue posible exportar el Excel de 5 minutos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="five-minute-export-action">
      <button
        type="button"
        className="five-minute-excel-button"
        onClick={exportExcel}
        disabled={loading || !sensorId}
        title="Exportar solo este elemento en intervalos reales de 5 minutos (máximo 3 días)"
      >
        {loading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
        <span>{loading ? 'Generando...' : 'Excel 5 min'}</span>
      </button>
      {message ? <span className={`five-minute-export-message${hasError ? ' is-error' : ''}`}>{message}</span> : null}
    </div>
  );
}
