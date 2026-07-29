import { useState } from 'react';

export default function Tooltip({ text }) {
  const [vis, setVis] = useState(false);
  return (
    <span className="tooltip-wrap" onMouseEnter={() => setVis(true)} onMouseLeave={() => setVis(false)}>
      <span className="tooltip-icon">?</span>
      {vis && <span className="tooltip-box">{text}</span>}
    </span>
  );
}
