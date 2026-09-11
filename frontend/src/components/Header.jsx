import { CodeXml, Download, FileImage, FileText, Mail } from 'lucide-react';

export default function Header({ title, subtitle, now, onExport, onEmail }) {
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
      </div>
    </header>
  );
}
