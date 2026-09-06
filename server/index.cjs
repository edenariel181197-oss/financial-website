const { fetch, Agent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new Agent({ maxHeaderSize: 131072, headersTimeout: 60000 }));
globalThis.fetch = fetch;

const express = require('express');
const cors = require('cors');
const SECTORS = require('./sectors.cjs');

const app = express();
app.use(cors());
app.use((req, _res, next) => { console.log('REQ:', req.method, req.path); next(); });

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};
const PERIOD1 = 1451606400; // 2016-01-01
const PERIOD2 = 2000000000;

// ── Crumb management ──────────────────────────────────────────────
let _crumb = null, _cookie = null;

async function ensureCrumb() {
  if (_crumb) return;
  try {
    const r1 = await fetch('https://fc.yahoo.com', { headers: YF_HEADERS });
    const sc = r1.headers.get('set-cookie') || '';
    _cookie = sc.split(';')[0] || '';
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YF_HEADERS, Cookie: _cookie }
    });
    const text = await r2.text();
    if (text && text.length < 50 && !text.startsWith('{')) {
      _crumb = text.trim();
      console.log('Crumb acquired OK');
    }
  } catch (e) {
    console.error('Crumb error:', e.message);
  }
}

// ── Direct Yahoo Finance API helpers ─────────────────────────────

async function fetchChart(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    const meta = d.chart?.result?.[0]?.meta || {};
    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? null;
    const change = (price != null && prevClose != null) ? price - prevClose : null;
    const changePercent = (change != null && prevClose) ? (change / prevClose) * 100 : null;
    return {
      price,
      name: meta.longName || meta.shortName || ticker,
      marketCap: meta.marketCap ?? null,
      sharesOutstanding: meta.sharesOutstanding ?? null,
      currency: meta.currency ?? 'USD',
      change,
      changePercent,
    };
  } catch (e) {
    console.error('fetchChart error:', e.message);
    return {};
  }
}

async function fetchSummary(ticker, modules) {
  try {
    const mods = modules.join(',');
    const url6 = `https://query2.finance.yahoo.com/v6/finance/quoteSummary/${ticker}?modules=${mods}`;
    const r = await fetch(url6, { headers: YF_HEADERS });
    const d = await r.json();
    if (d.quoteSummary?.result?.[0]) return d.quoteSummary.result[0];
  } catch (e) {
    console.error('fetchSummary v6 error:', e.message);
  }
  try {
    await ensureCrumb();
    const mods = modules.join(',');
    const crumbParam = _crumb ? `&crumb=${encodeURIComponent(_crumb)}` : '';
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${mods}${crumbParam}`;
    const headers = { ...YF_HEADERS };
    if (_cookie) headers.Cookie = _cookie;
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (d.quoteSummary?.result?.[0]) return d.quoteSummary.result[0];
  } catch (e) {
    console.error('fetchSummary v10 error:', e.message);
  }
  return {};
}

// ── Timeseries API (most reliable — no crumb needed) ─────────────
async function fetchTimeSeries(ticker, types) {
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?type=${types.join(',')}&period1=${PERIOD1}&period2=${PERIOD2}`;
  const r = await fetch(url, { headers: YF_HEADERS });
  const d = await r.json();
  const results = d.timeseries?.result || [];
  const map = {};
  for (const series of results) {
    const key = series.meta?.type?.[0];
    if (key) {
      const points = series[key] || [];
      map[key] = points
        .filter(p => p)
        .sort((a, b) => new Date(b.asOfDate) - new Date(a.asOfDate))
        .map(p => ({ date: p.asOfDate, value: p.reportedValue?.raw ?? p.reportedValue }));
    }
  }
  return map;
}

// Defaults to only 'annual*' keys — some maps now also carry 'quarterly*' series (added
// for TTM computations) alongside the annual ones, and mixing quarter-end dates into a
// "5 fiscal years" list would crowd out the actual annual dates.
function getYears(map, prefix = 'annual') {
  const allDates = Object.entries(map)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, series]) => series.map(p => p.date));
  return [...new Set(allDates)].sort((a, b) => b.localeCompare(a)).slice(0, 5);
}

function getVal(map, key, date) {
  return (map[key] || []).find(p => p.date === date)?.value ?? null;
}

function latest(map, key) {
  return (map[key] || [])[0]?.value ?? null;
}

// Trailing-twelve-month sum of a quarterly flow metric (revenue, net income,
// diluted EPS, EBITDA, FCF, dividends paid, etc). `offset` skips the most
// recent N quarters first — offset=4 gives the TTM window ending one year
// ago, used for YoY growth comparisons against the current TTM window.
// Returns null (never a partial/misleading sum) if fewer than 4 quarters of
// data exist at that offset, so callers can fall through to the next source.
function ttmSum(map, key, offset = 0, count = 4) {
  const points = (map[key] || []).slice(offset, offset + count);
  if (points.length < count) return null;
  return points.reduce((sum, p) => sum + (p.value ?? 0), 0);
}

// Most recent reported value for a balance-sheet-style "point in time"
// metric (equity, debt, cash, shares outstanding) — quarterly filings are
// more current than the last annual one, so this compares the latest point
// across both series (given first-elements only, already sorted newest-first
// by fetchTimeSeries) and returns whichever has the later asOfDate.
function mostRecentOf(map, ...keys) {
  let best = null;
  for (const key of keys) {
    const p = (map[key] || [])[0];
    if (p && p.value != null && (!best || new Date(p.date) > new Date(best.date))) best = p;
  }
  return best ? best.value : null;
}

