import logo from '../assets/arca-logo.png';

export interface BrandLogoProps {
  className?: string;
  alt?: string;
}

export default function BrandLogo({ className = '', alt = 'ARCA CONTINENTAL' }: BrandLogoProps) {
  return <img src={logo} alt={alt} className={className} />;
}
