interface PanelHeaderProps {
  title: string;
  subtitle?: string;
}

function PanelHeader({ title, subtitle }: PanelHeaderProps) {
  return (
    <div className="panel-header compact">
      <div>
        <div className="panel-title">{title}</div>
        {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
      </div>
    </div>
  );
}

export default PanelHeader;