// ── Rule-based investment thesis (V1, free — no AI) ───────────────
// Built entirely from data already fetched via timeseries + the sector
// screener cache. No external calls, no cost.
function buildThesis({ pe, revenueGrowthRaw, netMarginRaw, latestDebt, latestCash, latestFCF, latestNetIncome, history, sectorMedianPE, sectorPeerCount, sectorLabel }) {
  const strengths = [];
  const risks = [];
  const context = [];

  // Valuation
  let valuation;
  const peerNote = sectorPeerCount ? ` (בהשוואה ל-${sectorPeerCount} חברות מובילות בסקטור ${sectorLabel})` : '';
  if (pe == null) {
    valuation = { verdict: 'unknown', text: 'אין נתוני מכפיל רווח זמינים.' };
  } else if (sectorMedianPE != null) {
    if (pe < sectorMedianPE * 0.85) {
      valuation = { verdict: 'cheap', text: `נסחרת במכפיל רווח של ${pe.toFixed(1)}, מתחת לחציון הסקטוריאלי (${sectorMedianPE.toFixed(1)})${peerNote} — מוזלת יחסית למתחרות.` };
      strengths.push('מכפיל רווח נמוך מחציון הסקטור');
    } else if (pe > sectorMedianPE * 1.15) {
      valuation = { verdict: 'expensive', text: `נסחרת במכפיל רווח של ${pe.toFixed(1)}, מעל לחציון הסקטוריאלי (${sectorMedianPE.toFixed(1)})${peerNote} — יקרה יחסית למתחרות.` };
      risks.push('מכפיל רווח גבוה מחציון הסקטור');
    } else {
      valuation = { verdict: 'fair', text: `נסחרת במכפיל רווח של ${pe.toFixed(1)}, קרוב לחציון הסקטוריאלי (${sectorMedianPE.toFixed(1)})${peerNote}.` };
    }
  } else if (pe < 15) {
    valuation = { verdict: 'cheap', text: `מכפיל רווח נמוך (${pe.toFixed(1)}) ביחס לשוק הכללי.` };
    strengths.push('מכפיל רווח נמוך יחסית לשוק');
  } else if (pe > 25) {
    valuation = { verdict: 'expensive', text: `מכפיל רווח גבוה (${pe.toFixed(1)}) ביחס לשוק הכללי.` };
    risks.push('מכפיל רווח גבוה יחסית לשוק');
  } else {
    valuation = { verdict: 'fair', text: `מכפיל רווח סביר (${pe.toFixed(1)}) ביחס לשוק הכללי.` };
  }

  // Growth
  let growth;
  if (revenueGrowthRaw == null) {
    growth = { verdict: 'unknown', text: 'אין נתוני צמיחת הכנסות זמינים.' };
  } else if (revenueGrowthRaw > 15) {
    growth = { verdict: 'strong', text: `צמיחת הכנסות שנתית חזקה של ${revenueGrowthRaw.toFixed(1)}%.` };
    strengths.push('צמיחת הכנסות חזקה');
  } else if (revenueGrowthRaw > 5) {
    growth = { verdict: 'moderate', text: `צמיחת הכנסות שנתית מתונה של ${revenueGrowthRaw.toFixed(1)}%.` };
  } else if (revenueGrowthRaw >= 0) {
    growth = { verdict: 'weak', text: `צמיחת הכנסות איטית של ${revenueGrowthRaw.toFixed(1)}% — כדאי לעקוב.` };
    risks.push('קצב צמיחה איטי');
  } else {
    growth = { verdict: 'declining', text: `הכנסות בירידה של ${Math.abs(revenueGrowthRaw).toFixed(1)}% לעומת השנה הקודמת.` };
    risks.push('ירידה בהכנסות');
  }

  // Profitability
  let profitability;
  if (netMarginRaw == null) {
    profitability = { verdict: 'unknown', text: 'אין נתוני רווחיות זמינים.' };
  } else if (netMarginRaw < 0) {
    profitability = { verdict: 'unprofitable', text: `החברה מפסידה כרגע (שולי רווח נקי ${(netMarginRaw * 100).toFixed(1)}%).` };
    risks.push('החברה אינה רווחית כרגע');
  } else if (netMarginRaw > 0.20) {
    profitability = { verdict: 'high', text: `רווחיות גבוהה — שולי רווח נקי של ${(netMarginRaw * 100).toFixed(1)}%.` };
    strengths.push('שולי רווח נקי גבוהים');
  } else if (netMarginRaw > 0.10) {
    profitability = { verdict: 'moderate', text: `רווחיות סבירה — שולי רווח נקי של ${(netMarginRaw * 100).toFixed(1)}%.` };
  } else {
    profitability = { verdict: 'low', text: `רווחיות נמוכה — שולי רווח נקי של ${(netMarginRaw * 100).toFixed(1)}%.` };
    risks.push('שולי רווח נקי נמוכים');
  }

  // Financial health
  let health;
  if (latestDebt == null && latestCash == null) {
    health = { verdict: 'unknown', text: 'אין נתוני מאזן זמינים.' };
  } else if ((latestCash ?? 0) >= (latestDebt ?? 0)) {
    health = { verdict: 'strong', text: 'עודף מזומן נטו על פני החוב — מאזן איתן.' };
    strengths.push('עודף מזומן נטו על החוב');
  } else if ((latestDebt ?? 0) > (latestCash ?? 0) * 3) {
    health = { verdict: 'weak', text: 'רמת מינוף גבוהה יחסית למזומן הקיים — כדאי לעקוב.' };
    risks.push('מינוף גבוה יחסית למזומן');
  } else {
    health = { verdict: 'moderate', text: 'רמת חוב סבירה ביחס למזומן הקיים.' };
  }

  // Own-history valuation context — is it cheap/expensive relative to its own past, not just peers?
  const pastPEs = (history || []).slice(1).map(h => h.pe).filter(v => v != null);
  if (pe != null && pastPEs.length >= 2) {
    const avgPastPE = pastPEs.reduce((a, b) => a + b, 0) / pastPEs.length;
    if (pe < avgPastPE * 0.9) {
      context.push(`המכפיל הנוכחי (${pe.toFixed(1)}) נמוך מהממוצע ההיסטורי שלה ב-${pastPEs.length} השנים האחרונות (${avgPastPE.toFixed(1)}) — נסחרת בזהירות יחסית לעצמה בעבר.`);
    } else if (pe > avgPastPE * 1.1) {
      context.push(`המכפיל הנוכחי (${pe.toFixed(1)}) גבוה מהממוצע ההיסטורי שלה ב-${pastPEs.length} השנים האחרונות (${avgPastPE.toFixed(1)}) — נסחרת יקר יחסית לעצמה בעבר.`);
    } else {
      context.push(`המכפיל הנוכחי דומה לממוצע ההיסטורי שלה ב-${pastPEs.length} השנים האחרונות (${avgPastPE.toFixed(1)}).`);
    }
  }

  // Growth trend — accelerating, decelerating, or stable (needs 3+ years of revenue)
  if (history && history.length >= 3 && history[0].revenue != null && history[1].revenue != null && history[2].revenue != null && history[1].revenue !== 0 && history[2].revenue !== 0) {
    const g1 = (history[0].revenue - history[1].revenue) / Math.abs(history[1].revenue) * 100;
    const g2 = (history[1].revenue - history[2].revenue) / Math.abs(history[2].revenue) * 100;
    if (g1 > g2 + 3) {
      context.push(`קצב הצמיחה מאיץ — מ-${g2.toFixed(1)}% בשנה הקודמת ל-${g1.toFixed(1)}% בשנה האחרונה.`);
    } else if (g1 < g2 - 3) {
      context.push(`קצב הצמיחה מאט — מ-${g2.toFixed(1)}% בשנה הקודמת ל-${g1.toFixed(1)}% בשנה האחרונה.`);
    } else {
      context.push('קצב הצמיחה יציב יחסית בשנתיים האחרונות.');
    }
  }

  // Earnings quality — does free cash flow actually back up the reported net income?
  if (latestFCF != null && latestNetIncome != null && latestNetIncome > 0) {
    const ratio = latestFCF / latestNetIncome;
    if (ratio >= 0.9) {
      context.push('תזרים המזומנים החופשי מכסה כמעט את מלוא הרווח הנקי — סימן לאיכות רווח גבוהה.');
      strengths.push('תזרים מזומנים חופשי איכותי');
    } else if (ratio >= 0.5) {
      context.push(`תזרים המזומנים החופשי מכסה כ-${(ratio * 100).toFixed(0)}% מהרווח הנקי — סביר.`);
    } else {
      context.push(`תזרים המזומנים החופשי נמוך משמעותית מהרווח הנקי המדווח (כ-${(ratio * 100).toFixed(0)}%) — שווה לבדוק את איכות הרווח.`);
      risks.push('תזרים מזומנים חלש ביחס לרווח הנקי');
    }
  }

  const summary = [valuation.text, growth.text, profitability.text, health.text].join(' ');

  return {
    valuation, growth, profitability, health,
    strengths: strengths.slice(0, 3),
    risks: risks.slice(0, 3),
    context,
    summary,
  };
}

// ════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ════════════════════════════════════════════════════════════════

