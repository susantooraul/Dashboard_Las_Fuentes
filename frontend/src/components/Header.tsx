import type * as React from 'react';
import { CodeXml, Download, FileImage, FileText, LogOut, Mail, UserRound } from 'lucide-react';
import type { User } from '../types';

export type HeaderExportFormat = 'excel' | 'pdf' | 'html' | 'png';

export interface HeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  now: React.ReactNode;
  onExport?: (format: HeaderExportFormat) => void;
  onEmail?: () => void;
  user?: User | null;
  onLogout?: () => void;
}

export default function Header({ title, subtitle, now, onExport, onEmail, user, onLogout }: HeaderProps) {
  return (
    <header className="header-bar">
      <div>
        <div className="header-title">{title}</div>
        {subtitle ? <div className="header-subtitle">{subtitle}</div> : null}
      </div>
      <div className="header-actions">
        {onExport ? <button className="header-button" onClick={() => onExport('excel')}><Download size={15} /> Excel</button> : null}
        {onExport ? <button className="header-button" onClick={() => onExport('pdf')}><FileText size={15} /> PDF</button> : null}
        {onExport ? <button className="header-button" onClick={() => onExport('html')}><CodeXml size={15} /> HTML</button> : null}
        {onExport ? <button className="header-button" onClick={() => onExport('png')}><FileImage size={15} /> Imagen</button> : null}
        <div className="time-chip">{now}</div>
        {onEmail ? <button className="header-button primary" onClick={onEmail}><Mail size={15} /> Enviar</button> : null}
        <div className="user-chip"><UserRound size={15} /><span>{user?.display_name || user?.name || user?.username || 'Usuario'}</span></div>
        <button className="header-button" onClick={onLogout}><LogOut size={15} /> Salir</button>
      </div>
    </header>
  );
}
