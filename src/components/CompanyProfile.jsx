import { useState, useEffect } from 'react';
import { getProfile } from '../utils/api';
import KpiCard from './ui/KpiCard';
import Badge from './ui/Badge';

const TONE_TO_BADGE = { good: 'positive', bad: 'negative', neutral: 'neutral' };

const REC_LABEL = {
  'strong_buy':  { label: 'קנייה חזקה', tone: 'positive' },
  'buy':         { label: 'קנייה',       tone: 'positive' },
  'hold':        { label: 'החזקה',       tone: 'warn'     },
  'underperform':{ label: 'חלש',         tone: 'negative' },
  'sell':        { label: 'מכירה',       tone: 'negative' },
};

function fmtNum(v, decimals = 1) {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
}

export default function CompanyProfile({ ticker }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    getProfile(ticker)
      .then(d => { setProfile(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker]);

  if (!ticker) return <div className="no-ticker">הכנס טיקר לצפייה בפרופיל החברה</div>;
  if (loading) return <div className="data-loading">טוען פרופיל חברה...</div>;
  if (error) return <div className="data-error">שגיאה: {error}</div>;
  if (!profile) return null;

  const summary = profile.summary || '';
  const shortSummary = summary.length > 600 ? summary.slice(0, 600) + '...' : summary;
  const rec = profile.recommendation ? REC_LABEL[profile.recommendation] : null;

  const basicStats = [
    { label: 'ענף',           val: profile.industry },
    { label: 'סקטור',         val: profile.sector },
    { label: 'מדינה',         val: profile.country },
    { label: 'עיר',           val: profile.city },
    { label: 'עובדים',        val: profile.employees ? Number(profile.employees).toLocaleString() : null },
    { label: 'בטא',           val: profile.beta },
    { label: 'מניות ציבוריות', val: profile.sharesFloat },
    { label: 'Short Ratio',   val: profile.shortRatio },
  ].filter(s => s.val);

  const finStats = [
    { label: 'הכנסות (TTM)',    val: profile.latestRevenue },
    { label: 'רווח נקי (TTM)',  val: profile.latestNetIncome },
    { label: 'EPS (TTM)',        val: profile.latestEPS },
    { label: 'P/E Trailing',    val: profile.peTrailing },
    { label: 'צמיחת הכנסות',   val: profile.revenueGrowth },
    { label: 'שולי רווח גולמי', val: profile.grossMargins },
    { label: 'שולי רווח נקי',  val: profile.netMargins },
    { label: 'ROE',             val: profile.roe },
    { label: 'חוב כולל',       val: profile.latestDebt },
    { label: 'מזומן',          val: profile.latestCash },
    { label: 'FCF',             val: profile.latestFCF },
  ].filter(s => s.val);

  const history = profile.history || [];
  const ceo = profile.ceo;
  const otherOfficers = (profile.officers || []).filter(o => o !== ceo).slice(0, 7);
  const thesis = profile.thesis;

  const GOOD_VERDICTS = new Set(['cheap', 'strong', 'high']);
  const BAD_VERDICTS = new Set(['expensive', 'weak', 'declining', 'low', 'unprofitable']);
  const toneOf = (verdict) => GOOD_VERDICTS.has(verdict) ? 'good' : BAD_VERDICTS.has(verdict) ? 'bad' : 'neutral';

  const THESIS_CHIPS = thesis ? [
    { label: 'שווי', verdict: thesis.valuation.verdict },
    { label: 'צמיחה', verdict: thesis.growth.verdict },
    { label: 'רווחיות', verdict: thesis.profitability.verdict },
    { label: 'מאזן', verdict: thesis.health.verdict },
  ] : [];
  const overallTone = (() => {
    if (!THESIS_CHIPS.length) return 'neutral';
    const tones = THESIS_CHIPS.map(c => toneOf(c.verdict));
    const good = tones.filter(t => t === 'good').length;
    const bad = tones.filter(t => t === 'bad').length;
    if (good > bad) return 'good';
    if (bad > good) return 'bad';
    return 'neutral';
  })();

  return (
    <div className="profile-container">

      {/* Header */}
      <div className="profile-header">
        <h2 className="profile-company-name">{profile.name || ticker}</h2>
        {rec && <Badge tone={rec.tone}>{rec.label}</Badge>}
        {profile.website && (
          <a href={profile.website} target="_blank" rel="noopener noreferrer" className="profile-website-link">
            ↗ {profile.website.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      {/* Basic info (from quoteSummary — shows if not blocked) */}
      {basicStats.length > 0 && (
        <div className="profile-stats-grid">
          {basicStats.map(s => (
            <KpiCard key={s.label} title={s.label} value={s.val} />
          ))}
        </div>
      )}

      {/* Financial highlights — always available from timeseries */}
      {finStats.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">מדדים פיננסיים</h3>
          <div className="profile-fin-grid">
            {finStats.map(s => (
              <KpiCard key={s.label} title={s.label} value={s.val} />
            ))}
          </div>
        </div>
      )}

      {/* Investment thesis — rule-based, always available (no FMP dependency) */}
      {thesis && (
        <div className="profile-section">
          <h3 className="profile-section-title">תזה השקעה</h3>
          <div className="thesis-chips">
            {THESIS_CHIPS.map(c => (
              <Badge key={c.label} tone={TONE_TO_BADGE[toneOf(c.verdict)]}>{c.label}</Badge>
            ))}
          </div>
          <div className={`lux-verdict verdict-${overallTone === 'good' ? 'buy' : overallTone === 'bad' ? 'wait' : 'neutral'}`}>
            {thesis.summary}
          </div>
          {thesis.context && thesis.context.length > 0 && (
            <div className="thesis-context">
              <h4>רקע נוסף</h4>
              <ul>{thesis.context.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          {(thesis.strengths.length > 0 || thesis.risks.length > 0) && (
            <div className="thesis-lists">
              {thesis.strengths.length > 0 && (
                <div className="thesis-list thesis-list-good">
                  <h4>חוזקות</h4>
                  <ul>{thesis.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {thesis.risks.length > 0 && (
                <div className="thesis-list thesis-list-bad">
                  <h4>נקודות לתשומת לב</h4>
                  <ul>{thesis.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5-year history table — always available from timeseries */}
      {history.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">היסטוריה פיננסית (5 שנים)</h3>
          <div className="profile-history-wrap">
            <table className="profile-history-table">
              <thead>
                <tr>
                  <th>שנה</th>
                  <th>הכנסות</th>
                  <th>רווח נקי</th>
                  <th>EPS</th>
                  <th>P/E</th>
                </tr>
              </thead>
              <tbody>
                {history.map(row => (
                  <tr key={row.year}>
                    <td className="profile-hist-year">{row.year}</td>
                    <td>{row.revenue   != null ? '$' + (row.revenue   / 1e9).toFixed(1) + 'B' : '—'}</td>
                    <td>{row.netIncome != null ? '$' + (row.netIncome / 1e9).toFixed(1) + 'B' : '—'}</td>
                    <td>{row.eps      != null ? '$' + fmtNum(row.eps, 2)               : '—'}</td>
                    <td>{row.pe       != null ? fmtNum(row.pe, 1)                       : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Company description (bonus — from quoteSummary) */}
      {summary && (
        <div className="profile-section">
          <h3 className="profile-section-title">אודות החברה</h3>
          <p className="profile-description">{expanded ? summary : shortSummary}</p>
          {summary.length > 600 && (
            <button className="profile-expand-btn" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'הצג פחות ▲' : 'קרא עוד ▼'}
            </button>
          )}
        </div>
      )}

      {/* CEO card (bonus — from quoteSummary) */}
      {ceo && (
        <div className="profile-section">
          <h3 className="profile-section-title">מנכ&quot;ל</h3>
          <div className="profile-ceo-card">
            <div className="profile-ceo-name">{ceo.name}</div>
            <div className="profile-ceo-title">{ceo.title}</div>
            <div className="profile-ceo-meta">
              {ceo.age && <span className="profile-ceo-chip">גיל: {ceo.age}</span>}
              {ceo.pay && <span className="profile-ceo-chip">שכר: {ceo.pay}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Other officers (bonus — from quoteSummary) */}
      {otherOfficers.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">הנהלה בכירה</h3>
          <div className="officers-grid">
            {otherOfficers.map((o, i) => (
              <div key={i} className="officer-card">
                <div className="officer-name">{o.name}</div>
                <div className="officer-title">{o.title}</div>
                {o.pay && <div className="officer-pay">שכר: {o.pay}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
