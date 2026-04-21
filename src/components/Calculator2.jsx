import { useState, useEffect } from 'react';
import { getCalcData } from '../utils/api';

function fmtNum(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(d);
}
function fmtB(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function calcCAGR(future, current, years) {
  if (!current || current <= 0 || !future || future <= 0) return null;
  return (Math.pow(future / current, 1 / years) - 1) * 100;
}

const SCENARIOS = [
  { key: 'pess', label: 'פסימי', color: 'scenario-red' },
  { key: 'neut', label: 'ניטרלי', color: 'scenario-blue' },
  { key: 'opt', label: 'אופטימי', color: 'scenario-green' },
];

export default function Calculator2({ ticker }) {
  const [calcData, setCalcData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Header inputs
  const [netMargin, setNetMargin] = useState('');
  const [revenueGrowth, setRevenueGrowth] = useState('');

  // Scenario P/E inputs [pess, neut, opt]
  const [peInputs, setPeInputs] = useState({ pess: '', neut: '', opt: '' });

  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setResults(null);
    getCalcData(ticker).then(d => {
      setCalcData(d);
      // netMargin: prefer current (TTM), fallback to most recent annual history
      const margin = d.current?.netMargin ?? d.history?.[0]?.netMargin;
      if (margin != null) setNetMargin((margin * 100).toFixed(1));
      // revenueGrowth: prefer current (YoY), fallback already computed server-side
      const growth = d.current?.revenueGrowth;
      if (growth != null) setRevenueGrowth((growth * 100).toFixed(1));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticker]);

  const history = calcData?.history?.slice(0, 5) || [];
  const current = calcData?.current || {};

  // Latest revenue for projections
  const latestRevenue = history[0]?.revenue ?? null;

  function calculate() {
    const margin = parseFloat(netMargin) / 100;
    const growth = parseFloat(revenueGrowth) / 100;
    const shares = current.sharesOutstanding;
    const mktPrice = current.price;

    if (!latestRevenue || isNaN(margin) || isNaN(growth)) return;

    const rev5 = latestRevenue * Math.pow(1 + growth, 5);
    const netIncome5 = rev5 * margin;
    const currentMC = shares && mktPrice ? shares * mktPrice : null;

    const scenarioCalc = (peVal) => {
      const pe = parseFloat(peVal);
      if (!pe) return null;
      const mc5 = netIncome5 * pe;
      const price5 = shares ? mc5 / shares : null;
      const cagr = currentMC ? calcCAGR(mc5, currentMC, 5) : null;
      return { pe, mc5, price5, cagr };
    };

    setResults({
      rev5,
      netIncome5,
      pess: scenarioCalc(peInputs.pess),
      neut: scenarioCalc(peInputs.neut),
      opt: scenarioCalc(peInputs.opt),
    });
  }

  const CAGRBadge = ({ cagr }) => {
    if (cagr == null) return null;
    const cls = cagr >= 14.4 ? 'cagr-great' : cagr >= 12 ? 'cagr-good' : 'cagr-bad';
    return (
      <div className={`cagr-pill ${cls}`}>
        CAGR {fmtNum(cagr, 1)}%
        {cagr >= 14.4 ? ' 🚀' : cagr >= 12 ? ' ✅' : ' ❌'}
      </div>
    );
  };

  return (
    <div className="calc-luxury">
      <div className="calc-lux-header">
        <h2>מחשבון הערכת שווי — הכנסות</h2>
        {!ticker && <p className="lux-hint">הכנס טיקר חברה בראש הדף לטעינה אוטומטית</p>}
        {loading && <p className="lux-hint">טוען נתונים עבור {ticker}...</p>}
      </div>

      {/* Header data row */}
      <div className="lux-section">
        <div className="lux-data-row">
          {[
            { label: 'שולי רווח נקי %', val: netMargin, set: setNetMargin, editable: true },
            { label: 'קצב צמיחת הכנסות %', val: revenueGrowth, set: setRevenueGrowth, editable: true },
            { label: 'מחיר מניה נוכחי', val: current.price != null ? `$${fmtNum(current.price)}` : '—', editable: false },
            { label: 'שווי שוק', val: fmtB(current.marketCap), editable: false },
            { label: 'מניות במחזור', val: current.sharesOutstanding ? `${(current.sharesOutstanding / 1e6).toFixed(0)}M` : '—', editable: false },
          ].map(({ label, val, set, editable }) => (
            <div key={label} className="lux-data-cell">
              <span className="lux-data-label">{label}</span>
              {editable
                ? <input className="lux-inline-input" type="number" value={val} onChange={e => set(e.target.value)} />
                : <span className="lux-data-value">{val}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Historical table */}
      {history.length > 0 && (
        <div className="lux-section">
          <h3 className="lux-section-title">היסטוריה פיננסית — 5 שנים</h3>
          <div className="eps-table-wrap">
            <table className="lux-table">
              <thead>
                <tr>
                  <th>שנה</th>
                  {history.map(r => <th key={r.year}>{r.year}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-lbl">הכנסות</td>
                  {history.map(r => <td key={r.year}>{fmtB(r.revenue)}</td>)}
                </tr>
                <tr>
                  <td className="row-lbl">שולי רווח</td>
                  {history.map(r => <td key={r.year}>{fmtPct(r.netMargin)}</td>)}
                </tr>
                <tr>
                  <td className="row-lbl">רווח נקי</td>
                  {history.map(r => <td key={r.year} className={r.netIncome > 0 ? 'pos-val' : 'neg-val'}>{fmtB(r.netIncome)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3 Scenarios */}
      <div className="lux-section">
        <h3 className="lux-section-title">תרחישים — מכפיל רווח שנה חמישית</h3>
        <div className="scenarios-grid">
          {SCENARIOS.map(({ key, label, color }) => (
            <div key={key} className={`scenario-lux ${color}`}>
              <div className="scenario-lux-label">{label}</div>
              <div className="scenario-pe-inputs">
                <div className="pe-input-group">
                  <label>P/E נמוך</label>
                  <input className="lux-input" type="number" value={peInputs[key] || ''} placeholder="לדוג׳ 15"
                    onChange={e => setPeInputs(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              </div>
              {results?.[key] && (
                <div className="scenario-lux-results">
                  <div className="s-res-row"><span>שווי שוק שנה 5</span><strong>{fmtB(results[key].mc5)}</strong></div>
                  {results[key].price5 && <div className="s-res-row"><span>מחיר מניה שנה 5</span><strong>${fmtNum(results[key].price5)}</strong></div>}
                  <CAGRBadge cagr={results[key].cagr} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <button className="lux-btn" onClick={calculate}>חשב תרחישים</button>

      {results && (
        <div className="lux-results" style={{ marginTop: '1.5rem' }}>
          <div className="lux-results-grid">
            <div className="lux-result-item">
              <span>הכנסות שנה 5 (משוערות)</span>
              <strong>{fmtB(results.rev5)}</strong>
            </div>
            <div className="lux-result-item">
              <span>רווח נקי שנה 5</span>
              <strong>{fmtB(results.netIncome5)}</strong>
            </div>
          </div>
          <div className="cagr-legend-row">
            <span className="cagr-great">🚀 14.4%+ = פי 2 בחמש שנים</span>
            <span className="cagr-good">✅ 12–14.4% = מעל היעד</span>
            <span className="cagr-bad">❌ מתחת ל-12%</span>
          </div>
        </div>
      )}
    </div>
  );
}
