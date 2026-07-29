export default function KpiCard({ icon: Icon, title, value, trend, className = '' }) {
  return (
    <div className={`ui-kpi-card ${className}`}>
      <div className="ui-kpi-head">
        <span className="ui-kpi-title">{title}</span>
        {Icon && <Icon size={16} className="ui-kpi-icon" strokeWidth={2} />}
      </div>
      <div className="ui-kpi-value">{value}</div>
      {trend && (
        <div className={`ui-kpi-trend ${trend.positive === true ? 'positive' : trend.positive === false ? 'negative' : ''}`}>
          {trend.label}
        </div>
      )}
    </div>
  );
}
