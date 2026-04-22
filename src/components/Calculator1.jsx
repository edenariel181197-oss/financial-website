import { useState, useEffect } from 'react';
import { getCalcData } from '../utils/api';

function fmtNum(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(d);
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

export default function Calculator1({ ticker }) {
  const [calcData, setCalcData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [pe5, setPe5] = useState('');
  const [discount, setDiscount] = useState('');
  const [mos, setMos] = useState('30');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setResult(null);
    getCalcData(ticker).then(d => {
      setCalcData(d);
      if (d.current?.pe) setPe5(Math.round(d.current.pe).toString());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticker]);

  const history = calcData?.history?.slice(0, 5) || [];
  const current = calcData?.current || {};

  const epsNow = current.eps;
  const analystGrowth = current.analystGrowth5y != null
    ? (current.analystGrowth5y * 100).toFixed(1)
    : '';

  const [growthRate, setGrowthRate] = useState('');

  useEffect(() => {
    if (analystGrowth) setGrowthRate(analystGrowth);
  }, [analystGrowth]);

  function calculate() {
    const eps0 = epsNow;
    const g = parseFloat(growthRate);
    const pe = parseFloat(pe5);
    const r = parseFloat(discount);
    const mosVal = parseFloat(mos);
    const mktPrice = current.price;
    if ([eps0, g, pe, r, mosVal].some(v => v == null || isNaN(v))) return;

    const eps5 = eps0 * Math.pow(1 + g / 100, 5);
    const price5 = eps5 * pe;
    const intrinsic = price5 / Math.pow(1 + r / 100, 5);
    const buyPrice = intrinsic * (1 - mosVal / 100);
    const mktPriceSafe = mktPrice ?? 0;
    const mosActual = mktPriceSafe > 0 ? ((intrinsic - mktPriceSafe) / intrinsic) * 100 : null;
    const isUnder = mktPriceSafe > 0 && mktPriceSafe <= buyPrice;

    setResult({ eps5, price5, intrinsic, buyPrice, mosActual, isUnder, mktPrice: mktPriceSafe });
  }

  const epsProjYears = [];
  if (epsNow && parseFloat(growthRate)) {
    const g = parseFloat(growthRate) / 100;
    const thisYear = new Date().getFullYear();
    for (let i = 1; i <= 5; i++) {
      epsProjYears.push({ year: thisYear + i - 1, eps: epsNow * Math.pow(1 + g, i) });
    }
  }

  return (
    <div className="calc-luxury">
      <div className="calc-lux-header">
        <h2>♦ מחשבון הערכת שווי — EPS</h2>
        {!ticker && <p className="lux-hint">הכנס טיקר חברה בראש הדף כדי לטעון נתונים אוטומטית</p>}
        {loading && <p className="lux-hint">טוען נתונים עבור {ticker}...</p>}
      </div>

      {/* Inputs */}
      <div className="lux-section">
        <h3 className="lux-section-title">♦ הנחות חישוב</h3>
        <div className="lux-inputs-grid">
          <div className="lux-input-item">
            <label>
              EPS נוכחי (TTM){' '}
              <Tooltip text="רווח למניה של 12 החודשים האחרונים (Trailing Twelve Months). מחושב מהדוחות של החברה." />
            </label>
            <div className="lux-static-val">{epsNow != null ? `$${fmtNum(epsNow)}` : '—'}</div>
          </div>
          <div className="lux-input-item">
            <label>
              קצב צמיחת רווחים % (5 שנים){' '}
              <Tooltip text="הקצב השנתי הצפוי בצמיחת ה-EPS. ניתן להסתמך על תחזיות אנליסטים או על ממוצע הצמיחה ההיסטורית." />
            </label>
            <input type="number" value={growthRate} onChange={e => setGrowthRate(e.target.value)} placeholder="לדוג׳ 15" className="lux-input" />
            {current.analystGrowth5y != null && (
              <span className="lux-hint-inline">אנליסטים: {(current.analystGrowth5y * 100).toFixed(1)}%</span>
            )}
          </div>
          <div className="lux-input-item">
            <label>
              מכפיל רווח שנה חמישית (P/E){' '}
              <Tooltip text="מכפיל הרווח שאתה מניח שהחברה תיסחר בו בשנה ה-5. לרוב מתבסס על הממוצע ההיסטורי של החברה." />
            </label>
            <input type="number" value={pe5} onChange={e => setPe5(e.target.value)} placeholder="לדוג׳ 20" className="lux-input" />
            {current.pe != null && (
              <span className="lux-hint-inline">P/E נוכחי: {fmtNum(current.pe, 1)}</span>
            )}
          </div>
          <div className="lux-input-item">
            <label>
              שיעור היוון % (תשואה רצויה){' '}
              <Tooltip text="תשואה שנתית מינימלית שאתה מצפה לקבל מהשקעה. משמש להוון המחיר העתידי להיום." />
            </label>
            <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="לדוג׳ 15" className="lux-input" />
          </div>
          <div className="lux-input-item">
            <label>
              מרווח ביטחון %{' '}
              <Tooltip text="הנחה על המחיר ההוגן לצורך הגנה מפני אי-ודאות. לדוגמה: 30% פירושו קנייה ב-70% מהשווי ההוגן." />
            </label>
            <input type="number" value={mos} onChange={e => setMos(e.target.value)} placeholder="30" className="lux-input" />
          </div>
          <div className="lux-input-item">
            <label>מחיר שוק נוכחי</label>
            <div className="lux-static-val">{current.price != null ? `$${fmtNum(current.price)}` : '—'}</div>
          </div>
        </div>
      </div>

      <button className="lux-btn" onClick={calculate}>חשב הערכת שווי</button>

      {/* Results */}
      {result && (
        <div className="lux-results">
          <div className="lux-results-grid">
            <div className="lux-result-item">
              <span>EPS שנה חמישית</span>
              <strong>${fmtNum(result.eps5)}</strong>
            </div>
            <div className="lux-result-item highlight">
              <span>מחיר מניה שנה חמישית</span>
              <strong>${fmtNum(result.price5)}</strong>
            </div>
            <div className="lux-result-item">
              <span>שווי הוגן היום</span>
              <strong>${fmtNum(result.intrinsic)}</strong>
            </div>
            <div className="lux-result-item highlight">
              <span>מחיר קנייה מקסימלי (עם MOS)</span>
              <strong className={result.isUnder ? 'green-val' : 'red-val'}>${fmtNum(result.buyPrice)}</strong>
            </div>
            <div className="lux-result-item">
              <span>מחיר שוק</span>
              <strong>${fmtNum(result.mktPrice)}</strong>
            </div>
            {result.mosActual != null && (
              <div className="lux-result-item">
                <span>מרווח ביטחון בפועל</span>
                <strong className={result.mosActual >= parseFloat(mos) ? 'green-val' : 'red-val'}>
                  {fmtNum(result.mosActual, 1)}%
                </strong>
              </div>
            )}
          </div>

          <div className={`lux-verdict ${result.isUnder ? 'verdict-buy' : 'verdict-wait'}`}>
            {result.isUnder
              ? `✅ המניה נסחרת מתחת למחיר הקנייה — מרווח ביטחון של ${fmtNum(result.mosActual, 1)}%`
              : `⏳ המניה יקרה מדי — שווי הוגן $${fmtNum(result.intrinsic)} לעומת מחיר שוק $${fmtNum(result.mktPrice)}`}
          </div>
        </div>
      )}

      {/* EPS Table — Historical + Projected */}
      <div className="lux-section" style={{ marginTop: '1.5rem' }}>
        <h3 className="lux-section-title">♦ רווח למניה (EPS) — היסטוריה ותחזית</h3>
        <div className="eps-table-wrap">
          <table className="lux-table eps-table">
            <thead>
              <tr>
                <th>שנה</th>
                {history.map(r => <th key={r.year}>{r.year}</th>)}
                {epsProjYears.map(r => <th key={r.year} className="proj-year">{r.year}E</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="row-lbl">EPS</td>
                {history.map(r => (
                  <td key={r.year} className={r.eps != null && r.eps > 0 ? 'pos-val' : 'neg-val'}>
                    {r.eps != null ? `$${fmtNum(r.eps)}` : '—'}
                  </td>
                ))}
                {epsProjYears.map(r => (
                  <td key={r.year} className="proj-val">${fmtNum(r.eps)}</td>
                ))}
              </tr>
              <tr>
                <td className="row-lbl">P/E</td>
                {history.map(r => <td key={r.year}>{r.pe != null ? fmtNum(r.pe, 1) : '—'}</td>)}
                {epsProjYears.map(r => <td key={r.year} className="proj-val">—</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="calc-disclaimer">כלי זה מיועד למטרות לימוד בלבד ואינו מהווה ייעוץ השקעות. אין להסתמך על תוצאות המחשבון לצורך קבלת החלטות השקעה.</p>
    </div>
  );
}
