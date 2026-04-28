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

function Tooltip({ text }) {
  const [vis, setVis] = useState(false);
  return (
    <span className="tooltip-wrap" onMouseEnter={() => setVis(true)} onMouseLeave={() => setVis(false)}>
      <span className="tooltip-icon">?</span>
      {vis && <span className="tooltip-box">{text}</span>}
    </span>
  );
}

const SCENARIOS = [
  {
    key: 'pess', label: 'פסימי', color: 'scenario-red',
    desc: 'הנחה שמרנית — צמיחה מואטת, מכפיל רווח נמוך. מייצג תרחיש של איכזוב בתוצאות או האטה כלכלית.',
  },
  {
    key: 'neut', label: 'ניטרלי', color: 'scenario-blue',
    desc: 'המשך המגמה הנוכחית — ביצועים יציבים ללא שינוי מהותי בקצב הצמיחה או במכפיל השוק.',
  },
  {
    key: 'opt', label: 'אופטימי', color: 'scenario-green',
    desc: 'תרחיש חיובי — האצה בצמיחה, שיפור שולים ועלייה במכפיל. מייצג ביצועים מעל התחזית.',
  },
];

export default function Calculator2({ ticker }) {
  const [calcData, setCalcData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [netMargin, setNetMargin] = useState('');
  const [revenueGrowth, setRevenueGrowth] = useState('');
  const [peInputs, setPeInputs] = useState({ pess: '', neut: '', opt: '' });
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setResults(null);
    getCalcData(ticker).then(d => {
      setCalcData(d);
      const margin = d.current?.netMargin ?? d.history?.[0]?.netMargin;
      if (margin != null) setNetMargin((margin * 100).toFixed(1));
      const growth = d.current?.revenueGrowth;
      if (growth != null) setRevenueGrowth((growth * 100).toFixed(1));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticker]);

  const history = calcData?.history?.slice(0, 5) || [];
  const current = calcData?.current || {};

  const baseRevenue = history[history.length - 1]?.revenue ?? null;
  const baseYear = history.length > 0 ? parseInt(history[history.length - 1].year) : new Date().getFullYear();

  const projYears = (() => {
    const margin = parseFloat(netMargin) / 100;
    const growth = parseFloat(revenueGrowth) / 100;
    if (!baseRevenue || isNaN(margin) || isNaN(growth)) return [];
    return Array.from({ length: 5 }, (_, i) => {
      const revenue = baseRevenue * Math.pow(1 + growth, i + 1);
      const netIncome = revenue * margin;
      return { year: baseYear + i, revenue, netMargin: margin, netIncome };
    });
  })();

  function calculate() {
    const margin = parseFloat(netMargin) / 100;
    const growth = parseFloat(revenueGrowth) / 100;
    const shares = current.sharesOutstanding;
    const mktPrice = current.price;
    if (!baseRevenue || isNaN(margin) || isNaN(growth)) return;

    const rev5 = baseRevenue * Math.pow(1 + growth, 5);
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
        <h2>♦ מחשבון הערכת שווי — הכנסות</h2>
        {!ticker && <p className="lux-hint">הכנס טיקר חברה בראש הדף לטעינה אוטומטית</p>}
        {loading && <p className="lux-hint">טוען נתונים עבור {ticker}...</p>}
      </div>

      {/* Inputs */}
      <div className="lux-section">
        <div className="lux-data-row">
          {[
            { label: 'הכנסות (TTM)', val: fmtB(baseRevenue), editable: false },
            { label: 'רווח נקי (TTM)', val: fmtB(history[history.length - 1]?.netIncome), editable: false },
            {
              label: 'שולי רווח נקי %',
              val: netMargin, set: setNetMargin, editable: true,
              tip: 'אחוז הרווח הנקי מתוך ההכנסות. מחושב מהדוחות הכספיים האחרונים.',
            },
            {
              label: 'קצב צמיחת הכנסות %',
              val: revenueGrowth, set: setRevenueGrowth, editable: true,
              tip: 'קצב הצמיחה השנתי הצפוי בהכנסות לאורך 5 השנים הבאות.',
            },
            { label: 'מחיר מניה', val: current.price != null ? `$${fmtNum(current.price)}` : '—', editable: false },
            { label: 'שווי שוק', val: fmtB(current.marketCap), editable: false },
            { label: 'מניות במחזור', val: current.sharesOutstanding ? `${(current.sharesOutstanding / 1e6).toFixed(0)}M` : '—', editable: false },
          ].map(({ label, val, set, editable, tip }) => (
            <div key={label} className="lux-data-cell">
              <span className="lux-data-label">
                {label} {tip && <Tooltip text={tip} />}
              </span>
              {editable
                ? <input className="lux-inline-input" type="number" value={val} onChange={e => set(e.target.value)} />
                : <span className="lux-data-value">{val}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 3 Scenarios */}
      <div className="lux-section">
        <h3 className="lux-section-title">♦ תרחישים — מכפיל רווח שנה חמישית</h3>
        <div className="scenarios-grid">
          {SCENARIOS.map(({ key, label, color, desc }) => (
            <div key={key} className={`scenario-lux ${color}`}>
              <div className="scenario-lux-label">{label}</div>
              <div className="scenario-desc">{desc}</div>
              <div className="scenario-pe-inputs">
                <div className="pe-input-group">
                  <label>מכפיל P/E <Tooltip text="מכפיל הרווח שאתה מניח שהחברה תיסחר בו בשנה החמישית." /></label>
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

      {/* Results */}
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

      {/* Historical + Projected table */}
      {history.length > 0 && (
        <div className="lux-section" style={{ marginTop: '1.5rem' }}>
          <h3 className="lux-section-title">♦ היסטוריה פיננסית + תחזית 5 שנים</h3>
          <div className="eps-table-wrap">
            <table className="lux-table">
              <thead>
                <tr>
                  <th>שנה</th>
                  {history.map(r => <th key={r.year}>{r.year}</th>)}
                  {projYears.map(r => <th key={r.year} className="proj-year">{r.year}E</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-lbl">הכנסות</td>
                  {history.map(r => <td key={r.year}>{fmtB(r.revenue)}</td>)}
                  {projYears.map(r => <td key={r.year} className="proj-val">{fmtB(r.revenue)}</td>)}
                </tr>
                <tr>
                  <td className="row-lbl">שולי רווח</td>
                  {history.map(r => <td key={r.year}>{fmtPct(r.netMargin)}</td>)}
                  {projYears.map(r => <td key={r.year} className="proj-val">{fmtPct(r.netMargin)}</td>)}
                </tr>
                <tr>
                  <td className="row-lbl">רווח נקי</td>
                  {history.map(r => <td key={r.year} className={r.netIncome > 0 ? 'pos-val' : 'neg-val'}>{fmtB(r.netIncome)}</td>)}
                  {projYears.map(r => <td key={r.year} className="proj-val pos-val">{fmtB(r.netIncome)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          {projYears.length === 0 && (
            <p className="lux-hint" style={{ marginTop: '0.5rem' }}>הכנס קצב צמיחה ושולי רווח לצפייה בתחזית</p>
          )}
        </div>
      )}

      <p className="calc-disclaimer">כלי זה מיועד למטרות לימוד בלבד ואינו מהווה ייעוץ השקעות. אין להסתמך על תוצאות המחשבון לצורך קבלת החלטות השקעה.</p>
    </div>
  );
}
