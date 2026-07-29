export default function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div className={`ui-card ${hover ? 'ui-card-hover' : ''} ${className}`} {...props}>
      {children}
    </div>
  );
}
