import { useState, useEffect } from 'react';
import { getNews } from '../utils/api';

function timeAgo(ts) {
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 3600)  return `לפני ${Math.floor(diff / 60)} דקות`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שעות`;
  return `לפני ${Math.floor(diff / 86400)} ימים`;
}

export default function StockNews({ ticker }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setNews([]);
    getNews(ticker)
      .then(d => { setNews(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker]);

  if (!ticker) return <div className="no-ticker">הכנס טיקר לצפייה בחדשות</div>;
  if (loading) return <div className="data-loading">טוען חדשות...</div>;
  if (error) return <div className="data-error">שגיאה: {error}</div>;
  if (!news.length) return <div className="no-ticker">לא נמצאו חדשות</div>;

  return (
    <div className="news-container">
      <h3 className="news-header">♦ חדשות אחרונות — {ticker}</h3>
      <div className="news-list">
        {news.map((item, i) => (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="news-card"
          >
            {item.thumbnail && (
              <img src={item.thumbnail} alt="" className="news-thumb" />
            )}
            <div className="news-body">
              <div className="news-meta">
                <span className="news-source">{item.publisher}</span>
                <span className="news-dot">·</span>
                <span className="news-time">{timeAgo(item.time)}</span>
              </div>
              <h4 className="news-title">{item.title}</h4>
            </div>
            <span className="news-arrow">›</span>
          </a>
        ))}
      </div>
    </div>
  );
}
