export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button className={`ui-btn ui-btn-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
