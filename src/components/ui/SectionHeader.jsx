export default function SectionHeader({ title, description, icon: Icon, className = '' }) {
  return (
    <div className={`ui-section-header ${className}`}>
      <div className="ui-section-header-top">
        {Icon && <Icon size={20} className="ui-section-header-icon" strokeWidth={2} />}
        <h2 className="ui-section-header-title">{title}</h2>
      </div>
      {description && <p className="ui-section-header-desc">{description}</p>}
      <div className="ui-section-header-divider" />
    </div>
  );
}
