const { fetch, Agent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new Agent({ maxHeaderSize: 131072, headersTimeout: 60000 }));
globalThis.fetch = fetch;

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use((req, res, next) => { console.log('REQ:', req.method, req.path); next(); });

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};
const PERIOD1 = 1451606400; // 2016-01-01
const PERIOD2 = 2000000000;

// ── Crumb management (for quoteSummary v10) ──────────────────────
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
    return {
      price: meta.regularMarketPrice ?? null,
      name: meta.longName || meta.shortName || ticker,
      marketCap: meta.marketCap ?? null,
      sharesOutstanding: meta.sharesOutstanding ?? null,
      currency: meta.currency ?? 'USD',
    };
  } catch (e) {
    console.error('fetchChart error:', e.message);
    return {};
  }
}

async function fetchSummary(ticker, modules) {
  // Try v6 first (no crumb needed), fallback to v10 with crumb
  try {
    const mods = modules.join(',');
    const url6 = `https://query2.finance.yahoo.com/v6/finance/quoteSummary/${ticker}?modules=${mods}`;
    const r = await fetch(url6, { headers: YF_HEADERS });
    const d = await r.json();
    if (d.quoteSummary?.result?.[0]) return d.quoteSummary.result[0];
  } catch (e) {
    console.error('fetchSummary v6 error:', e.message);
  }
  // Fallback: v10 with crumb
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

function getYears(map) {
  const allDates = Object.values(map).flatMap(s => s.map(p => p.date));
  return [...new Set(allDates)].sort((a, b) => b.localeCompare(a)).slice(0, 5);
}

function getVal(map, key, date) {
  return (map[key] || []).find(p => p.date === date)?.value ?? null;
}

function latest(map, key) {
  return (map[key] || [])[0]?.value ?? null;
}

// ════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ════════════════════════════════════════════════════════════════

// Quote — price, market cap, PE, EPS, margins
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [chart, tsMap, summary] = await Promise.all([
      fetchChart(t),
      fetchTimeSeries(t, ['annualDilutedEPS', 'annualNetIncomeRatio', 'annualPeRatio', 'annualTotalRevenue', 'annualNetIncome', 'annualShareIssued']),
      fetchSummary(t, ['summaryDetail', 'defaultKeyStatistics', 'financialData']),
    ]);

    const sd = summary.summaryDetail || {};
    const ks = summary.defaultKeyStatistics || {};
    const fd = summary.financialData || {};

    // netMargin: prefer live, fallback to ratio field, fallback to compute from timeseries
    const tsRevenue = latest(tsMap, 'annualTotalRevenue');
    const tsNetIncome = latest(tsMap, 'annualNetIncome');
    const netMargin = fd.profitMargins
      ?? latest(tsMap, 'annualNetIncomeRatio')
      ?? (tsRevenue && tsNetIncome ? tsNetIncome / tsRevenue : null);

    // shares: from quoteSummary, chart meta, or timeseries
    const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding ?? latest(tsMap, 'annualShareIssued');

    // marketCap: from chart meta, or compute
    const price = chart.price;
    const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

    res.json({
      symbol: t,
      name: chart.name,
      price,
      pe: sd.trailingPE ?? latest(tsMap, 'annualPeRatio'),
      forwardPE: sd.forwardPE ?? (ks.forwardEps && chart.price ? chart.price / ks.forwardEps : null),
      eps: ks.trailingEps ?? latest(tsMap, 'annualDilutedEPS'),
      netMargin,
      marketCap,
      sharesOutstanding,
      forwardPE: sd.forwardPE ?? (ks.forwardEps && price ? price / ks.forwardEps : null),
    });
  } catch (e) {
    console.error('API ERROR /quote:', e.message);
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
    ]);
    const years = getYears(map);
    res.json(years.map(date => ({
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
      totalAssets: getVal(map, 'annualTotalAssets', date),
      shortTermDebt: getVal(map, 'annualCurrentDebt', date),
      accountPayables: getVal(map, 'annualAccountsPayable', date),
      otherCurrentLiabilities: getVal(map, 'annualOtherCurrentLiabilities', date),
      totalCurrentLiabilities: getVal(map, 'annualCurrentLiabilities', date),
      longTermDebt: getVal(map, 'annualLongTermDebt', date),
      otherNonCurrentLiabilities: getVal(map, 'annualOtherNonCurrentLiabilities', date),
      totalLiabilities: getVal(map, 'annualTotalLiabilitiesNetMinorityInterest', date),
      commonStock: getVal(map, 'annualCommonStock', date),
      retainedEarnings: getVal(map, 'annualRetainedEarnings', date),
      totalStockholdersEquity: getVal(map, 'annualCommonStockEquity', date),
    })));
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
    res.json(years.map(date => ({
      date,
      netIncome: getVal(map, 'annualNetIncome', date),
      depreciationAndAmortization: getVal(map, 'annualDepreciationAmortizationDepletion', date),
      changeInWorkingCapital: getVal(map, 'annualChangeInWorkingCapital', date),
      netCashProvidedByOperatingActivities: getVal(map, 'annualOperatingCashFlow', date),
      capitalExpenditure: getVal(map, 'annualCapitalExpenditure', date),
      acquisitionsNet: getVal(map, 'annualPurchaseOfBusiness', date),
      netCashUsedForInvestingActivites: getVal(map, 'annualInvestingCashFlow', date),
      debtRepayment: getVal(map, 'annualLongTermDebtIssuance', date),
      commonStockRepurchased: getVal(map, 'annualRepurchaseOfCapitalStock', date),
      dividendsPaid: getVal(map, 'annualCashDividendsPaid', date),
      netCashUsedProvidedByFinancingActivities: getVal(map, 'annualFinancingCashFlow', date),
      netChangeInCash: getVal(map, 'annualChangesInCash', date),
      freeCashFlow: getVal(map, 'annualFreeCashFlow', date),
    })));
  } catch (e) {
    console.error('API ERROR /cashflow:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ratios — from timeseries where possible, quoteSummary as bonus
app.get('/api/ratios/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [map, summary] = await Promise.all([
      fetchTimeSeries(t, ['annualGrossProfitRatio', 'annualOperatingIncomeRatio', 'annualNetIncomeRatio']),
      fetchSummary(t, ['financialData']),
    ]);
    const fd = summary.financialData || {};
    res.json({
      currentRatioTTM: fd.currentRatio ?? null,
      quickRatioTTM: fd.quickRatio ?? null,
      grossProfitMarginTTM: fd.grossMargins ?? latest(map, 'annualGrossProfitRatio'),
      operatingProfitMarginTTM: fd.operatingMargins ?? latest(map, 'annualOperatingIncomeRatio'),
      netProfitMarginTTM: fd.profitMargins ?? latest(map, 'annualNetIncomeRatio'),
      returnOnEquityTTM: fd.returnOnEquity ?? null,
      returnOnAssetsTTM: fd.returnOnAssets ?? null,
      longTermDebtToCapitalizationTTM: fd.debtToEquity ? fd.debtToEquity / 100 : null,
      daysOfSalesOutstandingTTM: null,
      daysPayablesOutstandingTTM: null,
      daysOfInventoryOutstandingTTM: null,
      cashConversionCycleTTM: null,
    });
  } catch (e) {
    console.error('API ERROR /ratios:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Charts
app.get('/api/charts/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [annualMap, quarterlyMap] = await Promise.all([
      fetchTimeSeries(t, ['annualTotalRevenue', 'annualNetIncome', 'annualPeRatio', 'annualTotalAssets', 'annualTotalLiabilitiesNetMinorityInterest', 'annualChangesInCash']),
      fetchTimeSeries(t, ['quarterlyTotalRevenue', 'quarterlyNetIncome']),
    ]);
    const annualYears = getYears(annualMap);
    const annualData = annualYears.map(date => ({
      date: date.slice(0, 4),
      revenue: getVal(annualMap, 'annualTotalRevenue', date),
      netIncome: getVal(annualMap, 'annualNetIncome', date),
      totalAssets: getVal(annualMap, 'annualTotalAssets', date),
      totalLiabilities: getVal(annualMap, 'annualTotalLiabilitiesNetMinorityInterest', date),
      cashChange: getVal(annualMap, 'annualChangesInCash', date),
      pe: getVal(annualMap, 'annualPeRatio', date),
    })).reverse();

    const qDates = [...new Set((quarterlyMap.quarterlyTotalRevenue || []).map(p => p.date))]
      .sort((a, b) => a.localeCompare(b)).slice(-12);
    const quarterlyData = qDates.map(date => ({
      date: date.slice(0, 7),
      revenue: getVal(quarterlyMap, 'quarterlyTotalRevenue', date),
      netIncome: getVal(quarterlyMap, 'quarterlyNetIncome', date),
    }));

    res.json({ annual: annualData, quarterly: quarterlyData });
  } catch (e) {
    console.error('API ERROR /charts:', e.message);
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
      fetchTimeSeries(t, ['annualDilutedEPS', 'annualTotalRevenue', 'annualNetIncome', 'annualNetIncomeRatio', 'annualPeRatio', 'annualShareIssued']),
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

    const latestNetMargin = latestNetMarginCalc;
    const calcRevenueGrowth = (history[0]?.revenue && history[1]?.revenue && history[1].revenue !== 0)
      ? (history[0].revenue - history[1].revenue) / Math.abs(history[1].revenue) : null;

    const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding ?? latest(map, 'annualShareIssued');
    const price = fd.currentPrice ?? chart.price ?? null;
    const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

    const tsRevenue = latest(map, 'annualTotalRevenue');
    const tsNetIncome = latest(map, 'annualNetIncome');
    const latestNetMarginCalc = fd.profitMargins
      ?? latest(map, 'annualNetIncomeRatio')
      ?? (tsRevenue && tsNetIncome ? tsNetIncome / tsRevenue : null)
      ?? history[0]?.netMargin ?? null;

    res.json({
      history,
      current: {
        price,
        pe: sd.trailingPE ?? latest(map, 'annualPeRatio'),
        forwardPE: sd.forwardPE ?? null,
        eps: ks.trailingEps ?? latest(map, 'annualDilutedEPS'),
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
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
