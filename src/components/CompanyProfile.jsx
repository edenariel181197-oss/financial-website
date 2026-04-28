import { useState, useEffect } from 'react';
import { getProfile } from '../utils/api';

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

  const ai = profile.ai || {};
  const summary = profile.summary || '';
  const shortSummary = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

  const stats = [
    { label: 'ענף',           val: profile.industry },
    { label: 'סקטור',         val: profile.sector },
    { label: 'מדינה',         val: profile.country },
    { label: 'עיר',           val: profile.city },
    { label: 'עובדים',        val: profile.employees ? Number(profile.employees).toLocaleString() : null },
    { label: 'בטא',           val: profile.beta },
    { label: 'מניות ציבוריות', val: profile.sharesFloat },
    { label: 'Short Ratio',   val: profile.shortRatio },
  ].filter(s => s.val);

  return (
    <div className="profile-container">

      {/* Company name + indices */}
      <div className="profile-header">
        <h2 className="profile-company-name">{profile.name}</h2>
        {ai.indices?.length > 0 && (
          <div className="profile-indices">
            {ai.indices.map((idx, i) => (
              <span key={i} className="profile-index-badge">{idx}</span>
            ))}
          </div>
        )}
      </div>

      {/* Stats grid */}
      {stats.length > 0 && (
        <div className="profile-stats-grid">
          {stats.map(s => (
            <div key={s.label} className="profile-stat-card">
              <span className="profile-stat-label">{s.label}</span>
              <span className="profile-stat-val">{s.val}</span>
            </div>
          ))}
          {profile.website && (
            <div className="profile-stat-card">
              <span className="profile-stat-label">אתר</span>
              <a href={profile.website} target="_blank" rel="noopener noreferrer" className="profile-link">
                {profile.website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
        </div>
      )}

      {/* AI Hebrew summary */}
      {ai.summary_he && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ אודות החברה</h3>
          <p className="profile-description">{ai.summary_he}</p>
        </div>
      )}

      {/* Fallback: Yahoo description */}
      {!ai.summary_he && summary && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ אודות החברה</h3>
          <p className="profile-description">{expanded ? summary : shortSummary}</p>
          {summary.length > 500 && (
            <button className="profile-expand-btn" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'הצג פחות ▲' : 'קרא עוד ▼'}
            </button>
          )}
        </div>
      )}

      {/* Investment thesis */}
      {ai.thesis?.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ תזת השקעה</h3>
          <ul className="profile-list">
            {ai.thesis.map((point, i) => (
              <li key={i} className="profile-list-item">
                <span className="profile-list-bullet">◆</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CEO */}
      {ai.ceo?.name && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ מנכ&quot;ל</h3>
          <div className="profile-ceo-card">
            <div className="profile-ceo-name">{ai.ceo.name}</div>
            {ai.ceo.background && (
              <div className="profile-ceo-block">
                <span className="profile-ceo-label">רקע מקצועי</span>
                <p className="profile-ceo-text">{ai.ceo.background}</p>
              </div>
            )}
            {ai.ceo.vision && (
              <div className="profile-ceo-block">
                <span className="profile-ceo-label">חזון אסטרטגי</span>
                <p className="profile-ceo-text">{ai.ceo.vision}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Technologies */}
      {ai.technologies?.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ טכנולוגיות ו-AI</h3>
          <div className="profile-tags">
            {ai.technologies.map((tech, i) => (
              <span key={i} className="profile-tag">{tech}</span>
            ))}
          </div>
        </div>
      )}

      {/* Contracts / Customers */}
      {ai.contracts?.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ לקוחות ושותפויות</h3>
          <ul className="profile-list">
            {ai.contracts.map((c, i) => (
              <li key={i} className="profile-list-item">
                <span className="profile-list-bullet">◆</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Officers */}
      {profile.officers?.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ הנהלה בכירה</h3>
          <div className="officers-grid">
            {profile.officers.map((o, i) => (
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
