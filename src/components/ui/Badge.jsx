export default function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`}>{children}</span>;
}
