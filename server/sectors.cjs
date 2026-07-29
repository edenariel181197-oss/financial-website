// Curated v1 ticker universe per sector for the sector screener.
// Small, liquid, well-known names — easy to extend later.
module.exports = {
  technology: { label: 'טכנולוגיה', tickers: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'ORCL', 'ADBE', 'CRM', 'AMD', 'INTC'] },
  banks:      { label: 'בנקים',      tickers: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'COF'] },
  cyber:      { label: 'סייבר',      tickers: ['CRWD', 'PANW', 'FTNT', 'ZS', 'S', 'CYBR', 'OKTA', 'QLYS', 'TENB', 'RPD'] },
  energy:     { label: 'אנרגיה',     tickers: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'MPC', 'OXY', 'WMB', 'KMI'] },
  healthcare: { label: 'בריאות',     tickers: ['JNJ', 'UNH', 'PFE', 'MRK', 'ABBV', 'LLY', 'TMO', 'ABT', 'BMY', 'MDT'] },
  chips:      { label: 'שבבים',      tickers: ['NVDA', 'TSM', 'AVGO', 'AMD', 'QCOM', 'TXN', 'MU', 'ASML', 'AMAT', 'LRCX'] },
  // Index ETFs, not individual companies — no P/E, P/B, EV/EBITDA or market cap
  // (they don't file company fundamentals), so this sector sorts by price instead.
  indices: { label: 'מדדים מובילים', tickers: ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'EFA', 'EEM', 'VGK'], sortBy: 'price' },
};
