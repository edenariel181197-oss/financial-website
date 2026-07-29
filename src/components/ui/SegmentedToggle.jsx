export default function SegmentedToggle({ options, value, onChange, className = '' }) {
  return (
    <div className={`ui-segmented ${className}`}>
      {options.map(opt => (
        <button
          key={opt.key}
          type="button"
          className={`ui-segmented-btn ${value === opt.key ? 'active' : ''}`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
