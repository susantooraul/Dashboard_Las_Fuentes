export default function BottleIcon({ size = 18, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 2h4v2l-1 1v2.2c0 .5.2 1 .6 1.4l1.8 1.8c.8.8 1.3 1.9 1.3 3.1V19c0 1.7-1.3 3-3 3h-3.4c-1.7 0-3-1.3-3-3v-5.5c0-1.2.5-2.3 1.3-3.1l1.8-1.8c.4-.4.6-.9.6-1.4V5l-1-1V2Z" fill="currentColor" opacity="0.95"/>
      <path d="M9.4 13.5h5.2" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.65"/>
    </svg>
  );
}
