import { useState, useEffect } from 'react';
import { Trophy, Landmark, Divide, Award } from 'lucide-react';
import { getSectorScreener, fmt, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';
import SegmentedToggle from './ui/SegmentedToggle';
import KpiCard from './ui/KpiCard';

const SECTORS = [
  { key: 'technology', label: 'טכנולוגיה' },
  { key: 'banks',      label: 'בנקים' },
  { key: 'cyber',      label: 'סייבר' },
  { key: 'energy',     label: 'אנרגיה' },
  { key: 'healthcare', label: 'בריאות' },
  { key: 'indices',    label: 'מדדים מובילים' },
];

function median(values) {
  const arr = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

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

  const companies = result?.companies || [];
  const totalMarketCap = companies.reduce((sum, c) => sum + (c.marketCap || 0), 0);
  const avgPE = median(companies.map((c) => c.pe));
  const leader = companies[0];

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
          {sector !== 'indices' && companies.length > 0 && (
            <div className="sector-kpi-bar">
              <KpiCard title="שווי שוק כולל" value={totalMarketCap ? `$${fmt(totalMarketCap)}` : '—'} icon={Landmark} />
              <KpiCard title="חציון P/E בסקטור" value={avgPE != null ? `${fmtRaw(avgPE)}x` : '—'} icon={Divide} />
              <KpiCard title="מוביל הסקטור" value={leader?.name || leader?.symbol || '—'} icon={Award} />
            </div>
          )}
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
                {companies.map((c, i) => (
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
