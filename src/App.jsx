import { useState } from 'react';
import Calculator1 from './components/Calculator1';
import Calculator2 from './components/Calculator2';
import FinancialReports from './components/FinancialReports';
import FinancialCharts from './components/FinancialCharts';
import StockData from './components/StockData';
import './App.css';

const NAV = [
  { icon: '◈', label: 'מחשבון EPS', sub: 'הערכת שווי DCF' },
  { icon: '◉', label: 'מחשבון הכנסות', sub: 'תרחישי מכפיל' },
  { icon: '≡', label: 'דוחות כספיים', sub: 'מאזן · רווח · תזרים' },
  { icon: '∿', label: 'גרפים ותחזיות', sub: 'ניתוח ויזואלי' },
];

export default function App() {
  const [page, setPage] = useState(0);
  const [tickerInput, setTickerInput] = useState('');
  const [ticker, setTicker] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function handleSearch(e) {
    e.preventDefault();
    const t = tickerInput.trim().toUpperCase();
    if (t) setTicker(t);
  }

  function handleNavClick(i) {
    setPage(i);
    setMobileNavOpen(false);
  }

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''}`} dir="rtl">

      {/* Mobile backdrop */}
      {mobileNavOpen && <div className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-diamond">◈</div>
          <div className="brand-text">
            <h1 className="brand-name">Valuate</h1>
            <p className="brand-sub">כלי ניתוח מקצועי</p>
          </div>
        </div>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {NAV.map((item, i) => (
            <button
              key={i}
              className={`nav-item ${page === i ? 'active' : ''}`}
              onClick={() => handleNavClick(i)}
            >
              <span className="nav-icon">{item.icon}</span>
              <div className="nav-labels">
                <span className="nav-label">{item.label}</span>
                <span className="nav-sub">{item.sub}</span>
              </div>
              {page === i && <span className="nav-pip" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p>כלי זה מיועד למטרות לימוד בלבד ואינו מהווה ייעוץ השקעות</p>
        </div>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">

        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-top-row">
            <div className="topbar-right">
              <button className="collapse-btn desktop-only" onClick={() => setSidebarCollapsed(v => !v)}>
                {sidebarCollapsed ? '▶' : '◀'}
              </button>
              <button className="collapse-btn mobile-only" onClick={() => setMobileNavOpen(v => !v)}>
                ☰
              </button>
              <div className="topbar-page-title">
                <span className="topbar-icon">{NAV[page].icon}</span>
                <span>{NAV[page].label}</span>
              </div>
            </div>

            <form className="ticker-form" onSubmit={handleSearch}>
              <div className="ticker-input-wrap">
                <span className="ticker-search-icon">⌕</span>
                <input
                  className="ticker-input"
                  placeholder="AAPL, MSFT, TSLA..."
                  value={tickerInput}
                  onChange={e => setTickerInput(e.target.value)}
                />
              </div>
              <button className="ticker-btn" type="submit">נתח</button>
            </form>
          </div>
        </header>

        {/* Stock overview panel */}
        {ticker && (
          <div className="stock-panel-wrapper">
            <StockData ticker={ticker} />
          </div>
        )}

        {/* Page content */}
        <main className="main">
          {page === 0 && <Calculator1 ticker={ticker} />}
          {page === 1 && <Calculator2 ticker={ticker} />}
          {page === 2 && <FinancialReports ticker={ticker} />}
          {page === 3 && <FinancialCharts ticker={ticker} />}
        </main>
      </div>
    </div>
  );
}
