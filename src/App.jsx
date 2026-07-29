import { useState } from 'react';
import {
  Calculator, LineChart, FileText, BarChart3, Building2, Newspaper,
  ArrowLeftRight, Trophy, Diamond, Search, ChevronLeft, ChevronRight, Menu,
} from 'lucide-react';
import Calculator1 from './components/Calculator1';
import Calculator2 from './components/Calculator2';
import FinancialReports from './components/FinancialReports';
import FinancialCharts from './components/FinancialCharts';
import StockData from './components/StockData';
import CompanyProfile from './components/CompanyProfile';
import StockNews from './components/StockNews';
import Compare from './components/Compare';
import SectorScreener from './components/SectorScreener';
import './App.css';

const NAV = [
  { icon: Calculator,      label: 'מחשבון EPS',    sub: 'הערכת שווי DCF'       },
  { icon: LineChart,       label: 'מחשבון הכנסות', sub: 'תרחישי מכפיל'         },
  { icon: FileText,        label: 'דוחות כספיים',  sub: 'מאזן · רווח · תזרים'  },
  { icon: BarChart3,       label: 'גרפים ותחזיות', sub: 'ניתוח ויזואלי'        },
  { icon: Building2,       label: 'אודות החברה',   sub: 'פרופיל והנהלה'        },
  { icon: Newspaper,       label: 'חדשות',         sub: 'עדכונים אחרונים'      },
  { icon: ArrowLeftRight,  label: 'השוואת מניות',  sub: 'עד 5 מניות זו לצד זו' },
  { icon: Trophy,          label: 'מיטב הסקטור',   sub: 'דירוג לפי מכפילים'    },
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

  const ActivePageIcon = NAV[page].icon;

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''}`} dir="rtl">

      {/* Mobile backdrop */}
      {mobileNavOpen && <div className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-diamond"><Diamond size={18} strokeWidth={2.5} /></div>
          <div className="brand-text">
            <h1 className="brand-name">Eden Finances</h1>
            <p className="brand-sub">כלי ניתוח מקצועי</p>
          </div>
        </div>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {NAV.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={i}
                className={`nav-item ${page === i ? 'active' : ''}`}
                onClick={() => handleNavClick(i)}
              >
                <span className="nav-icon"><Icon size={18} strokeWidth={2} /></span>
                <div className="nav-labels">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-sub">{item.sub}</span>
                </div>
              </button>
            );
          })}
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
                {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
              <button className="collapse-btn mobile-only" onClick={() => setMobileNavOpen(v => !v)}>
                <Menu size={18} />
              </button>
              <div className="topbar-page-title">
                <span className="topbar-icon"><ActivePageIcon size={18} strokeWidth={2} /></span>
                <span>{NAV[page].label}</span>
              </div>
            </div>

            <form className="ticker-form" onSubmit={handleSearch}>
              <div className="ticker-input-wrap">
                <span className="ticker-search-icon"><Search size={15} /></span>
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
            <StockData ticker={ticker} showInsights={page === 0} />
          </div>
        )}

        {/* Page content */}
        <main className="main">
          {page === 0 && <Calculator1 ticker={ticker} />}
          {page === 1 && <Calculator2 ticker={ticker} />}
          {page === 2 && <FinancialReports ticker={ticker} />}
          {page === 3 && <FinancialCharts ticker={ticker} />}
          {page === 4 && <CompanyProfile ticker={ticker} />}
          {page === 5 && <StockNews ticker={ticker} />}
          {page === 6 && <Compare />}
          {page === 7 && <SectorScreener />}
        </main>
      </div>
    </div>
  );
}
