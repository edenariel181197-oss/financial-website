import { useState, useEffect } from 'react';
import { getQuote, getIncomeStatementQuarterly, fmtPct, fmtRaw } from '../utils/api';

export default function StockData({ ticker }) {
  const [quote, setQuote] = useState(null);
  const [quarterly, setQuarterly] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    Promise.all([getQuote(ticker), getIncomeStatementQuarterly(ticker)])
      .then(([q, qtr]) => { setQuote(q); setQuarterly(qtr); setLoading(false); })
      .catch((e) => { setError('שגיאה: ' + e.message); setLoading(false); });
  }, [ticker]);

  if (loading) return <div className="data-loading">טוען נתונים עבור {ticker}...</div>;
  if (error) return <div className="data-error">{error}</div>;
  if (!quote) return null;

  // YoY growth: compare quarter i to same quarter last year (index i+4)
  const revGrowth = (quarterly || []).slice(0, 8).map((q, i, arr) => {
    const prev = arr[i + 4];
    const g = prev?.revenue ? (q.revenue - prev.revenue) / Math.abs(prev.revenue) : null;
    return { date: q.date, value: q.revenue, growth: g };
  }).filter(r => r.growth != null).slice(0, 4);

  const epsGrowth = (quarterly || []).slice(0, 8).map((q, i, arr) => {
    const prev = arr[i + 4];
    const g = prev?.eps ? (q.eps - prev.eps) / Math.abs(prev.eps) : null;
    return { date: q.date, value: q.eps, growth: g };
  }).filter(r => r.growth != null).slice(0, 4);

  const GBadge = ({ v }) => {
    if (v == null) return <span>—</span>;
    return <span className={v >= 0 ? 'positive' : 'negative'}>{v >= 0 ? '+' : ''}{(v * 100).toFixed(1)}%</span>;
  };

  return (
    <div className="stock-data-panel">
      {quote.name && <div className="company-name">{quote.name} ({ticker})</div>}

      {/* Current metrics */}
      <div className="metrics-grid">
        {[
          { label: 'מחיר', val: `$${fmtRaw(quote.price)}` },
          { label: 'שווי שוק', val: (() => { const mc = quote.marketCap ?? (quote.sharesOutstanding && quote.price ? quote.sharesOutstanding * quote.price : null); if (!mc) return '—'; if (mc >= 1e12) return `$${(mc/1e12).toFixed(2)}T`; if (mc >= 1e9) return `$${(mc/1e9).toFixed(1)}B`; return `$${(mc/1e6).toFixed(0)}M`; })() },
          { label: 'P/E', val: fmtRaw(quote.pe) },

          { label: 'EPS (TTM)', val: `$${fmtRaw(quote.eps)}` },
          { label: 'שולי רווח נקי', val: fmtPct(quote.netMargin) },
        ].map(({ label, val }) => (
          <div key={label} className="metric-card">
            <span className="metric-label">{label}</span>
            <span className="metric-value">{val}</span>
          </div>
        ))}
      </div>

      {/* Quarterly growth tables */}
      <div className="quarterly-tables">
        {revGrowth.length > 0 && (
          <div className="q-table-wrap">
            <h4>קצב צמיחת הכנסות — רבעוני (YoY)</h4>
            <table className="q-table">
              <thead><tr><th>רבעון</th><th>הכנסות</th><th>צמיחה YoY</th></tr></thead>
              <tbody>
                {revGrowth.map(r => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.value ? `$${(r.value / 1e6).toFixed(0)}M` : '—'}</td>
                    <td><GBadge v={r.growth} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {epsGrowth.length > 0 && (
          <div className="q-table-wrap">
            <h4>קצב צמיחת EPS — רבעוני (YoY)</h4>
            <table className="q-table">
              <thead><tr><th>רבעון</th><th>EPS</th><th>צמיחה YoY</th></tr></thead>
              <tbody>
                {epsGrowth.map(r => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.value != null ? `$${fmtRaw(r.value)}` : '—'}</td>
                    <td><GBadge v={r.growth} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
