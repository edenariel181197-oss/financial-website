import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { getQuote, fmt, fmtPct, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';

const MAX_TICKERS = 5;

const ROWS = [
  { label: 'מחיר', get: (q) => (q.price != null ? `$${fmtRaw(q.price)}` : '—') },
  { label: 'שווי שוק', get: (q) => (q.marketCap != null ? `$${fmt(q.marketCap)}` : '—') },
  { label: 'P/E', get: (q) => fmtRaw(q.pe) },
  { label: 'P/B', get: (q) => fmtRaw(q.pb) },
  { label: 'EV/EBITDA', get: (q) => fmtRaw(q.evToEbitda) },
  { label: 'EPS (TTM)', get: (q) => (q.eps != null ? `$${fmtRaw(q.eps)}` : '—') },
  { label: 'שולי רווח נקי', get: (q) => fmtPct(q.netMargin) },
];

export default function Compare() {
  const [inputs, setInputs] = useState(['', '', '', '', '']);
  const [quotes, setQuotes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleInputChange(i, value) {
    setInputs((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const tickers = inputs.map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS);
    if (tickers.length < 2) {
      setError('הכנס לפחות שתי מניות להשוואה');
      return;
    }
    setError(null);
    setLoading(true);
    Promise.all(tickers.map((t) => getQuote(t).then((q) => ({ ...q, symbol: q.symbol || t }))))
      .then((results) => { setQuotes(results); setLoading(false); })
      .catch((e) => { setError('שגיאה: ' + e.message); setLoading(false); });
  }

  return (
    <div className="calc-luxury">
      <SectionHeader
        title="השוואת מניות"
        description={`הכנס עד ${MAX_TICKERS} טיקרים כדי להשוות ביניהם זה לצד זה`}
        icon={ArrowLeftRight}
      />

      <div className="lux-section">
        <form className="compare-form" onSubmit={handleSubmit}>
          {inputs.map((val, i) => (
            <input
              key={i}
              className="ticker-input"
              placeholder={`טיקר ${i + 1}${i < 2 ? '' : ' (אופציונלי)'}`}
              value={val}
              onChange={(e) => handleInputChange(i, e.target.value)}
            />
          ))}
          <button className="ticker-btn" type="submit">השווה</button>
        </form>
        {error && <div className="data-error">{error}</div>}
      </div>

      {loading && <div className="data-loading">טוען נתונים...</div>}

      {quotes && !loading && (
        <div className="lux-section">
          <div className="eps-table-wrap">
            <table className="lux-table">
              <thead>
                <tr>
                  <th>מדד</th>
                  {quotes.map((q) => <th key={q.symbol}>{q.name || q.symbol}<br />{q.symbol}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="row-lbl">{row.label}</td>
                    {quotes.map((q) => <td key={q.symbol}>{row.get(q)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
