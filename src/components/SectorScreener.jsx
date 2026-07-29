import { useState, useEffect } from 'react';
import { Trophy } from 'lucide-react';
import { getSectorScreener, fmt, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';
import SegmentedToggle from './ui/SegmentedToggle';

const SECTORS = [
  { key: 'technology', label: 'טכנולוגיה' },
  { key: 'banks',      label: 'בנקים' },
  { key: 'cyber',      label: 'סייבר' },
  { key: 'energy',     label: 'אנרגיה' },
  { key: 'healthcare', label: 'בריאות' },
  { key: 'indices',    label: 'מדדים מובילים' },
];

export default function SectorScreener() {
  const [sector, setSector] = useState('technology');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSectorScreener(sector)
      .then((d) => { setResult(d); setLoading(false); })
      .catch((e) => { setError('שגיאה: ' + e.message); setLoading(false); });
  }, [sector]);

  return (
    <div className="calc-luxury">
      <SectionHeader
        title="מיטב הסקטור"
        description={sector === 'indices'
          ? 'תעודות הסל של המדדים המובילים בעולם, מסודרות לפי מחיר בסדר יורד'
          : '10 החברות המובילות בכל סקטור, מסודרות לפי שווי שוק בסדר יורד'}
        icon={Trophy}
      />

      <div className="lux-section">
        <SegmentedToggle
          options={SECTORS.map((s) => ({ key: s.key, label: s.label }))}
          value={sector}
          onChange={setSector}
        />
      </div>

      {loading && <div className="data-loading">טוען דירוג...</div>}
      {error && <div className="data-error">{error}</div>}

      {result && !loading && (
        <div className="lux-section">
          <div className="eps-table-wrap">
            <table className="lux-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>חברה</th>
                  <th>מחיר</th>
                  <th>P/E</th>
                  <th>P/B</th>
                  <th>EV/EBITDA</th>
                  <th>שווי שוק</th>
                </tr>
              </thead>
              <tbody>
                {result.companies.map((c, i) => (
                  <tr key={c.symbol}>
                    <td>{i + 1}</td>
                    <td className="row-lbl">{c.name || c.symbol}<br />{c.symbol}</td>
                    <td>{c.price != null ? `$${fmtRaw(c.price)}` : '—'}</td>
                    <td>{fmtRaw(c.pe)}</td>
                    <td>{fmtRaw(c.pb)}</td>
                    <td>{fmtRaw(c.evToEbitda)}</td>
                    <td>{c.marketCap != null ? `$${fmt(c.marketCap)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sector === 'indices' && (
            <p className="lux-hint">תעודות סל אינן חברות ולכן אין להן P/E, P/B, EV/EBITDA או שווי שוק — עמודות אלו יוצגו כ-"—".</p>
          )}
          {result.cached && <p className="lux-hint">נתונים מהמטמון (מתעדכן כל 6 שעות)</p>}
        </div>
      )}
    </div>
  );
}