// Quote
// `includeForwardPE: false` is used by the sector screener's bulk fetch (up to ~10 tickers
// per sector) so a single screener refresh can't burn through Alpha Vantage's whole daily
// quota on tickers that aren't even being viewed individually right now.
async function getQuoteData(ticker, { includeForwardPE = true } = {}) {
  const t = ticker.toUpperCase();
  const [chart, tsMap, summary] = await Promise.all([
    fetchChart(t),
    fetchTimeSeries(t, [
      'annualDilutedEPS', 'annualNetIncomeRatio', 'annualPeRatio', 'annualTotalRevenue', 'annualNetIncome', 'annualShareIssued',
      'annualCommonStockEquity', 'annualEBITDA', 'annualLongTermDebt', 'annualCurrentDebt', 'annualCashAndCashEquivalents',
      'annualOperatingIncome', 'annualFreeCashFlow', 'annualCashDividendsPaid',
      // Quarterly counterparts — used to build trailing-twelve-month (TTM) figures for flow
      // metrics and "most recent reported" figures for balance-sheet metrics, since quoteSummary
      // (the source of Yahoo's own live trailingPE/trailingEps/etc) is unreliable/frequently
      // blocked, and the annual-only figures above can lag up to a year behind for fast-growing
      // companies (e.g. NVDA: FY2026 annual diluted EPS $4.90 vs actual TTM ~$7.91 as of 9/2026).
      'quarterlyDilutedEPS', 'quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyShareIssued',
      'quarterlyCommonStockEquity', 'quarterlyEBITDA', 'quarterlyLongTermDebt', 'quarterlyCurrentDebt',
      'quarterlyCashAndCashEquivalents', 'quarterlyOperatingIncome', 'quarterlyFreeCashFlow', 'quarterlyCashDividendsPaid',
    ]),
    fetchSummary(t, ['summaryDetail', 'defaultKeyStatistics', 'financialData']),
  ]);

  const sd = summary.summaryDetail || {};
  const ks = summary.defaultKeyStatistics || {};
  const fd = summary.financialData || {};

  // Flow metrics: prefer trailing-twelve-month (sum of last 4 quarters) over the stale
  // once-a-year annual figure, whenever 4 quarters of data are actually available.
  const tsRevenue = ttmSum(tsMap, 'quarterlyTotalRevenue') ?? latest(tsMap, 'annualTotalRevenue');
  const tsNetIncome = ttmSum(tsMap, 'quarterlyNetIncome') ?? latest(tsMap, 'annualNetIncome');
  const netMargin = fd.profitMargins
    ?? (tsRevenue && tsNetIncome != null ? tsNetIncome / tsRevenue : null)
    ?? latest(tsMap, 'annualNetIncomeRatio');

  // Balance-sheet ("point in time") metrics: prefer whichever of the quarterly/annual series
  // has the most recently reported date, since a quarterly filing can be newer than the last
  // annual one.
  const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding
    ?? mostRecentOf(tsMap, 'quarterlyShareIssued', 'annualShareIssued');
  const price = chart.price;
  const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

  // quoteSummary (defaultKeyStatistics) is unreliable/frequently blocked — fall back to
  // computing P/B and EV/EBITDA from the more reliable timeseries fundamentals, same
  // reasoning as the existing timeseries-over-quoteSummary preference used elsewhere.
  const equity = mostRecentOf(tsMap, 'quarterlyCommonStockEquity', 'annualCommonStockEquity');
  const bookValuePerShare = (equity && sharesOutstanding) ? equity / sharesOutstanding : null;
  const pb = ks.priceToBook ?? (price && bookValuePerShare ? price / bookValuePerShare : null);

  const ebitda = ttmSum(tsMap, 'quarterlyEBITDA') ?? latest(tsMap, 'annualEBITDA');
  const ltd = mostRecentOf(tsMap, 'quarterlyLongTermDebt', 'annualLongTermDebt');
  const std = mostRecentOf(tsMap, 'quarterlyCurrentDebt', 'annualCurrentDebt');
  const cash = mostRecentOf(tsMap, 'quarterlyCashAndCashEquivalents', 'annualCashAndCashEquivalents');
  const enterpriseValue = marketCap != null ? marketCap + (ltd ?? 0) + (std ?? 0) - (cash ?? 0) : null;
  const evToEbitda = ks.enterpriseToEbitda ?? (enterpriseValue && ebitda ? enterpriseValue / ebitda : null);

  // Trailing diluted EPS — same TTM-over-annual preference, reused for both the eps and
  // pe fields below. This is the fix for the reported bug: a stale annual EPS understates
  // fast-growing companies' true trailing earnings, which inflates the displayed P/E.
  const ttmEPS = ttmSum(tsMap, 'quarterlyDilutedEPS');
  const eps = ks.trailingEps ?? ttmEPS ?? latest(tsMap, 'annualDilutedEPS');
  const pe = sd.trailingPE ?? (price && ttmEPS ? price / ttmEPS : null) ?? latest(tsMap, 'annualPeRatio');

  // Same quoteSummary-unreliable reasoning as above — fall back to timeseries fundamentals
  // for every comparison-table metric that has one available. Revenue growth compares the
  // current TTM window against the TTM window ending 4 quarters earlier (true trailing YoY),
  // falling back to annual-vs-annual only when a full 8 quarters of data isn't available.
  const ttmRevenueYearAgo = ttmSum(tsMap, 'quarterlyTotalRevenue', 4);
  const annualRevenueSeries = tsMap.annualTotalRevenue || [];
  const annualRevenueGrowth = (annualRevenueSeries[0]?.value != null && annualRevenueSeries[1]?.value)
    ? (annualRevenueSeries[0].value - annualRevenueSeries[1].value) / Math.abs(annualRevenueSeries[1].value)
    : null;
  const revenueGrowthFallback = (tsRevenue != null && ttmRevenueYearAgo)
    ? (tsRevenue - ttmRevenueYearAgo) / Math.abs(ttmRevenueYearAgo)
    : annualRevenueGrowth;
  const operatingIncome = ttmSum(tsMap, 'quarterlyOperatingIncome') ?? latest(tsMap, 'annualOperatingIncome');
  const operatingMarginFallback = (operatingIncome != null && tsRevenue) ? operatingIncome / tsRevenue : null;
  const roeFallback = (tsNetIncome != null && equity) ? tsNetIncome / equity : null;
  const freeCashFlowFallback = ttmSum(tsMap, 'quarterlyFreeCashFlow') ?? latest(tsMap, 'annualFreeCashFlow');
  const debtToEquityFallback = (equity && (ltd != null || std != null)) ? ((ltd ?? 0) + (std ?? 0)) / equity : null;
  const cashDividendsPaid = ttmSum(tsMap, 'quarterlyCashDividendsPaid') ?? latest(tsMap, 'annualCashDividendsPaid');
  const dividendYieldFallback = (cashDividendsPaid && sharesOutstanding && price)
    ? Math.abs(cashDividendsPaid) / sharesOutstanding / price
    : null;

  // sd.forwardPE/ks.forwardPE would come from quoteSummary, which is currently always empty
  // (see fetchSummary) — Alpha Vantage is the only fallback, and only for single-ticker
  // lookups (see includeForwardPE above), never for bulk/screener calls.
  const forwardPE = sd.forwardPE ?? ks.forwardPE ?? (includeForwardPE ? await fetchForwardPE(t) : null);

  return {
    symbol: t,
    name: chart.name,
    price,
    change: chart.change,
    changePercent: chart.changePercent,
    pe,
    pb,
    evToEbitda,
    eps,
    netMargin,
    marketCap,
    sharesOutstanding,
    // Used by the stock-comparison table (Compare.jsx) and the main stock page's KPI grid.
    forwardPE,
    revenueGrowth: fd.revenueGrowth ?? revenueGrowthFallback,
    operatingMargin: fd.operatingMargins ?? operatingMarginFallback,
    roe: fd.returnOnEquity ?? roeFallback,
    freeCashFlow: fd.freeCashflow ?? freeCashFlowFallback,
    // Yahoo returns debtToEquity as a percentage-style number (e.g. 145 = 1.45x) — normalize to a plain ratio.
    debtToEquity: fd.debtToEquity != null ? fd.debtToEquity / 100 : debtToEquityFallback,
    dividendYield: sd.dividendYield ?? dividendYieldFallback,
  };
}

app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const data = await getQuoteData(req.params.ticker);
    res.json(data);
  } catch (e) {
    console.error('API ERROR /quote:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sector screener — ranks a curated ticker universe per sector by P/E (ascending = cheaper).
// No DB/scheduler available on the free tier, so this uses a simple in-memory cache
// refreshed lazily (max once per 6h) instead of a real scheduled job. Tickers are fetched
// in small batches with a short delay between them to avoid tripping Yahoo's rate limits.
const screenerCache = {};
const SCREENER_TTL_MS = 6 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function computeSectorScreener(sectorKey) {
  const sector = SECTORS[sectorKey];
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < sector.tickers.length; i += batchSize) {
    const batch = sector.tickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((t) => getQuoteData(t, { includeForwardPE: false }).catch((e) => {
        console.error(`sector screener: failed to fetch ${t}:`, e.message);
        return null;
      }))
    );
    results.push(...batchResults.filter(Boolean));
    if (i + batchSize < sector.tickers.length) await sleep(300);
  }
  const sortKey = sector.sortBy || 'marketCap';
  results.sort((a, b) => {
    if (a[sortKey] == null) return 1;
    if (b[sortKey] == null) return -1;
    return b[sortKey] - a[sortKey];
  });
  return results;
}

