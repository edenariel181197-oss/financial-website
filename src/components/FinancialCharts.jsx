import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { getChartData, getEstimates, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';

const fmtB = (v) => v == null ? '—' : `$${(v / 1e9).toFixed(1)}B`;

const COLORS = {
  revenue: '#4F82C8', netIncome: '#22C55E',
  assets: '#7AA3D8', liabilities: '#EF4444',
  cash: '#F59E0B', pe: '#9B8BD4',
  pos: '#22C55E', neg: '#EF4444',
  operating: '#4F8CFF', investing: '#9B8BD4', financing: '#38BDF8',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && Math.abs(p.value) > 1e8 ? fmtB(p.value) : typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  );
};

const GrowthTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="chart-tooltip">
      <p className="tooltip-label">{label}</p>
      <p style={{ color: val >= 0 ? COLORS.pos : COLORS.neg, fontWeight: 700 }}>
        {payload[0]?.name}: {val != null ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : '—'}
      </p>
    </div>
  );
};

const fmtAbsVal = (v, isRevenue) => {
  if (v == null) return '—';
  if (isRevenue) return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
  return `$${Number(v).toFixed(2)}`;
};

const AbsTooltip = ({ active, payload, label, isRevenue }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="tooltip-label">{label}</p>
      <p style={{ color: COLORS.revenue, fontWeight: 700 }}>
        {payload[0]?.name}: {fmtAbsVal(payload[0]?.value, isRevenue)}
      </p>
    </div>
  );
};

