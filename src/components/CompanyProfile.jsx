import { useState, useEffect } from 'react';
import { getProfile, fmtRaw } from '../utils/api';

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
  const shortSummary = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

  const stats = [
    { label: 'ענף', val: profile.industry },
    { label: 'סקטור', val: profile.sector },
    { label: 'מדינה', val: profile.country },
    { label: 'עיר', val: profile.city },
    { label: 'עובדים', val: profile.employees ? Number(profile.employees).toLocaleString() : null },
    { label: 'בטא', val: profile.beta },
    { label: 'מניות ציבוריות', val: profile.sharesFloat },
    { label: 'Short Ratio', val: profile.shortRatio },
  ].filter(s => s.val);

  return (
    <div className="profile-container">
      {/* Stats */}
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

      {/* Description */}
      {summary && (
        <div className="profile-section">
          <h3 className="profile-section-title">♦ אודות החברה</h3>
          <p className="profile-description">
            {expanded ? summary : shortSummary}
          </p>
          {summary.length > 500 && (
            <button className="profile-expand-btn" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'הצג פחות ▲' : 'קרא עוד ▼'}
            </button>
          )}
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