// Only reads an already-warm screener cache — never triggers a fresh fetch,
// so it can't slow down /api/profile. Falls back to null (fixed bands) if cold.
function getSectorPeerStats(ticker) {
  const t = ticker.toUpperCase();
  const key = Object.keys(SECTORS).find((k) => SECTORS[k].tickers.includes(t));
  if (!key) return null;
  const cached = screenerCache[key];
  if (!cached) return null;
  const pes = cached.data.map((c) => c.pe).filter((v) => v != null).sort((a, b) => a - b);
  if (!pes.length) return null;
  const mid = Math.floor(pes.length / 2);
  const median = pes.length % 2 === 0 ? (pes[mid - 1] + pes[mid]) / 2 : pes[mid];
  return { median, count: cached.data.length, label: SECTORS[key].label };
}

app.get('/api/sector-screener/:sector', async (req, res) => {
  try {
    const key = req.params.sector.toLowerCase();
    if (!SECTORS[key]) {
      return res.status(404).json({ error: 'Unknown sector', sectors: Object.keys(SECTORS) });
    }
    const cached = screenerCache[key];
    if (cached && Date.now() - cached.fetchedAt < SCREENER_TTL_MS) {
      return res.json({ sector: key, label: SECTORS[key].label, companies: cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }
    const data = await computeSectorScreener(key);
    screenerCache[key] = { data, fetchedAt: Date.now() };
    res.json({ sector: key, label: SECTORS[key].label, companies: data, cached: false, fetchedAt: screenerCache[key].fetchedAt });
  } catch (e) {
    console.error('API ERROR /sector-screener:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Quarterly data
app.get('/api/quarterly/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const map = await fetchTimeSeries(t, ['quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyBasicEPS']);
    const dates = [...new Set((map.quarterlyTotalRevenue || []).map(p => p.date))]
      .sort((a, b) => b.localeCompare(a)).slice(0, 12);
    res.json(dates.map(date => ({
      date,
      revenue: getVal(map, 'quarterlyTotalRevenue', date),
      netIncome: getVal(map, 'quarterlyNetIncome', date),
      eps: getVal(map, 'quarterlyBasicEPS', date),
    })));
  } catch (e) {
    console.error('API ERROR /quarterly:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Income statement
app.get('/api/income/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const map = await fetchTimeSeries(t, [
      'annualTotalRevenue', 'annualCostOfRevenue', 'annualGrossProfit', 'annualGrossProfitRatio',
      'annualSellingGeneralAndAdministration', 'annualGeneralAndAdministrativeExpense',
      'annualResearchAndDevelopment', 'annualOtherGandA',
      'annualOperatingIncome', 'annualOperatingIncomeRatio',
      'annualNetInterestIncome', 'annualInterestExpense',
      'annualTaxProvision', 'annualIncomeTaxExpense',
      'annualNetIncome', 'annualNetIncomeCommonStockholders', 'annualNetIncomeRatio',
    ]);
    const years = getYears(map);
    res.json(years.map(date => ({
      date,
      revenue: getVal(map, 'annualTotalRevenue', date),
      costOfRevenue: getVal(map, 'annualCostOfRevenue', date),
      grossProfit: getVal(map, 'annualGrossProfit', date),
      grossProfitRatio: getVal(map, 'annualGrossProfitRatio', date),
      sellingAndMarketingExpenses: getVal(map, 'annualSellingGeneralAndAdministration', date),
      generalAndAdministrativeExpenses: getVal(map, 'annualGeneralAndAdministrativeExpense', date)
        ?? getVal(map, 'annualOtherGandA', date),
      otherExpenses: getVal(map, 'annualResearchAndDevelopment', date),
      operatingIncome: getVal(map, 'annualOperatingIncome', date),
      operatingIncomeRatio: getVal(map, 'annualOperatingIncomeRatio', date),
      interestExpense: getVal(map, 'annualInterestExpense', date),
      incomeTaxExpense: getVal(map, 'annualTaxProvision', date)
        ?? getVal(map, 'annualIncomeTaxExpense', date),
      netIncome: getVal(map, 'annualNetIncome', date),
      netIncomeRatio: getVal(map, 'annualNetIncomeRatio', date),
    })));
  } catch (e) {
    console.error('API ERROR /income:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Income statement - quarterly (mirrors /api/income but with quarterly* fields, last 8 quarters)
app.get('/api/income-quarterly/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const map = await fetchTimeSeries(t, [
      'quarterlyTotalRevenue', 'quarterlyCostOfRevenue', 'quarterlyGrossProfit', 'quarterlyGrossProfitRatio',
      'quarterlySellingGeneralAndAdministration', 'quarterlyGeneralAndAdministrativeExpense',
      'quarterlyResearchAndDevelopment', 'quarterlyOtherGandA',
      'quarterlyOperatingIncome', 'quarterlyOperatingIncomeRatio',
      'quarterlyNetInterestIncome', 'quarterlyInterestExpense',
      'quarterlyTaxProvision', 'quarterlyIncomeTaxExpense',
      'quarterlyNetIncome', 'quarterlyNetIncomeCommonStockholders', 'quarterlyNetIncomeRatio',
    ]);
    const allDates = Object.values(map).flatMap(s => s.map(p => p.date));
    const dates = [...new Set(allDates)].sort((a, b) => b.localeCompare(a)).slice(0, 8);
    res.json(dates.map(date => ({
      date,
      revenue: getVal(map, 'quarterlyTotalRevenue', date),
      costOfRevenue: getVal(map, 'quarterlyCostOfRevenue', date),
      grossProfit: getVal(map, 'quarterlyGrossProfit', date),
      grossProfitRatio: getVal(map, 'quarterlyGrossProfitRatio', date),
      sellingAndMarketingExpenses: getVal(map, 'quarterlySellingGeneralAndAdministration', date),
      generalAndAdministrativeExpenses: getVal(map, 'quarterlyGeneralAndAdministrativeExpense', date)
        ?? getVal(map, 'quarterlyOtherGandA', date),
      otherExpenses: getVal(map, 'quarterlyResearchAndDevelopment', date),
      operatingIncome: getVal(map, 'quarterlyOperatingIncome', date),
      operatingIncomeRatio: getVal(map, 'quarterlyOperatingIncomeRatio', date),
      interestExpense: getVal(map, 'quarterlyInterestExpense', date),
      incomeTaxExpense: getVal(map, 'quarterlyTaxProvision', date)
        ?? getVal(map, 'quarterlyIncomeTaxExpense', date),
      netIncome: getVal(map, 'quarterlyNetIncome', date),
      netIncomeRatio: getVal(map, 'quarterlyNetIncomeRatio', date),
    })));
  } catch (e) {
    console.error('API ERROR /income-quarterly:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Balance sheet
app.get('/api/balance/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const map = await fetchTimeSeries(t, [
      'annualCashAndCashEquivalents', 'annualShortTermInvestments', 'annualAccountsReceivable',
      'annualInventory', 'annualOtherCurrentAssets', 'annualCurrentAssets',
      'annualLongTermInvestments', 'annualNetPPE', 'annualGoodwill', 'annualOtherIntangibleAssets',
      'annualTotalNonCurrentAssets', 'annualTotalAssets',
      'annualCurrentDebt', 'annualAccountsPayable', 'annualOtherCurrentLiabilities',
      'annualCurrentLiabilities', 'annualLongTermDebt', 'annualOtherNonCurrentLiabilities',
      'annualTotalLiabilitiesNetMinorityInterest',
      'annualCommonStock', 'annualRetainedEarnings', 'annualCommonStockEquity',
      'annualTotalEquityGrossMinorityInterest',
    ]);
    const years = getYears(map);
    res.json(years.map(date => {
      const totalAssets = getVal(map, 'annualTotalAssets', date);
      // Use the gross-of-minority-interest total, not common-stock-only equity — companies
      // with preferred stock or non-controlling interests (banks, TSLA) otherwise fail to
      // balance against total assets. Falls back to common equity if Yahoo omits the gross field.
      const totalStockholdersEquity = getVal(map, 'annualTotalEquityGrossMinorityInterest', date)
        ?? getVal(map, 'annualCommonStockEquity', date);
      let totalLiabilities = getVal(map, 'annualTotalLiabilitiesNetMinorityInterest', date);
      // Yahoo's combined timeseries request occasionally drops this one field for a given
      // year even though assets/equity are present. Assets = Liabilities + Equity is a strict
      // accounting identity (not an estimate), so derive it rather than show a broken total.
      if (totalLiabilities == null && totalAssets != null && totalStockholdersEquity != null) {
        totalLiabilities = totalAssets - totalStockholdersEquity;
      }
      return {
        date,
        cashAndCashEquivalents: getVal(map, 'annualCashAndCashEquivalents', date),
        shortTermInvestments: getVal(map, 'annualShortTermInvestments', date),
        netReceivables: getVal(map, 'annualAccountsReceivable', date),
        inventory: getVal(map, 'annualInventory', date),
        otherCurrentAssets: getVal(map, 'annualOtherCurrentAssets', date),
        totalCurrentAssets: getVal(map, 'annualCurrentAssets', date),
        longTermInvestments: getVal(map, 'annualLongTermInvestments', date),
        propertyPlantEquipmentNet: getVal(map, 'annualNetPPE', date),
        goodwill: getVal(map, 'annualGoodwill', date),
        intangibleAssets: getVal(map, 'annualOtherIntangibleAssets', date),
        totalNonCurrentAssets: getVal(map, 'annualTotalNonCurrentAssets', date),
        totalAssets,
        shortTermDebt: getVal(map, 'annualCurrentDebt', date),
        accountPayables: getVal(map, 'annualAccountsPayable', date),
        otherCurrentLiabilities: getVal(map, 'annualOtherCurrentLiabilities', date),
        totalCurrentLiabilities: getVal(map, 'annualCurrentLiabilities', date),
        longTermDebt: getVal(map, 'annualLongTermDebt', date),
        otherNonCurrentLiabilities: getVal(map, 'annualOtherNonCurrentLiabilities', date),
        totalLiabilities,
        commonStock: getVal(map, 'annualCommonStock', date),
        retainedEarnings: getVal(map, 'annualRetainedEarnings', date),
        totalStockholdersEquity,
      };
    }));
  } catch (e) {
    console.error('API ERROR /balance:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Cash flow
app.get('/api/cashflow/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const map = await fetchTimeSeries(t, [
      'annualNetIncome', 'annualDepreciationAmortizationDepletion', 'annualChangeInWorkingCapital',
      'annualOperatingCashFlow', 'annualCapitalExpenditure', 'annualPurchaseOfBusiness',
      'annualInvestingCashFlow', 'annualLongTermDebtIssuance', 'annualRepurchaseOfCapitalStock',
      'annualCashDividendsPaid', 'annualFinancingCashFlow', 'annualFreeCashFlow',
      'annualChangesInCash',
    ]);
    const years = getYears(map);
    res.json(years.map(date => {
      const ni    = getVal(map, 'annualNetIncome', date);
      const da    = getVal(map, 'annualDepreciationAmortizationDepletion', date);
      const wc    = getVal(map, 'annualChangeInWorkingCapital', date);
      const capex = getVal(map, 'annualCapitalExpenditure', date);
      const acq   = getVal(map, 'annualPurchaseOfBusiness', date);
      const opRaw = getVal(map, 'annualOperatingCashFlow', date);
      const invRaw = getVal(map, 'annualInvestingCashFlow', date);

      // Fallback: compute from components when direct total is unavailable
      const opTotal  = opRaw  ?? ((ni != null || da != null || wc != null)  ? (ni ?? 0) + (da ?? 0) + (wc ?? 0) : null);
      const invTotal = invRaw ?? ((capex != null || acq != null)            ? (capex ?? 0) + (acq ?? 0)          : null);

      return {
        date,
        netIncome: ni,
        depreciationAndAmortization: da,
        changeInWorkingCapital: wc,
        netCashProvidedByOperatingActivities: opTotal,
        capitalExpenditure: capex,
        acquisitionsNet: acq,
        netCashUsedForInvestingActivites: invTotal,
        debtRepayment: getVal(map, 'annualLongTermDebtIssuance', date),
        commonStockRepurchased: getVal(map, 'annualRepurchaseOfCapitalStock', date),
        dividendsPaid: getVal(map, 'annualCashDividendsPaid', date),
        netCashUsedProvidedByFinancingActivities: getVal(map, 'annualFinancingCashFlow', date),
        netChangeInCash: getVal(map, 'annualChangesInCash', date),
        freeCashFlow: getVal(map, 'annualFreeCashFlow', date),
      };
    }));
  } catch (e) {
    console.error('API ERROR /cashflow:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ratios — computed from timeseries data
app.get('/api/ratios/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [map, summary] = await Promise.all([
      fetchTimeSeries(t, [
        'annualTotalRevenue', 'annualGrossProfit', 'annualOperatingIncome', 'annualNetIncome',
        'annualCommonStockEquity', 'annualTotalAssets', 'annualLongTermDebt',
        'annualCurrentAssets', 'annualCurrentLiabilities',
        'annualAccountsReceivable', 'annualAccountsPayable', 'annualInventory',
        'annualCostOfRevenue', 'annualCashAndCashEquivalents', 'annualCurrentDebt',
      ]),
      fetchSummary(t, ['financialData']),
    ]);
    const fd = summary.financialData || {};

    const rev   = latest(map, 'annualTotalRevenue');
    const gp    = latest(map, 'annualGrossProfit');
    const op    = latest(map, 'annualOperatingIncome');
    const ni    = latest(map, 'annualNetIncome');
    const eq    = latest(map, 'annualCommonStockEquity');
    const ta    = latest(map, 'annualTotalAssets');
    const ltd   = latest(map, 'annualLongTermDebt');
    const ca    = latest(map, 'annualCurrentAssets');
    const cl    = latest(map, 'annualCurrentLiabilities');
    const recv  = latest(map, 'annualAccountsReceivable');
    const payab = latest(map, 'annualAccountsPayable');
    const inv   = latest(map, 'annualInventory');
    const cogs  = latest(map, 'annualCostOfRevenue');
    const cash  = latest(map, 'annualCashAndCashEquivalents');
    const std   = latest(map, 'annualCurrentDebt');

    // Efficiency ratios
    const dso = (rev && recv)   ? Math.round((recv  / rev)  * 365) : null;
    const dpo = (cogs && payab) ? Math.round((payab / cogs) * 365) : null;
    const dio = (cogs && inv)   ? Math.round((inv   / cogs) * 365) : null;
    const ccc = (dso != null && dio != null && dpo != null) ? dso + dio - dpo : null;

    // Net Debt = total debt - cash
    const netDebt = (std != null || ltd != null || cash != null)
      ? (std ?? 0) + (ltd ?? 0) - (cash ?? 0)
      : null;

    res.json({
      currentRatioTTM: fd.currentRatio ?? (ca && cl ? ca / cl : null),
      quickRatioTTM: fd.quickRatio ?? (ca && cl ? (ca - (inv ?? 0)) / cl : null),
      grossProfitMarginTTM: fd.grossMargins ?? (gp && rev ? gp / rev : null),
      operatingProfitMarginTTM: fd.operatingMargins ?? (op && rev ? op / rev : null),
      netProfitMarginTTM: fd.profitMargins ?? (ni && rev ? ni / rev : null),
      returnOnEquityTTM: fd.returnOnEquity ?? (ni && eq ? ni / eq : null),
      returnOnAssetsTTM: fd.returnOnAssets ?? (ni && ta ? ni / ta : null),
      longTermDebtToCapitalizationTTM: fd.debtToEquity
        ? fd.debtToEquity / 100
        : (ltd && eq ? ltd / (ltd + eq) : null),
      daysOfSalesOutstandingTTM: dso,
      daysPayablesOutstandingTTM: dpo,
      daysOfInventoryOutstandingTTM: dio,
      cashConversionCycleTTM: ccc,
      netDebt,
    });
  } catch (e) {
    console.error('API ERROR /ratios:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Charts — includes EPS and YoY growth rates
app.get('/api/charts/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [annualMap, quarterlyMap] = await Promise.all([
      fetchTimeSeries(t, [
        'annualTotalRevenue', 'annualNetIncome', 'annualPeRatio',
        'annualTotalAssets', 'annualTotalLiabilitiesNetMinorityInterest',
        'annualTotalEquityGrossMinorityInterest', 'annualCommonStockEquity',
        'annualChangesInCash', 'annualDilutedEPS',
        'annualOperatingCashFlow', 'annualInvestingCashFlow', 'annualFinancingCashFlow',
      ]),
      fetchTimeSeries(t, [
        'quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyDilutedEPS', 'quarterlyPeRatio',
        'quarterlyTotalAssets', 'quarterlyTotalLiabilitiesNetMinorityInterest', 'quarterlyChangesInCash',
        'quarterlyTotalEquityGrossMinorityInterest', 'quarterlyCommonStockEquity',
        'quarterlyOperatingCashFlow', 'quarterlyInvestingCashFlow', 'quarterlyFinancingCashFlow',
      ]),
    ]);

    const annualYears = getYears(annualMap);
    const annualData = annualYears.map(date => ({
      date: date.slice(0, 4),
      revenue: getVal(annualMap, 'annualTotalRevenue', date),
      netIncome: getVal(annualMap, 'annualNetIncome', date),
      totalAssets: getVal(annualMap, 'annualTotalAssets', date),
      totalLiabilities: getVal(annualMap, 'annualTotalLiabilitiesNetMinorityInterest', date),
      totalEquity: getVal(annualMap, 'annualTotalEquityGrossMinorityInterest', date)
        ?? getVal(annualMap, 'annualCommonStockEquity', date),
      cashChange: getVal(annualMap, 'annualChangesInCash', date),
      pe: getVal(annualMap, 'annualPeRatio', date),
      eps: getVal(annualMap, 'annualDilutedEPS', date),
      operatingCashFlow: getVal(annualMap, 'annualOperatingCashFlow', date),
      investingCashFlow: getVal(annualMap, 'annualInvestingCashFlow', date),
      financingCashFlow: getVal(annualMap, 'annualFinancingCashFlow', date),
    })).reverse();

    // Compute YoY growth for annual data
    annualData.forEach((d, i) => {
      const prev = annualData[i - 1];
      d.revenueGrowth = (prev?.revenue && d.revenue != null)
        ? (d.revenue - prev.revenue) / Math.abs(prev.revenue) : null;
      d.epsGrowth = (prev?.eps && d.eps != null)
        ? (d.eps - prev.eps) / Math.abs(prev.eps) : null;
    });

    const qDates = [...new Set((quarterlyMap.quarterlyTotalRevenue || []).map(p => p.date))]
      .sort((a, b) => a.localeCompare(b)).slice(-16);
    const quarterlyData = qDates.map(date => ({
      date: date.slice(0, 7),
      revenue: getVal(quarterlyMap, 'quarterlyTotalRevenue', date),
      netIncome: getVal(quarterlyMap, 'quarterlyNetIncome', date),
      eps: getVal(quarterlyMap, 'quarterlyDilutedEPS', date),
      totalAssets: getVal(quarterlyMap, 'quarterlyTotalAssets', date),
      totalLiabilities: getVal(quarterlyMap, 'quarterlyTotalLiabilitiesNetMinorityInterest', date),
      totalEquity: getVal(quarterlyMap, 'quarterlyTotalEquityGrossMinorityInterest', date)
        ?? getVal(quarterlyMap, 'quarterlyCommonStockEquity', date),
      cashChange: getVal(quarterlyMap, 'quarterlyChangesInCash', date),
      pe: getVal(quarterlyMap, 'quarterlyPeRatio', date),
      operatingCashFlow: getVal(quarterlyMap, 'quarterlyOperatingCashFlow', date),
      investingCashFlow: getVal(quarterlyMap, 'quarterlyInvestingCashFlow', date),
      financingCashFlow: getVal(quarterlyMap, 'quarterlyFinancingCashFlow', date),
    }));

    // Compute quarterly YoY growth (same quarter last year = index i-4)
    quarterlyData.forEach((d, i) => {
      const prevYear = quarterlyData[i - 4];
      d.revenueGrowth = (prevYear?.revenue && d.revenue != null)
        ? (d.revenue - prevYear.revenue) / Math.abs(prevYear.revenue) : null;
      d.epsGrowth = (prevYear?.eps && d.eps != null)
        ? (d.eps - prevYear.eps) / Math.abs(prevYear.eps) : null;
    });

    res.json({ annual: annualData, quarterly: quarterlyData });
  } catch (e) {
    console.error('API ERROR /charts:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Forward P/E via Alpha Vantage (free tier — requires ALPHA_VANTAGE_API_KEY env var).
// Yahoo's own forward-estimate data (quoteSummary/earningsTrend) is blocked with no free
// replacement (see fetchSummary), so this is best-effort: cached hard per ticker for 24h to
// stretch the free tier's tiny daily quota (~25 requests/day) across repeat views, and backs
// off entirely for an hour the moment Alpha Vantage signals the quota is used up, instead of
// burning what's left of the day's quota on requests that are just going to fail anyway.
const forwardPECache = {};
const FORWARD_PE_TTL_MS = 24 * 60 * 60 * 1000;
let avBackoffUntil = 0;

async function fetchForwardPE(ticker) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  const t = ticker.toUpperCase();
  const cached = forwardPECache[t];
  if (cached && Date.now() - cached.fetchedAt < FORWARD_PE_TTL_MS) return cached.value;
  if (Date.now() < avBackoffUntil) return cached?.value ?? null;
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${t}&apikey=${key}`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    // A quota/rate-limit response comes back as HTTP 200 with a "Note"/"Information" field
    // and no actual data (no Symbol) — not an HTTP error, so it must be checked explicitly.
    if (d.Note || d.Information || d['Error Message'] || !d.Symbol) {
      console.log('Alpha Vantage: quota/error response, backing off 1h:', JSON.stringify(d).slice(0, 150));
      avBackoffUntil = Date.now() + 60 * 60 * 1000;
      return cached?.value ?? null;
    }
    const value = (d.ForwardPE && d.ForwardPE !== 'None' && !isNaN(d.ForwardPE)) ? Number(d.ForwardPE) : null;
    forwardPECache[t] = { value, fetchedAt: Date.now() };
    return value;
  } catch (e) {
    console.error('Alpha Vantage fetch error:', e.message);
    return cached?.value ?? null;
  }
}

// Fetch company info from FMP (free tier — requires FMP_API_KEY env var)
async function fetchFMPProfile(ticker) {
  const key = process.env.FMP_API_KEY;
  if (!key) { console.log('FMP: no API key set'); return {}; }
  try {
    const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${key}`;
    const execUrl    = `https://financialmodelingprep.com/api/v3/key-executives/${ticker}?apikey=${key}`;
    console.log('FMP: fetching profile for', ticker);
    const [profileRes, execRes] = await Promise.all([
      fetch(profileUrl, { headers: YF_HEADERS }),
      fetch(execUrl,    { headers: YF_HEADERS }),
    ]);
    const profileData = await profileRes.json();
    const execData    = await execRes.json();
    console.log('FMP profile status:', profileRes.status, 'type:', typeof profileData, Array.isArray(profileData) ? 'array len=' + profileData.length : JSON.stringify(profileData).slice(0, 100));
    const p = Array.isArray(profileData) ? profileData[0] : (profileData && !profileData['Error Message'] ? profileData : null);
    const execs = Array.isArray(execData) ? execData : [];
    if (!p) { console.log('FMP: empty profile'); return {}; }

    const officers = execs.slice(0, 8).map(e => ({
      name:  e.name,
      title: e.title,
      age:   e.yearBorn ? (new Date().getFullYear() - e.yearBorn) : null,
      pay:   e.pay ? '$' + Number(e.pay).toLocaleString() : null,
    }));
    const ceo = officers.find(o => /ceo|chief executive/i.test(o.title || '')) || officers[0] || null;

    return {
      summary:   p.description   || null,
      sector:    p.sector        || null,
      industry:  p.industry      || null,
      country:   p.country       || null,
      city:      p.city          || null,
      website:   p.website       || null,
      employees: p.fullTimeEmployees ? Number(p.fullTimeEmployees) : null,
      image:     p.image         || null,
      exchange:  p.exchangeShortName || null,
      officers,
      ceo,
    };
  } catch (e) {
    console.error('FMP error:', e.message);
    return {};
  }
}

// Company profile — timeseries + chart always work; FMP adds company info
app.get('/api/profile/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();

    const [chart, tsMap, fmp] = await Promise.all([
      fetchChart(t).catch(() => ({})),
      fetchTimeSeries(t, [
        'annualTotalRevenue', 'annualNetIncome', 'annualNetIncomeRatio',
        'annualGrossProfitRatio', 'annualPeRatio', 'annualDilutedEPS',
        'annualFreeCashFlow', 'annualTotalDebt', 'annualCashAndCashEquivalents',
        'annualShareIssued', 'annualReturnOnEquity',
        'annualCommonStockEquity', 'annualEBITDA',
        // Quarterly counterparts for TTM/most-recent accuracy — same fix and reasoning as
        // getQuoteData (this endpoint never even attempted quoteSummary's live trailingPE,
        // so it went straight to the stale annual figure). Yahoo doesn't expose quarterly
        // ROE/gross-margin *ratios* directly, so those are recomputed below from quarterly
        // net income/gross profit/revenue instead.
        'quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyGrossProfit', 'quarterlyDilutedEPS',
        'quarterlyFreeCashFlow', 'quarterlyTotalDebt', 'quarterlyCashAndCashEquivalents',
        'quarterlyShareIssued', 'quarterlyCommonStockEquity', 'quarterlyEBITDA',
      ]).catch(() => ({})),
      fetchFMPProfile(t).catch(() => ({})),
    ]);

    const companyName = chart.name || t;

    // Financial metrics from timeseries — TTM (trailing twelve months) preferred over the
    // stale once-a-year annual figure; see getQuoteData for the full reasoning + a worked
    // example (NVDA: annual EPS $4.90 vs true TTM ~$7.91 as of 9/2026, inflating P/E 47 vs
    // the real ~29). latestPE now feeds directly into the investment thesis verdict below,
    // so this bug wasn't just a display issue — it could misprice the whole thesis.
    const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : null;
    const ttmRevenueNow    = ttmSum(tsMap, 'quarterlyTotalRevenue');
    const ttmRevenueYearAgo = ttmSum(tsMap, 'quarterlyTotalRevenue', 4);
    const latestRevenue    = ttmRevenueNow ?? latest(tsMap, 'annualTotalRevenue');
    // Growth-rate comparison must use a matched pair (both TTM, or both annual) — never mix
    // a TTM "now" figure against an annual "prior year" figure, which would overstate growth.
    const prevRevenue      = (ttmRevenueNow != null && ttmRevenueYearAgo != null)
      ? ttmRevenueYearAgo
      : (ttmRevenueNow == null ? ((tsMap.annualTotalRevenue || [])[1]?.value ?? null) : null);
    const latestNetIncome  = ttmSum(tsMap, 'quarterlyNetIncome') ?? latest(tsMap, 'annualNetIncome');
    const latestEPS        = ttmSum(tsMap, 'quarterlyDilutedEPS') ?? latest(tsMap, 'annualDilutedEPS');
    const latestPE         = (chart.price && latestEPS) ? chart.price / latestEPS : latest(tsMap, 'annualPeRatio');
    const latestDebt       = mostRecentOf(tsMap, 'quarterlyTotalDebt', 'annualTotalDebt');
    const latestCash       = mostRecentOf(tsMap, 'quarterlyCashAndCashEquivalents', 'annualCashAndCashEquivalents');
    const latestFCF        = ttmSum(tsMap, 'quarterlyFreeCashFlow') ?? latest(tsMap, 'annualFreeCashFlow');
    const netMarginRaw     = (latestRevenue && latestNetIncome != null ? latestNetIncome / latestRevenue : null)
                          ?? latest(tsMap, 'annualNetIncomeRatio');
    const ttmGrossProfit   = ttmSum(tsMap, 'quarterlyGrossProfit');
    const grossMarginRaw   = (ttmGrossProfit != null && latestRevenue) ? ttmGrossProfit / latestRevenue : latest(tsMap, 'annualGrossProfitRatio');
    const equity           = mostRecentOf(tsMap, 'quarterlyCommonStockEquity', 'annualCommonStockEquity');
    const roeRaw           = (latestNetIncome != null && equity) ? latestNetIncome / equity : latest(tsMap, 'annualReturnOnEquity');
    const ebitda           = ttmSum(tsMap, 'quarterlyEBITDA') ?? latest(tsMap, 'annualEBITDA');
    const sharesOut        = mostRecentOf(tsMap, 'quarterlyShareIssued', 'annualShareIssued');

    const revenueGrowthRaw = (latestRevenue && prevRevenue && prevRevenue !== 0)
      ? (latestRevenue - prevRevenue) / Math.abs(prevRevenue) * 100
      : null;
    const revenueGrowth = revenueGrowthRaw != null ? revenueGrowthRaw.toFixed(1) + '%' : null;

    const marketCap = (chart.price && sharesOut) ? chart.price * sharesOut : null;
    const pb = (chart.price && equity && sharesOut) ? chart.price / (equity / sharesOut) : null;
    const evToEbitda = (marketCap && ebitda) ? (marketCap + (latestDebt ?? 0) - (latestCash ?? 0)) / ebitda : null;

    // 5-year financial history
    const years = getYears(tsMap);
    const history = years.map(date => ({
      year:      date.slice(0, 4),
      revenue:   getVal(tsMap, 'annualTotalRevenue', date),
      netIncome: getVal(tsMap, 'annualNetIncome', date),
      eps:       getVal(tsMap, 'annualDilutedEPS', date),
      pe:        getVal(tsMap, 'annualPeRatio', date),
    }));

    const sectorPeers = getSectorPeerStats(t);
    const thesis = buildThesis({
      pe: latestPE,
      revenueGrowthRaw,
      netMarginRaw,
      latestDebt,
      latestCash,
      latestFCF,
      latestNetIncome,
      history,
      sectorMedianPE: sectorPeers?.median ?? null,
      sectorPeerCount: sectorPeers?.count ?? null,
      sectorLabel: sectorPeers?.label ?? null,
    });

    const fmtB = v => {
      if (v == null) return null;
      if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
      if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
      return '$' + v.toFixed(0);
    };

    res.json({
      name:      companyName,
      // Company info from FMP
      summary:   fmp.summary   || null,
      sector:    fmp.sector    || null,
      industry:  fmp.industry  || null,
      country:   fmp.country   || null,
      city:      fmp.city      || null,
      website:   fmp.website   || null,
      employees: fmp.employees || null,
      image:     fmp.image     || null,
      exchange:  fmp.exchange  || null,
      officers:  fmp.officers  || [],
      ceo:       fmp.ceo       || null,
      // Always available (from timeseries)
      peTrailing:      latestPE != null ? latestPE.toFixed(1) : null,
      pb:              pb != null ? pb.toFixed(1) : null,
      evToEbitda:      evToEbitda != null ? evToEbitda.toFixed(1) : null,
      netMargins:      fmtPct(netMarginRaw),
      grossMargins:    fmtPct(grossMarginRaw),
      roe:             fmtPct(roeRaw),
      revenueGrowth,
      latestRevenue:   fmtB(latestRevenue),
      latestNetIncome: fmtB(latestNetIncome),
      latestEPS:       latestEPS != null ? '$' + latestEPS.toFixed(2) : null,
      latestDebt:      fmtB(latestDebt),
      latestCash:      fmtB(latestCash),
      latestFCF:       fmtB(latestFCF),
      history,
      thesis,
    });
  } catch (e) {
    console.error('API ERROR /profile:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ticker autocomplete — symbol/name suggestions as the user types
app.get('/api/ticker-search/:query', async (req, res) => {
  try {
    const q = req.params.query.trim();
    if (!q) return res.json([]);
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    const results = (d.quotes || [])
      .filter(item => item.symbol && (item.quoteType === 'EQUITY' || item.quoteType === 'ETF'))
      .map(item => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || item.symbol,
        exchange: item.exchDisp || '',
        type: item.typeDisp || '',
      }));
    res.json(results);
  } catch (e) {
    console.error('API ERROR /ticker-search:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Latest news
app.get('/api/news/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${t}&quotesCount=0&newsCount=25&enableFuzzyQuery=false`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    const news = (d.news || []).map(item => ({
      title:     item.title,
      publisher: item.publisher,
      link:      item.link,
      time:      item.providerPublishTime,
      thumbnail: item.thumbnail?.resolutions?.[0]?.url || null,
    }));
    res.json(news);
  } catch (e) {
    console.error('API ERROR /news:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Debug: test FMP key and raw response
app.get('/api/debug-fmp/:ticker', async (req, res) => {
  const key = process.env.FMP_API_KEY;
  if (!key) return res.json({ error: 'FMP_API_KEY not set' });
  try {
    const url = `https://financialmodelingprep.com/api/v3/profile/${req.params.ticker.toUpperCase()}?apikey=${key}`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    res.json({ status: r.status, keyLength: key.length, data: d });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Price history chart
app.get('/api/price-history/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const view = req.query.view || 'monthly';
    const cfg = {
      daily:   { interval: '5m',  range: '1d'  },
      weekly:  { interval: '1h',  range: '5d'  },
      monthly: { interval: '1d',  range: '1mo' },
      yearly:  { interval: '1mo', range: 'max' },
      fiveyr:  { interval: '1mo', range: '5y'  },
      all:     { interval: '1mo', range: 'max' },
    };
    const { interval, range } = cfg[view] || cfg.monthly;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${t}?interval=${interval}&range=${range}`;
    const r = await fetch(url, { headers: YF_HEADERS });
    const d = await r.json();
    const result = d.chart?.result?.[0];
    if (!result) return res.json([]);
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];
    const round = (v) => v != null ? +v.toFixed(2) : null;
    let data = timestamps.map((ts, i) => ({
      time: ts,
      open: round(opens[i]),
      high: round(highs[i]),
      low: round(lows[i]),
      close: round(closes[i]),
      volume: volumes[i] ?? null,
    })).filter(d => d.close != null && d.open != null && d.high != null && d.low != null);

    // For yearly view: roll up the monthly candles into one candle per year
    // (open = first month's open, close = last month's close, high/low = extremes, volume = sum)
    if (view === 'yearly') {
      const byYear = {};
      data.forEach(p => {
        const yr = new Date(p.time * 1000).getFullYear();
        if (!byYear[yr]) {
          byYear[yr] = { time: p.time, open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume ?? 0 };
        } else {
          const y = byYear[yr];
          y.time = p.time; // keep latest timestamp in the year
          y.high = Math.max(y.high, p.high);
          y.low = Math.min(y.low, p.low);
          y.close = p.close;
          y.volume = (y.volume ?? 0) + (p.volume ?? 0);
        }
      });
      data = Object.values(byYear);
    }

    res.json(data);
  } catch (e) {
    console.error('API ERROR /price-history:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// EPS Estimates
app.get('/api/estimates/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const summary = await fetchSummary(t, ['earningsTrend', 'defaultKeyStatistics']);
    const trends = summary.earningsTrend?.trend || [];
    const kstats = summary.defaultKeyStatistics || {};
    const periodLabel = { '0q': 'רבעון נוכחי', '0y': 'שנה נוכחית', '+1y': 'שנה הבאה', '+5y': 'צמיחה שנתית 5 שנים' };
    const epsEstimates = trends
      .filter(tr => ['0q', '0y', '+1y', '+5y'].includes(tr.period))
      .map(tr => ({
        period: periodLabel[tr.period] || tr.period,
        epsLow: tr.earningsEstimate?.low ?? null,
        epsMid: tr.earningsEstimate?.avg ?? null,
        epsHigh: tr.earningsEstimate?.high ?? null,
        revenueAvg: tr.revenueEstimate?.avg ?? null,
        growthRate: tr.earningsEstimate?.growth ?? tr.growth ?? null,
        isPct: tr.period === '+5y',
        yearAgoEps: tr.earningsEstimate?.yearAgoEps ?? null,
      }));
    res.json({ epsEstimates, sharesOutstanding: kstats.sharesOutstanding ?? null });
  } catch (e) {
    console.error('API ERROR /estimates:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Calculator data
app.get('/api/calc-data/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [map, chart, summary] = await Promise.all([
      fetchTimeSeries(t, [
        'annualDilutedEPS', 'annualTotalRevenue', 'annualNetIncome', 'annualNetIncomeRatio', 'annualPeRatio', 'annualShareIssued',
        // Quarterly counterparts, used only for the "current" TTM snapshot below — the
        // year-by-year `history` chart intentionally stays annual (it's showing fiscal years).
        'quarterlyDilutedEPS', 'quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyShareIssued',
      ]),
      fetchChart(t),
      fetchSummary(t, ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'earningsTrend']),
    ]);

    const years = getYears(map);
    const history = years.map(date => {
      const revenue = getVal(map, 'annualTotalRevenue', date);
      const netIncome = getVal(map, 'annualNetIncome', date);
      const netMarginRaw = getVal(map, 'annualNetIncomeRatio', date);
      const netMargin = netMarginRaw ?? (revenue && netIncome != null ? netIncome / revenue : null);
      return {
        year: date.slice(0, 4),
        eps: getVal(map, 'annualDilutedEPS', date),
        revenue, netIncome, netMargin,
        pe: getVal(map, 'annualPeRatio', date),
      };
    }).reverse();

    const fd = summary.financialData || {};
    const ks = summary.defaultKeyStatistics || {};
    const sd = summary.summaryDetail || {};
    const trend5y = summary.earningsTrend?.trend?.find(tr => tr.period === '+5y');

    const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding
      ?? mostRecentOf(map, 'quarterlyShareIssued', 'annualShareIssued');
    const price = fd.currentPrice ?? chart.price ?? null;
    const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

    // Same TTM-over-stale-annual fix as getQuoteData (see comment there) — the "current"
    // snapshot pre-fills the calculator's starting assumptions and must reflect trailing
    // twelve months, not whatever the last full fiscal year happened to report.
    const tsRevenue = ttmSum(map, 'quarterlyTotalRevenue') ?? latest(map, 'annualTotalRevenue');
    const tsNetIncome = ttmSum(map, 'quarterlyNetIncome') ?? latest(map, 'annualNetIncome');
    const latestNetMargin = fd.profitMargins
      ?? (tsRevenue && tsNetIncome != null ? tsNetIncome / tsRevenue : null)
      ?? latest(map, 'annualNetIncomeRatio')
      ?? history[0]?.netMargin ?? null;
    const ttmEPS = ttmSum(map, 'quarterlyDilutedEPS');
    const currentPe = sd.trailingPE ?? (price && ttmEPS ? price / ttmEPS : null) ?? latest(map, 'annualPeRatio');
    const currentEps = ks.trailingEps ?? ttmEPS ?? latest(map, 'annualDilutedEPS');

    const ttmRevenueYearAgo = ttmSum(map, 'quarterlyTotalRevenue', 4);
    const lastIdx = history.length - 1;
    const annualRevenueGrowth = (lastIdx >= 1 && history[lastIdx]?.revenue && history[lastIdx - 1]?.revenue && history[lastIdx - 1].revenue !== 0)
      ? (history[lastIdx].revenue - history[lastIdx - 1].revenue) / Math.abs(history[lastIdx - 1].revenue) : null;
    const calcRevenueGrowth = (tsRevenue != null && ttmRevenueYearAgo)
      ? (tsRevenue - ttmRevenueYearAgo) / Math.abs(ttmRevenueYearAgo)
      : annualRevenueGrowth;

    res.json({
      history,
      current: {
        price,
        pe: currentPe,
        eps: currentEps,
        netMargin: latestNetMargin,
        marketCap,
        sharesOutstanding,
        revenueGrowth: fd.revenueGrowth ?? calcRevenueGrowth,
        analystGrowth5y: trend5y?.growth ?? null,
      },
    });
  } catch (e) {
    console.error('API ERROR /calc-data:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Serve built frontend
const path = require('path');
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath, { dotfiles: 'allow' }));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