function GrowthChart({ title, dataKey, valueKey, label, data }) {
  const [mode, setMode] = useState('annual');
  const isQuarterly = mode === 'quarterly';
  const isRevenue = valueKey === 'revenue';

  // Annual: YoY growth %; Quarterly: absolute values for last 12 quarters (3 years)
  const annualChartData = (data.annual || [])
    .filter(d => d[dataKey] != null)
    .map(d => ({ ...d, pct: +(d[dataKey] * 100).toFixed(1) }));

  const quarterlyChartData = (data.quarterly || [])
    .filter(d => d[valueKey] != null)
    .slice(-12);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>{isQuarterly ? title.replace('YoY %', 'רבעוני — 3 שנים') : title}</h3>
        <div className="chart-toggle">
          <button className={!isQuarterly ? 'active' : ''} onClick={() => setMode('annual')}>שנתי</button>
          <button className={isQuarterly ? 'active' : ''} onClick={() => setMode('quarterly')}>רבעוני</button>
        </div>
      </div>

      {isQuarterly ? (
        quarterlyChartData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתונים רבעוניים</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={quarterlyChartData} margin={{ top: 10, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={45} />
              <YAxis tickFormatter={v => fmtAbsVal(v, isRevenue)} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={60} />
              <Tooltip content={<AbsTooltip isRevenue={isRevenue} />} />
              <Bar dataKey={valueKey} name={label} fill={isRevenue ? COLORS.revenue : COLORS.pe} radius={[4, 4, 0, 0]}>
                {quarterlyChartData.map((d, i) => (
                  <Cell key={i} fill={isRevenue ? COLORS.revenue : (d[valueKey] >= 0 ? COLORS.pos : COLORS.neg)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      ) : (
        annualChartData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתוני צמיחה זמינים</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={annualChartData} margin={{ top: 10, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip content={<GrowthTooltip />} />
              <ReferenceLine y={0} stroke="rgba(79,130,200,0.5)" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="pct" name={label} radius={[4, 4, 0, 0]}>
                {annualChartData.map((d, i) => (
                  <Cell key={i} fill={d.pct >= 0 ? COLORS.pos : COLORS.neg} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      )}
    </div>
  );
}

export default function FinancialCharts({ ticker }) {
  const [charts, setCharts] = useState(null);
  const [estimates, setEstimates] = useState(null);
  const [incomeMode, setIncomeMode] = useState('annual');
  const [assetsMode, setAssetsMode] = useState('annual');
  const [cashMode, setCashMode] = useState('annual');
  const [peMode, setPeMode] = useState('annual');
  const [cfMode, setCfMode] = useState('annual');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    Promise.all([getChartData(ticker), getEstimates(ticker)])
      .then(([c, e]) => { setCharts(c); setEstimates(e); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!ticker) return null;
  if (loading) return <div className="data-loading">טוען גרפים...</div>;
  if (!charts) return null;

  const incomeData = incomeMode === 'annual' ? charts.annual : (charts.quarterly || []).slice(-16);
  const assetsData = (assetsMode === 'annual' ? charts.annual : (charts.quarterly || []).slice(-16))
    .filter(d => d.totalAssets != null || d.totalLiabilities != null);
  const cashData = (cashMode === 'annual' ? charts.annual : (charts.quarterly || []).slice(-16))
    .filter(d => d.cashChange != null);
  const peData = (peMode === 'annual' ? charts.annual : (charts.quarterly || []).slice(-16))
    .filter(d => d.pe != null);
  const cfData = (cfMode === 'annual' ? charts.annual : (charts.quarterly || []).slice(-16))
    .filter(d => d.operatingCashFlow != null || d.investingCashFlow != null || d.financingCashFlow != null);

  return (
    <>
    <SectionHeader title="גרפים ותחזיות" description="ניתוח ויזואלי של נתונים פיננסיים היסטוריים ותחזיות עתידיות" icon={BarChart3} />
    <div className="charts-section">

      {/* הכנסות מול רווח נקי */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>הכנסות מול רווח נקי</h3>
          <div className="chart-toggle">
            <button className={incomeMode === 'annual' ? 'active' : ''} onClick={() => setIncomeMode('annual')}>שנתי</button>
            <button className={incomeMode === 'quarterly' ? 'active' : ''} onClick={() => setIncomeMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={incomeData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
            <defs>
              <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.revenue} stopOpacity={0.95} />
                <stop offset="95%" stopColor={COLORS.revenue} stopOpacity={0.55} />
              </linearGradient>
              <linearGradient id="netIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.netIncome} stopOpacity={0.95} />
                <stop offset="95%" stopColor={COLORS.netIncome} stopOpacity={0.55} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: incomeMode === 'quarterly' ? 10 : 11 }} interval={incomeMode === 'quarterly' ? 0 : undefined} angle={incomeMode === 'quarterly' ? -35 : 0} textAnchor={incomeMode === 'quarterly' ? 'end' : 'middle'} height={incomeMode === 'quarterly' ? 45 : 30} />
            <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
            <Bar dataKey="revenue"   name="הכנסות"   fill="url(#revenueGrad)"   radius={[4, 4, 0, 0]} />
            <Bar dataKey="netIncome" name="רווח נקי" fill="url(#netIncomeGrad)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* קצב צמיחת הכנסות */}
      <GrowthChart
        title="קצב צמיחת הכנסות — YoY %"
        dataKey="revenueGrowth"
        valueKey="revenue"
        label="הכנסות"
        data={charts}
      />

      {/* קצב צמיחת EPS */}
      <GrowthChart
        title="קצב צמיחת EPS — YoY %"
        dataKey="epsGrowth"
        valueKey="eps"
        label="EPS"
        data={charts}
      />

      {/* נכסים מול התחייבויות */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>סך נכסים מול סך התחייבויות</h3>
          <div className="chart-toggle">
            <button className={assetsMode === 'annual' ? 'active' : ''} onClick={() => setAssetsMode('annual')}>שנתי</button>
            <button className={assetsMode === 'quarterly' ? 'active' : ''} onClick={() => setAssetsMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        {assetsData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתונים רבעוניים</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={assetsData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
              <defs>
                <linearGradient id="assetsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.assets} stopOpacity={0.95} />
                  <stop offset="95%" stopColor={COLORS.assets} stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="liabGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.liabilities} stopOpacity={0.95} />
                  <stop offset="95%" stopColor={COLORS.liabilities} stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: assetsMode === 'quarterly' ? 10 : 11 }} interval={assetsMode === 'quarterly' ? 0 : undefined} angle={assetsMode === 'quarterly' ? -35 : 0} textAnchor={assetsMode === 'quarterly' ? 'end' : 'middle'} height={assetsMode === 'quarterly' ? 45 : 30} />
              <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
              <Bar dataKey="totalAssets"      name="סך נכסים"      fill="url(#assetsGrad)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalLiabilities" name="סך התחייבויות" fill="url(#liabGrad)"   radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* שינוי במזומנים */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>שינוי במזומנים</h3>
          <div className="chart-toggle">
            <button className={cashMode === 'annual' ? 'active' : ''} onClick={() => setCashMode('annual')}>שנתי</button>
            <button className={cashMode === 'quarterly' ? 'active' : ''} onClick={() => setCashMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        {cashData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתונים רבעוניים</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cashData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: cashMode === 'quarterly' ? 10 : 11 }} interval={cashMode === 'quarterly' ? 0 : undefined} angle={cashMode === 'quarterly' ? -35 : 0} textAnchor={cashMode === 'quarterly' ? 'end' : 'middle'} height={cashMode === 'quarterly' ? 45 : 30} />
              <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="rgba(79,130,200,0.5)" strokeDasharray="4 4" />
              <Bar dataKey="cashChange" name="שינוי במזומנים" fill={COLORS.cash} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* תזרים מזומנים: שוטף / השקעה / מימון */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>תזרים מזומנים — שוטף, השקעה ומימון</h3>
          <div className="chart-toggle">
            <button className={cfMode === 'annual' ? 'active' : ''} onClick={() => setCfMode('annual')}>שנתי</button>
            <button className={cfMode === 'quarterly' ? 'active' : ''} onClick={() => setCfMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        {cfData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתונים רבעוניים</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cfData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: cfMode === 'quarterly' ? 10 : 11 }} interval={cfMode === 'quarterly' ? 0 : undefined} angle={cfMode === 'quarterly' ? -35 : 0} textAnchor={cfMode === 'quarterly' ? 'end' : 'middle'} height={cfMode === 'quarterly' ? 45 : 30} />
              <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
              <Bar dataKey="operatingCashFlow" name="תזרים שוטף" fill={COLORS.operating} radius={[4, 4, 0, 0]} />
              <Bar dataKey="investingCashFlow" name="תזרים השקעה" fill={COLORS.investing} radius={[4, 4, 0, 0]} />
              <Bar dataKey="financingCashFlow" name="תזרים מימון" fill={COLORS.financing} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* P/E היסטורי */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>היסטוריית מכפיל רווח (P/E)</h3>
          <div className="chart-toggle">
            <button className={peMode === 'annual' ? 'active' : ''} onClick={() => setPeMode('annual')}>שנתי</button>
            <button className={peMode === 'quarterly' ? 'active' : ''} onClick={() => setPeMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        {peData.length === 0 ? (
          <p style={{ color: 'var(--slate)', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>אין נתונים רבעוניים</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={peData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: peMode === 'quarterly' ? 10 : 11 }} interval={peMode === 'quarterly' ? 0 : undefined} angle={peMode === 'quarterly' ? -35 : 0} textAnchor={peMode === 'quarterly' ? 'end' : 'middle'} height={peMode === 'quarterly' ? 45 : 30} />
              <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="pe" name="P/E" stroke={COLORS.pe} strokeWidth={2.5} dot={{ fill: COLORS.pe, r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* תחזית EPS */}
      {estimates?.epsEstimates?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <div className="chart-header"><h3>תחזית רווח עתידי למניה (EPS)</h3></div>
          <table className="estimates-table">
            <thead>
              <tr>
                <th>תקופה</th>
                <th>EPS שנה קודמת</th>
                <th>EPS נמוך</th>
                <th>EPS ממוצע</th>
                <th>EPS גבוה</th>
                <th>הכנסות משוערות</th>
                <th>צמיחת EPS</th>
              </tr>
            </thead>
            <tbody>
              {estimates.epsEstimates.map((row, i) => (
                <tr key={i}>
                  <td><strong>{row.period}</strong></td>
                  <td className="number">{row.yearAgoEps != null ? `$${fmtRaw(row.yearAgoEps)}` : '—'}</td>
                  <td className="number">{row.epsLow != null ? `$${fmtRaw(row.epsLow)}` : '—'}</td>
                  <td className="number accent">{row.epsMid != null ? `$${fmtRaw(row.epsMid)}` : row.isPct ? `${((row.growthRate || 0) * 100).toFixed(1)}% שנתי` : '—'}</td>
                  <td className="number">{row.epsHigh != null ? `$${fmtRaw(row.epsHigh)}` : '—'}</td>
                  <td className="number">{row.revenueAvg != null ? fmtB(row.revenueAvg) : '—'}</td>
                  <td className={`number ${row.growthRate >= 0 ? 'positive' : 'negative'}`}>
                    {row.growthRate != null ? `${(row.growthRate * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
}
