import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { getQuote, getChartData, getPriceHistory, fmtPct, fmtRaw } from '../utils/api';

const VIEWS = [
  { key: 'daily',   label: 'יומי'   },
  { key: 'weekly',  label: 'שבועי'  },
  { key: 'monthly', label: 'חודשי'  },
  { key: 'yearly',  label: 'שנתי'   },
  { key: 'fiveyr',  label: '5 שנים' },
  { key: 'all',     label: 'הכל'    },
];

function formatTime(ts, view) {
  const d = new Date(ts * 1000);
  if (view === 'daily')  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (view === 'weekly') return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric' });
  if (view === 'fiveyr') return d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
  if (view === 'all')    return d.getMonth() === 0 ? `1.1.${d.getFullYear()}` : '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

const PriceTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p style={{ color: 'var(--gold-light)', fontWeight: 700 }}>${fmtRaw(payload[0].value)}</p>
    </div>
  );
};

export default function StockData({ ticker }) {
  const [quote, setQuote] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [view, setView] = useState('monthly');
  const [chartLoading, setChartLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    Promise.all([getQuote(ticker), getChartData(ticker)])
      .then(([q, cd]) => { setQuote(q); setChartData(cd); setLoading(false); })
      .catch((e) => { setError('שגיאה: ' + e.message); setLoading(false); });
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    setChartLoading(true);
    getPriceHistory(ticker, view)
      .then(d => { setPriceHistory(d); setChartLoading(false); })
      .catch(() => setChartLoading(false));
  }, [ticker, view]);

  if (loading) return <div className="data-loading">טוען נתונים עבור {ticker}...</div>;
  if (error) return <div className="data-error">{error}</div>;
  if (!quote) return null;

  const annual = (chartData?.annual || []);
  const revGrowth = annual
    .filter(r => r.revenueGrowth != null)
    .slice(-5)
    .map(r => ({ date: r.date, value: r.revenue, growth: r.revenueGrowth }));

  const epsGrowth = annual
    .filter(r => r.epsGrowth != null)
    .slice(-5)
    .map(r => ({ date: r.date, value: r.eps, growth: r.epsGrowth }));

  const GBadge = ({ v }) => {
    if (v == null) return <span>—</span>;
    return <span className={v >= 0 ? 'positive' : 'negative'}>{v >= 0 ? '+' : ''}{(v * 100).toFixed(1)}%</span>;
  };

  const fmtMC = (mc) => {
    if (!mc) return '—';
    if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
    if (mc >= 1e9)  return `$${(mc / 1e9).toFixed(1)}B`;
    return `$${(mc / 1e6).toFixed(0)}M`;
  };

  const changePos = quote.changePercent >= 0;

  // Determine chart color: blue accent if flat/unknown, green/red for clear move
  const chartColor = changePos ? '#22C55E' : '#EF4444';

  const priceChartData = priceHistory.map(d => ({
    ...d,
    label: formatTime(d.time, view),
  }));

  const minPrice = priceChartData.length ? Math.min(...priceChartData.map(d => d.close)) * 0.999 : 0;
  const maxPrice = priceChartData.length ? Math.max(...priceChartData.map(d => d.close)) * 1.001 : 0;

  // For 'all' view: only tick at Jan 1 of each year
  const yearTicks = view === 'all'
    ? priceChartData.filter(d => d.label !== '').map(d => d.label)
    : null;

  return (
    <div className="stock-data-panel">
      {/* Row 1: Company name + price + daily change */}
      <div className="stock-header-row">
        {quote.name && (
          <div className="stock-company-name">
            {quote.name}
            <span className="stock-ticker-badge">{ticker}</span>
          </div>
        )}

        {quote.price != null && (
          <div className="stock-price-block">
            <span className="stock-price">${fmtRaw(quote.price)}</span>
            {quote.changePercent != null && (
              <span className={`stock-change ${changePos ? 'positive' : 'negative'}`}>
                {changePos ? '▲' : '▼'} {Math.abs(quote.changePercent).toFixed(2)}%
                {quote.change != null && (
                  <span className="stock-change-abs">
                    ({changePos ? '+' : ''}{fmtRaw(quote.change)})
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Price chart */}
      <div className="price-chart-wrap">
        <div className="price-chart-controls">
          {VIEWS.map(v => (
            <button
              key={v.key}
              className={`price-view-btn ${view === v.key ? 'active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {chartLoading ? (
          <div className="price-chart-loading">טוען גרף...</div>
        ) : priceChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={priceChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={chartColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#888', fontSize: 10 }}
                interval={yearTicks ? 0 : 'preserveStartEnd'}
                ticks={yearTicks || undefined}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[minPrice, maxPrice]}
                tick={{ fill: '#888', fontSize: 10 }}
                tickFormatter={v => `$${v.toFixed(0)}`}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip content={<PriceTooltip />} />
              <Area
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#priceGrad)"
                dot={false}
                activeDot={{ r: 4, fill: chartColor }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="price-chart-loading">אין נתונים</div>
        )}
      </div>

      {/* Key metrics */}
      <div className="metrics-grid">
        {[
          { label: 'שווי שוק', val: fmtMC(quote.marketCap ?? (quote.sharesOutstanding && quote.price ? quote.sharesOutstanding * quote.price : null)) },
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
            <h4>צמיחת הכנסות — שנתי (YoY)</h4>
            <table className="q-table">
              <thead><tr><th>רבעון</th><th>הכנסות</th><th>צמיחה</th></tr></thead>
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
            <h4>צמיחת EPS — שנתי (YoY)</h4>
            <table className="q-table">
              <thead><tr><th>רבעון</th><th>EPS</th><th>צמיחה</th></tr></thead>
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
