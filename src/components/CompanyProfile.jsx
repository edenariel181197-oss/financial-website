import { useState, useEffect } from 'react';
import { getProfile } from '../utils/api';

const REC_LABEL = {
  'strong_buy':  { label: 'קנייה חזקה', cls: 'rec-strong-buy' },
  'buy':         { label: 'קנייה',       cls: 'rec-buy'        },
  'hold':        { label: 'החזקה',       cls: 'rec-hold'       },
  'underperform':{ label: 'חלש',         cls: 'rec-sell'       },
  'sell':        { label: 'מכירה',       cls: 'rec-sell'       },
};

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

  const financialStats = [
    { label: 'P/E Trailing',    val: profile.peTrailing },
    { label: 'P/E Forward',     val: profile.peForward },
    { label: 'צמיחת הכנסות',   val: profile.revenueGrowth },
    { label: 'שולי רווח גולמי', val: profile.grossMargins },
    { label: 'שולי תפעולי',    val: profile.operatingMargins },
    { label: 'שולי רווח נקי',  val: profile.netMargins },
    { label: 'ROE',             val: profile.roe },
    { label: 'חוב/הון',        val: profile.debtToEquity },
    { label: 'שיא 52 שבוע',    val: profile.week52High },
    { label: 'שפל 52 שבוע',    val: profile.week52Low },
    { label: 'מחיר יעד',       val: profile.targetPrice ? `$${profile.targetPrice}` : null },
    { label: 'דיבידנד',        val: profile.dividendYield },
  ].filter(s => s.val);

  const rec = profile.recommendation ? REC_LABEL[profile.recommendation] : null;

  const ceo = profile.ceo;
  const otherOfficers = (profile.officers || []).filter(o => o !== ceo).slice(0, 7);

  return (
    <div className="profile-container">

      {/* Header */}
      <div className="profile-header">
        <h2 className="profile-company-name">{profile.name || ticker}</h2>
        {rec && <span className={`profile-rec-badge ${rec.cls}`}>{rec.label}</span>}
        {profile.website && (
          <a href={profile.website} target="_blank" rel="noopener noreferrer" className="profile-website-link">
            ↗ {profile.website.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      {/* Basic info */}
      {basicStats.length > 0 && (
        <div className="profile-stats-grid">
          {basicStats.map(s => (
            <div key={s.label} className="profile-stat-card">
              <span className="profile-stat-label">{s.label}</span>
              <span className="profile-stat-val">{s.val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Company description */}
      {summary && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ אודות החברה</h3>
          <p className="profile-description">{expanded ? summary : shortSummary}</p>
          {summary.length > 600 && (
            <button className="profile-expand-btn" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'הצג פחות ▲' : 'קרא עוד ▼'}
            </button>
          )}
        </div>
      )}

      {/* Financial highlights */}
      {financialStats.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ מדדים פיננסיים</h3>
          <div className="profile-fin-grid">
            {financialStats.map(s => (
              <div key={s.label} className="profile-fin-card">
                <span className="profile-fin-label">{s.label}</span>
                <span className="profile-fin-val">{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CEO */}
      {ceo && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ מנכ&quot;ל</h3>
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

      {/* Other officers */}
      {otherOfficers.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ הנהלה בכירה</h3>
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
