import logo from '../assets/arca-logo.png';

export default function BrandLogo({ className = '', alt = 'ARCA CONTINENTAL' }) {
  return <img src={logo} alt={alt} className={className} />;
}
