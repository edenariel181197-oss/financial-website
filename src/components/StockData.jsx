import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Landmark, Divide, DollarSign, Percent, CalendarClock } from 'lucide-react';
import { getQuote, getChartData, getPriceHistory, getProfile, fmtPct, fmtRaw } from '../utils/api';
import KpiCard from './ui/KpiCard';
import useCountUp from './ui/useCountUp';
import AiInsights from './ui/AiInsights';

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
  if (view === 'yearly') return d.getFullYear().toString();
  if (view === 'fiveyr') return d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
  if (view === 'all')    return d.getMonth() === 0 ? `1.1.${d.getFullYear()}` : '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

const PriceTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label && <p className="tooltip-label">{label}</p>}
      <p style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '1rem' }}>${fmtRaw(payload[0].value)}</p>
    </div>
  );
};

export default function StockData({ ticker, showInsights = true }) {
  const [quote, setQuote] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [view, setView] = useState('monthly');
  const [chartLoading, setChartLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [thesis, setThesis] = useState(null);

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

  // Fetched independently — reuses the same rule-based thesis already computed
  // for the Company Profile page (server/index.cjs buildThesis), just surfaced
  // here too, right under the chart. No new business logic.
  useEffect(() => {
    if (!ticker) return;
    setThesis(null);
    getProfile(ticker)
      .then(p => setThesis(p.thesis || null))
      .catch(() => setThesis(null));
  }, [ticker]);

  const animatedPrice = useCountUp(quote?.price);

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

  // Determine chart color: green/red for clear move
  const chartColor = changePos ? '#22C55E' : '#EF4444';

  const priceChartData = priceHistory.map(d => ({
    ...d,
    label: formatTime(d.time, view),
  }));

  const minPrice = priceChartData.length ? Math.min(...priceChartData.map(d => d.close)) * 0.999 : 0;
  const maxPrice = priceChartData.length ? Math.max(...priceChartData.map(d => d.close)) * 1.001 : 0;

  // 'all' view: only Jan ticks; 'yearly': every point is a year — show all
  const yearTicks = view === 'all'
    ? priceChartData.filter(d => d.label !== '').map(d => d.label)
    : view === 'yearly'
      ? priceChartData.map(d => d.label)
      : null;

  return (
    <div className="stock-data-panel">
      {/* Hero: company identity → price (visual focus) → daily change */}
      <div className="stock-hero">
        <div className="stock-hero-identity">
          {quote.name && <span className="stock-company-name">{quote.name}</span>}
          <span className="stock-ticker-badge">{ticker}</span>
        </div>

        {quote.price != null && (
          <div className="stock-hero-price-row">
            <span className="stock-price">${fmtRaw(animatedPrice ?? quote.price)}</span>
            {quote.changePercent != null && (
              <span className={`stock-change-badge ${changePos ? 'positive' : 'negative'}`}>
                {changePos ? <TrendingUp size={15} strokeWidth={2.5} /> : <TrendingDown size={15} strokeWidth={2.5} />}
                {Math.abs(quote.changePercent).toFixed(2)}%
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
          <ResponsiveContainer width="100%" height={380}>
            <AreaChart data={priceChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={chartColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                interval={yearTicks ? 0 : 'preserveStartEnd'}
                ticks={yearTicks || undefined}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[minPrice, maxPrice]}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                tickFormatter={v => `$${v.toFixed(0)}`}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                content={<PriceTooltip />}
                cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={2.5}
                fill="url(#priceGrad)"
                dot={false}
                activeDot={{ r: 5, fill: chartColor, stroke: 'var(--card)', strokeWidth: 2 }}
                animationDuration={700}
                animationEasing="ease-out"
                style={{ filter: `drop-shadow(0 0 6px ${chartColor}66)` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="price-chart-loading">אין נתונים</div>
        )}
      </div>

      {/* AI Insights — rule-based thesis summary, only on the main page */}
      {showInsights && <AiInsights thesis={thesis} />}

      {/* Key metrics */}
      <div className="metrics-grid">
        {[
          { label: 'שווי שוק', val: fmtMC(quote.marketCap ?? (quote.sharesOutstanding && quote.price ? quote.sharesOutstanding * quote.price : null)), icon: Landmark },
          { label: 'P/E', val: fmtRaw(quote.pe), icon: Divide },
          { label: 'P/E עתידי', val: fmtRaw(quote.forwardPE), icon: CalendarClock },
          { label: 'EPS (TTM)', val: `$${fmtRaw(quote.eps)}`, icon: DollarSign },
          { label: 'שולי רווח נקי', val: fmtPct(quote.netMargin), icon: Percent },
        ].map(({ label, val, icon }) => (
          <KpiCard key={label} title={label} value={val} icon={icon} />
        ))}
      </div>

      {/* Quarterly growth tables — only on the main page */}
      {showInsights && (
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
      )}
    </div>
  );
}
