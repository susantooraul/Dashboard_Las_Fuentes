import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type DashboardButtonVariant = 'secondary' | 'primary' | 'pdf' | 'excel' | 'danger' | 'icon';
export interface DashboardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DashboardButtonVariant;
}

/** Shared presentation; native events, submit behavior, disabled and refs pass through. */
const DashboardButton = forwardRef<HTMLButtonElement, DashboardButtonProps>(
  function DashboardButton({ variant = 'secondary', className = '', ...props }, ref) {
    return <button {...props} ref={ref} className={`arca-button arca-button--${variant} ${className}`.trim()} />;
  },
);

export default DashboardButton;
