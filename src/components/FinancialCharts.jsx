import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { getChartData, getEstimates, fmtRaw } from '../utils/api';

const B = (n) => n == null ? null : (n / 1e9).toFixed(1);
const fmtB = (v) => v == null ? '—' : `$${(v / 1e9).toFixed(1)}B`;
const fmtPctLocal = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

const COLORS = { revenue: '#C5A059', netIncome: '#4ECDC4', assets: '#7EB8D4', liabilities: '#F07070', cash: '#D4B483', pe: '#B8A0D4' };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && Math.abs(p.value) > 1e8 ? fmtB(p.value) : p.value?.toFixed?.(1) ?? p.value}
        </p>
      ))}
    </div>
  );
};

export default function FinancialCharts({ ticker }) {
  const [charts, setCharts] = useState(null);
  const [estimates, setEstimates] = useState(null);
  const [incomeMode, setIncomeMode] = useState('annual');
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

  const incomeData = incomeMode === 'annual' ? charts.annual : charts.quarterly;

  return (
    <div className="charts-section">
      {/* Income Chart */}
      <div className="chart-card">
        <div className="chart-header">
          <h3>הכנסות מול רווח נקי</h3>
          <div className="chart-toggle">
            <button className={incomeMode === 'annual' ? 'active' : ''} onClick={() => setIncomeMode('annual')}>שנתי</button>
            <button className={incomeMode === 'quarterly' ? 'active' : ''} onClick={() => setIncomeMode('quarterly')}>רבעוני</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={incomeData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
            <XAxis dataKey="date" tick={{ fill: '#8892A4', fontSize: 11 }} />
            <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: '#8892A4', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: '#8892A4', fontSize: 12 }} />
            <Bar dataKey="revenue" name="הכנסות" fill={COLORS.revenue} radius={[4, 4, 0, 0]} />
            <Bar dataKey="netIncome" name="רווח נקי" fill={COLORS.netIncome} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Assets vs Liabilities */}
      <div className="chart-card">
        <div className="chart-header"><h3>סך נכסים מול סך התחייבויות</h3></div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.annual} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
            <XAxis dataKey="date" tick={{ fill: '#8892A4', fontSize: 11 }} />
            <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: '#8892A4', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: '#8892A4', fontSize: 12 }} />
            <Bar dataKey="totalAssets" name="סך נכסים" fill={COLORS.assets} radius={[4, 4, 0, 0]} />
            <Bar dataKey="totalLiabilities" name="סך התחייבויות" fill={COLORS.liabilities} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cash Change */}
      <div className="chart-card">
        <div className="chart-header"><h3>שינוי בשווי מזומנים (שנתי)</h3></div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={charts.annual} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
            <XAxis dataKey="date" tick={{ fill: '#8892A4', fontSize: 11 }} />
            <YAxis tickFormatter={v => `$${(v / 1e9).toFixed(0)}B`} tick={{ fill: '#8892A4', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#C5A059" strokeDasharray="4 4" />
            <Bar dataKey="cashChange" name="שינוי במזומנים"
              fill={COLORS.cash}
              radius={[4, 4, 0, 0]}
              label={false}
              // Color bars by positive/negative
              isAnimationActive={true}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* P/E History */}
      <div className="chart-card">
        <div className="chart-header"><h3>היסטוריית מכפיל רווח (P/E) — 5 שנים</h3></div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={charts.annual.filter(d => d.pe != null)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
            <XAxis dataKey="date" tick={{ fill: '#8892A4', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8892A4', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="pe" name="P/E" stroke={COLORS.pe} strokeWidth={2.5} dot={{ fill: COLORS.pe, r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* EPS Estimates */}
      {estimates?.epsEstimates?.length > 0 && (
        <div className="chart-card">
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
                  <td className="number accent">{row.epsMid != null ? `$${fmtRaw(row.epsMid)}` : row.isPct ? `${((row.growthRate||0)*100).toFixed(1)}% שנתי` : '—'}</td>
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
  );
}
