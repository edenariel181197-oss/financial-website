const { fetch, Agent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new Agent({ maxHeaderSize: 131072, headersTimeout: 60000 }));
globalThis.fetch = fetch;

const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], validation: { logErrors: false, logOptionsErrors: false } });
const YF_OPTS = { validateResult: false };
const app = express();
app.use(cors());
app.use((req, res, next) => { console.log('REQ:', req.method, req.path); next(); });

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const PERIOD1 = 1451606400; // 2016-01-01
const PERIOD2 = 2000000000;

// Fetch from Yahoo Finance timeseries API (reliable, no crumb needed)
async function fetchTimeSeries(ticker, types) {
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?type=${types.join(',')}&period1=${PERIOD1}&period2=${PERIOD2}`;
  const r = await fetch(url, { headers: YF_HEADERS });
  const d = await r.json();
  const results = d.timeseries?.result || [];
  const map = {};
  for (const series of results) {
    const key = series.meta?.type?.[0];
    if (key) {
      // Get all data points sorted by date descending
      const dataKey = key;
      const points = series[dataKey] || [];
      map[key] = points
        .filter(p => p)
        .sort((a, b) => new Date(b.asOfDate) - new Date(a.asOfDate))
        .map(p => ({ date: p.asOfDate, value: p.reportedValue?.raw ?? p.reportedValue }));
    }
  }
  return map;
}

// Get all years covered in the series
function getYears(map) {
  const allDates = Object.values(map).flatMap(series => series.map(p => p.date));
  return [...new Set(allDates)].sort((a, b) => b.localeCompare(a)).slice(0, 5);
}

function getVal(map, key, date) {
  const series = map[key] || [];
  const point = series.find(p => p.date === date);
  return point?.value ?? null;
}

// Quote endpoint — uses yahoo-finance2 (has crumb cached from previous call)
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const [q, stats] = await Promise.allSettled([
      yf.quote(t, {}, YF_OPTS),
      yf.quoteSummary(t, { modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'] }, YF_OPTS),
    ]);
    const quote = q.status === 'fulfilled' ? q.value : {};
    const summary = stats.status === 'fulfilled' ? stats.value : {};
    const fin = summary.financialData || {};
    const kstats = summary.defaultKeyStatistics || {};
    const sd = summary.summaryDetail || {};
    res.json({
      symbol: t,
      name: quote.longName || quote.shortName,
      price: quote.regularMarketPrice,
      pe: sd.trailingPE,
      forwardPE: sd.forwardPE,
      eps: kstats.trailingEps,
      netMargin: fin.profitMargins,
      marketCap: quote.marketCap,
      sharesOutstanding: kstats.sharesOutstanding,
    });
  } catch (e) {
    console.error('API ERROR:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Quarterly data
app.get('/api/quarterly/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const types = ['quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyBasicEPS'];
    const map = await fetchTimeSeries(t, types);
    const dates = [...new Set([
      ...(map.quarterlyTotalRevenue || []).map(p => p.date),
    ])].sort((a, b) => b.localeCompare(a)).slice(0, 12);

    const result = dates.map(date => ({
      date,
      revenue: getVal(map, 'quarterlyTotalRevenue', date),
      netIncome: getVal(map, 'quarterlyNetIncome', date),
      eps: getVal(map, 'quarterlyBasicEPS', date),
    }));
    res.json(result);
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Income statement
app.get('/api/income/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const types = [
      'annualTotalRevenue', 'annualCostOfRevenue', 'annualGrossProfit', 'annualGrossProfitRatio',
      'annualSellingGeneralAndAdministration', 'annualResearchAndDevelopment',
      'annualOtherGandA', 'annualOperatingIncome', 'annualOperatingIncomeRatio',
      'annualNetInterestIncome', 'annualInterestExpense', 'annualIncomeTaxExpense',
      'annualNetIncome', 'annualNetIncomeCommonStockholders', 'annualNetIncomeRatio',
    ];
    const map = await fetchTimeSeries(t, types);
    const years = getYears(map);
    const result = years.map(date => ({
      date,
      revenue: getVal(map, 'annualTotalRevenue', date),
      costOfRevenue: getVal(map, 'annualCostOfRevenue', date),
      grossProfit: getVal(map, 'annualGrossProfit', date),
      grossProfitRatio: getVal(map, 'annualGrossProfitRatio', date),
      sellingAndMarketingExpenses: getVal(map, 'annualSellingGeneralAndAdministration', date),
      generalAndAdministrativeExpenses: getVal(map, 'annualOtherGandA', date),
      otherExpenses: getVal(map, 'annualResearchAndDevelopment', date),
      operatingIncome: getVal(map, 'annualOperatingIncome', date),
      operatingIncomeRatio: getVal(map, 'annualOperatingIncomeRatio', date),
      interestExpense: getVal(map, 'annualInterestExpense', date),
      incomeTaxExpense: getVal(map, 'annualIncomeTaxExpense', date),
      netIncome: getVal(map, 'annualNetIncome', date),
      netIncomeRatio: getVal(map, 'annualNetIncomeRatio', date),
    }));
    res.json(result);
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Balance sheet
app.get('/api/balance/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const types = [
      'annualCashAndCashEquivalents', 'annualShortTermInvestments', 'annualAccountsReceivable',
      'annualInventory', 'annualOtherCurrentAssets', 'annualCurrentAssets',
      'annualLongTermInvestments', 'annualNetPPE', 'annualGoodwill', 'annualOtherIntangibleAssets',
      'annualTotalNonCurrentAssets', 'annualTotalAssets',
      'annualCurrentDebt', 'annualAccountsPayable', 'annualOtherCurrentLiabilities',
      'annualCurrentLiabilities', 'annualLongTermDebt', 'annualOtherNonCurrentLiabilities',
      'annualTotalLiabilitiesNetMinorityInterest',
      'annualCommonStock', 'annualRetainedEarnings', 'annualCommonStockEquity',
    ];
    const map = await fetchTimeSeries(t, types);
    const years = getYears(map);
    const result = years.map(date => ({
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
    }));
    res.json(result);
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Cash flow
app.get('/api/cashflow/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const types = [
      'annualNetIncome', 'annualDepreciationAmortizationDepletion', 'annualChangeInWorkingCapital',
      'annualOperatingCashFlow', 'annualCapitalExpenditure', 'annualPurchaseOfBusiness',
      'annualInvestingCashFlow', 'annualLongTermDebtIssuance', 'annualRepurchaseOfCapitalStock',
      'annualCashDividendsPaid', 'annualFinancingCashFlow', 'annualFreeCashFlow',
      'annualChangesInCash',
    ];
    const map = await fetchTimeSeries(t, types);
    const years = getYears(map);
    const result = years.map(date => ({
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
    }));
    res.json(result);
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Ratios
app.get('/api/ratios/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const data = await yf.quoteSummary(t, { modules: ['financialData'] }, YF_OPTS);
    const fin = data.financialData;
    res.json({
      currentRatioTTM: fin?.currentRatio,
      quickRatioTTM: fin?.quickRatio,
      grossProfitMarginTTM: fin?.grossMargins,
      operatingProfitMarginTTM: fin?.operatingMargins,
      netProfitMarginTTM: fin?.profitMargins,
      returnOnEquityTTM: fin?.returnOnEquity,
      returnOnAssetsTTM: fin?.returnOnAssets,
      longTermDebtToCapitalizationTTM: fin?.debtToEquity ? fin.debtToEquity / 100 : null,
      daysOfSalesOutstandingTTM: null,
      daysPayablesOutstandingTTM: null,
      daysOfInventoryOutstandingTTM: null,
      cashConversionCycleTTM: null,
    });
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// P/E history (annual) + quarterly income for charts
app.get('/api/charts/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const annualTypes = [
      'annualTotalRevenue', 'annualNetIncome', 'annualPeRatio',
      'annualTotalAssets', 'annualTotalLiabilitiesNetMinorityInterest',
      'annualChangesInCash',
    ];
    const quarterlyTypes = [
      'quarterlyTotalRevenue', 'quarterlyNetIncome',
    ];
    const [annualMap, quarterlyMap] = await Promise.all([
      fetchTimeSeries(t, annualTypes),
      fetchTimeSeries(t, quarterlyTypes),
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
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Future EPS estimates
app.get('/api/estimates/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const data = await yf.quoteSummary(t, { modules: ['earningsTrend', 'defaultKeyStatistics'] }, YF_OPTS);
    const trends = data.earningsTrend?.trend || [];
    const kstats = data.defaultKeyStatistics;

    const periodLabel = { '0q': 'רבעון נוכחי', '0y': 'שנה נוכחית', '+1y': 'שנה הבאה', '+5y': 'צמיחה שנתית 5 שנים' };
    const epsEstimates = trends
      .filter(tr => ['0q', '0y', '+1y', '+5y'].includes(tr.period))
      .map(tr => ({
        period: periodLabel[tr.period] || tr.period,
        epsLow: tr.earningsEstimate?.low,
        epsMid: tr.earningsEstimate?.avg,
        epsHigh: tr.earningsEstimate?.high,
        revenueAvg: tr.revenueEstimate?.avg,
        growthRate: tr.earningsEstimate?.growth ?? tr.growth,
        isPct: tr.period === '+5y',
        yearAgoEps: tr.earningsEstimate?.yearAgoEps,
      }));

    res.json({ epsEstimates, sharesOutstanding: kstats?.sharesOutstanding });
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Calculator data — EPS history + income history for both calculators
app.get('/api/calc-data/:ticker', async (req, res) => {
  try {
    const t = req.params.ticker.toUpperCase();
    const annualTypes = [
      'annualDilutedEPS', 'annualTotalRevenue', 'annualNetIncome',
      'annualNetIncomeRatio', 'annualPeRatio',
    ];
    const [annualMap, quoteResult, estimatesResult] = await Promise.allSettled([
      fetchTimeSeries(t, annualTypes),
      yf.quoteSummary(t, { modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'] }, YF_OPTS),
      yf.quoteSummary(t, { modules: ['earningsTrend'] }, YF_OPTS),
    ]);

    const map = annualMap.status === 'fulfilled' ? annualMap.value : {};
    const quoteData = quoteResult.status === 'fulfilled' ? quoteResult.value : {};
    const estimates = estimatesResult.status === 'fulfilled' ? estimatesResult.value : null;

    const years = getYears(map);
    const history = years.map(date => {
      const revenue = getVal(map, 'annualTotalRevenue', date);
      const netIncome = getVal(map, 'annualNetIncome', date);
      const netMarginRaw = getVal(map, 'annualNetIncomeRatio', date);
      const netMargin = netMarginRaw ?? (revenue && netIncome != null ? netIncome / revenue : null);
      return {
        year: date.slice(0, 4),
        eps: getVal(map, 'annualDilutedEPS', date),
        revenue,
        netIncome,
        netMargin,
        pe: getVal(map, 'annualPeRatio', date),
      };
    }).reverse();

    const fin = quoteData.financialData || {};
    const kstats = quoteData.defaultKeyStatistics || {};
    const summary = quoteData.summaryDetail || {};

    // Forward EPS growth estimate from analyst
    const trend5y = estimates?.earningsTrend?.trend?.find(t => t.period === '+5y');
    const fwdGrowth = trend5y?.growth ?? null;

    // Fallback: compute from history if Yahoo live values are missing
    const latestNetMargin = fin?.profitMargins
      ?? (history[0]?.netMargin != null ? history[0].netMargin : null);

    const calcRevenueGrowth = (history[0]?.revenue && history[1]?.revenue && history[1].revenue !== 0)
      ? (history[0].revenue - history[1].revenue) / Math.abs(history[1].revenue)
      : null;
    const latestRevenueGrowth = fin?.revenueGrowth ?? calcRevenueGrowth;

    res.json({
      history,
      current: {
        price: fin?.currentPrice ?? kstats?.currentPrice,
        pe: summary?.trailingPE,
        forwardPE: summary?.forwardPE,
        eps: kstats?.trailingEps,
        netMargin: latestNetMargin,
        marketCap: fin?.marketCap ?? kstats?.marketCap
          ?? (kstats?.sharesOutstanding && fin?.currentPrice
              ? kstats.sharesOutstanding * fin.currentPrice : null),
        sharesOutstanding: kstats?.sharesOutstanding,
        revenueGrowth: latestRevenueGrowth,
        analystGrowth5y: fwdGrowth,
      },
    });
  } catch (e) {
    console.error('API ERROR:', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: e.message });
  }
});

// Serve built frontend (production)
const path = require('path');
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
