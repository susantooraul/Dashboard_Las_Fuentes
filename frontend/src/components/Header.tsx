import DashboardButton from './DashboardButton';
import type * as React from 'react';
import { CodeXml, Download, FileImage, FileText, Mail } from 'lucide-react';

export type HeaderExportFormat = 'excel' | 'pdf' | 'html' | 'png';

export interface HeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  now: React.ReactNode;
  onExport?: (format: HeaderExportFormat) => void;
  onEmail?: () => void;
}

export default function Header({ title, subtitle, now, onExport, onEmail }: HeaderProps) {
  return (
    <header className="header-bar">
      <div>
        <div className="header-title">{title}</div>
        {subtitle ? <div className="header-subtitle">{subtitle}</div> : null}
      </div>
      <div className="header-actions">
        {onExport ? <DashboardButton variant="excel" className="header-button" onClick={() => onExport('excel')}><Download size={15} /> Excel</DashboardButton> : null}
        {onExport ? <DashboardButton variant="pdf" className="header-button" onClick={() => onExport('pdf')}><FileText size={15} /> PDF</DashboardButton> : null}
        {onExport ? <DashboardButton variant="secondary" className="header-button" onClick={() => onExport('html')}><CodeXml size={15} /> HTML</DashboardButton> : null}
        {onExport ? <DashboardButton variant="secondary" className="header-button" onClick={() => onExport('png')}><FileImage size={15} /> Imagen</DashboardButton> : null}
        <div className="time-chip">{now}</div>
        {onEmail ? <DashboardButton variant="primary" className="header-button primary" onClick={onEmail}><Mail size={15} /> Enviar</DashboardButton> : null}
      </div>
    </header>
  );
}
