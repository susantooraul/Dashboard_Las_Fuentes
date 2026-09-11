import { Droplets, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const options = [
  {
    title: 'Monitoreo eléctrico',
    subtitle: 'Acceso al sistema actual de demanda, tableros, transformadores y reportes energéticos.',
    icon: Zap,
    to: '/electric/dashboard',
    accent: 'electric',
  },
  {
    title: 'Monitoreo x',
    subtitle: 'Acceso al dominio hidráulico con consumos, tanques, balance, CIP, UV y reportes.',
    icon: Droplets,
    to: '/pozos/dashboard',
    accent: 'pozos',
  },
];

export default function DomainSelectionPage() {
  return (
    <div className="domain-selection-shell">
      <div className="domain-selection-backdrop" />
      <section className="domain-selection-card panel fade-up">
        <header className="domain-selection-head">
          <div className="domain-selection-brand">
            <div className="brand-mark domain-brand-mark"><BrandLogo className="brand-logo domain-logo" /></div>
            <div>
              <div className="eyebrow">Selección de dominio</div>
              <h1 className="domain-selection-title">Sistema de monitoreo industrial</h1>
              <p className="domain-selection-copy">Elige el dominio operativo con el que deseas trabajar.</p>
            </div>
          </div>
        </header>

        <div className="domain-selection-options">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <Link key={option.title} to={option.to} className={`domain-option ${option.accent}`}>
                <div className="domain-option-icon"><Icon size={24} /></div>
                <div className="domain-option-copy">
                  <div className="domain-option-title">{option.title}</div>
                  <div className="domain-option-subtitle">{option.subtitle}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
