import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { getQuote, fmt, fmtPct, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';
import Tooltip from './ui/Tooltip';

const MAX_TICKERS = 5;
const MIN_TICKERS = 2;

const ROWS = [
  {
    key: 'pe', label: 'מכפיל רווח (P/E)',
    tooltip: 'מחיר המניה חלקי הרווח למניה - כמה משלמים על כל דולר של רווח שנתי',
    get: (q) => fmtRaw(q.pe),
  },
  {
    key: 'revenueGrowth', label: 'צמיחת הכנסות (YoY)',
    tooltip: 'קצב הגידול בהכנסות לעומת אותה תקופה אשתקד',
    get: (q) => fmtPct(q.revenueGrowth),
  },
  {
    key: 'operatingMargin', label: 'שולי רווח תפעולי',
    tooltip: 'אחוז מההכנסות שהופך לרווח מהפעילות הליבה, לפני ריבית ומס',
    get: (q) => fmtPct(q.operatingMargin),
  },
  {
    key: 'roe', label: 'תשואה על ההון (ROE)',
    tooltip: 'רווח נקי חלקי הון עצמי - כמה יעילה החברה בהפקת רווח מכסף בעלי המניות',
    get: (q) => fmtPct(q.roe),
  },
  {
    key: 'freeCashFlow', label: 'תזרים מזומנים חופשי (FCF)',
    tooltip: 'המזומן שנותר לחברה אחרי כל ההוצאות התפעוליות וההשקעות ברכוש קבוע',
    get: (q) => (q.freeCashFlow != null ? `$${fmt(q.freeCashFlow)}` : '—'),
  },
  {
    key: 'debtToEquity', label: 'יחס חוב להון (D/E)',
    tooltip: 'סך החוב חלקי ההון העצמי - ככל שגבוה יותר כך המינוף הפיננסי גבוה יותר',
    get: (q) => (q.debtToEquity != null ? `${fmtRaw(q.debtToEquity)}x` : '—'),
  },
  {
    key: 'dividendYield', label: 'תשואת דיבידנד',
    tooltip: 'הדיבידנד השנתי כאחוז ממחיר המניה הנוכחי',
    get: (q) => fmtPct(q.dividendYield),
  },
];

export default function Compare() {
  const [quotes, setQuotes] = useState([]);
  const [pendingInput, setPendingInput] = useState('');
  const [addingSlot, setAddingSlot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function addTicker(raw) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) { setAddingSlot(false); return; }
    if (quotes.some((q) => q.symbol === symbol)) {
      setError(`${symbol} כבר בהשוואה`);
      return;
    }
    if (quotes.length >= MAX_TICKERS) return;
    setError(null);
    setLoading(true);
    try {
      const q = await getQuote(symbol);
      setQuotes((prev) => [...prev, { ...q, symbol: q.symbol || symbol }]);
      setPendingInput('');
      setAddingSlot(false);
    } catch {
      setError(`לא נמצאו נתונים עבור ${symbol}`);
    } finally {
      setLoading(false);
    }
  }

  function removeTicker(symbol) {
    setQuotes((prev) => prev.filter((q) => q.symbol !== symbol));
  }

  const hasTable = quotes.length >= MIN_TICKERS;

  return (
    <div className="calc-luxury">
      <SectionHeader
        title="השוואת מניות"
        description={`השוו בין ${MIN_TICKERS} ל-${MAX_TICKERS} מניות זו לצד זו לפי 7 מדדי יסוד`}
        icon={ArrowLeftRight}
      />

      {!hasTable && (
        <div className="lux-section">
          <form
            className="compare-form"
            onSubmit={(e) => { e.preventDefault(); addTicker(pendingInput); }}
          >
            <input
              className="ticker-input"
              placeholder="הכנס טיקר, למשל AAPL"
              value={pendingInput}
              onChange={(e) => setPendingInput(e.target.value)}
            />
            <button className="ticker-btn" type="submit" disabled={loading}>
              {loading ? 'טוען...' : 'הוסף לטבלה'}
            </button>
          </form>
          {quotes.length > 0 && (
            <div className="compare-seed-chips">
              {quotes.map((q) => (
                <span key={q.symbol} className="compare-seed-chip">
                  {q.symbol}
                  <button onClick={() => removeTicker(q.symbol)} aria-label="הסר">✕</button>
                </span>
              ))}
            </div>
          )}
          <p className="lux-hint" style={{ marginTop: '0.75rem' }}>
            הוסיפו לפחות {MIN_TICKERS} חברות כדי לפתוח את טבלת ההשוואה
          </p>
        </div>
      )}

      {error && <div className="data-error">{error}</div>}

      {hasTable && (
        <div className="lux-section">
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th className="compare-row-label-col"></th>
                  {quotes.map((q) => (
                    <th key={q.symbol}>
                      <div className="compare-company-head">
                        <button
                          className="compare-remove-btn"
                          onClick={() => removeTicker(q.symbol)}
                          aria-label={`הסר ${q.symbol}`}
                          title="הסר מההשוואה"
                        >
                          ✕
                        </button>
                        <div className="compare-company-name">{q.name || q.symbol}</div>
                        <div className="compare-company-ticker">${q.symbol}</div>
                      </div>
                    </th>
                  ))}
                  {quotes.length < MAX_TICKERS && (
                    <th className="compare-add-col">
                      {addingSlot ? (
                        <form onSubmit={(e) => { e.preventDefault(); addTicker(pendingInput); }}>
                          <input
                            autoFocus
                            className="compare-add-input"
                            value={pendingInput}
                            onChange={(e) => setPendingInput(e.target.value)}
                            onBlur={() => { if (!pendingInput) setAddingSlot(false); }}
                            placeholder="טיקר"
                          />
                        </form>
                      ) : (
                        <button
                          className="compare-add-btn"
                          onClick={() => setAddingSlot(true)}
                          aria-label="הוסף חברה"
                          title="הוסף חברה להשוואה"
                        >
                          +
                        </button>
                      )}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.key}>
                    <td className="compare-row-label">
                      <span className="compare-row-label-inner">
                        {row.label}
                        <Tooltip text={row.tooltip} />
                      </span>
                    </td>
                    {quotes.map((q) => (
                      <td key={q.symbol}>{row.get(q)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && <div className="data-loading">טוען...</div>}
        </div>
      )}
    </div>
  );
}
