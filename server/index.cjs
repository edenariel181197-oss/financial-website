const { fetch, Agent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new Agent({ maxHeaderSize: 131072, headersTimeout: 60000 }));
globalThis.fetch = fetch;

const express = require('express');
const cors = require('cors');

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

// Quote
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

    const tsRevenue = latest(tsMap, 'annualTotalRevenue');
    const tsNetIncome = latest(tsMap, 'annualNetIncome');
    const netMargin = fd.profitMargins
      ?? latest(tsMap, 'annualNetIncomeRatio')
      ?? (tsRevenue && tsNetIncome ? tsNetIncome / tsRevenue : null);

    const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding ?? latest(tsMap, 'annualShareIssued');
    const price = chart.price;
    const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

    res.json({
      symbol: t,
      name: chart.name,
      price,
      change: chart.change,
      changePercent: chart.changePercent,
      pe: sd.trailingPE ?? latest(tsMap, 'annualPeRatio'),
      eps: ks.trailingEps ?? latest(tsMap, 'annualDilutedEPS'),
      netMargin,
      marketCap,
      sharesOutstanding,
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
        'annualChangesInCash', 'annualDilutedEPS',
      ]),
      fetchTimeSeries(t, ['quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyDilutedEPS']),
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
      eps: getVal(annualMap, 'annualDilutedEPS', date),
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

// Fetch company info from FMP (free tier — requires FMP_API_KEY env var)
async function fetchFMPProfile(ticker) {
  const key = process.env.FMP_API_KEY;
  if (!key) return {};
  try {
    const [profileRes, execRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${key}`, { headers: YF_HEADERS }),
      fetch(`https://financialmodelingprep.com/api/v3/key-executives/${ticker}?apikey=${key}`, { headers: YF_HEADERS }),
    ]);
    const profileData = await profileRes.json();
    const execData    = await execRes.json();
    const p = Array.isArray(profileData) ? profileData[0] : null;
    const execs = Array.isArray(execData) ? execData : [];
    if (!p) return {};

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
      ]).catch(() => ({})),
      fetchFMPProfile(t).catch(() => ({})),
    ]);

    const companyName = chart.name || t;

    // Financial metrics from timeseries
    const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : null;
    const latestRevenue    = latest(tsMap, 'annualTotalRevenue');
    const prevRevenue      = (tsMap.annualTotalRevenue || [])[1]?.value ?? null;
    const latestNetIncome  = latest(tsMap, 'annualNetIncome');
    const latestEPS        = latest(tsMap, 'annualDilutedEPS');
    const latestPE         = latest(tsMap, 'annualPeRatio');
    const latestDebt       = latest(tsMap, 'annualTotalDebt');
    const latestCash       = latest(tsMap, 'annualCashAndCashEquivalents');
    const latestFCF        = latest(tsMap, 'annualFreeCashFlow');
    const netMarginRaw     = latest(tsMap, 'annualNetIncomeRatio');
    const grossMarginRaw   = latest(tsMap, 'annualGrossProfitRatio');
    const roeRaw           = latest(tsMap, 'annualReturnOnEquity');

    const revenueGrowth = (latestRevenue && prevRevenue && prevRevenue !== 0)
      ? ((latestRevenue - prevRevenue) / Math.abs(prevRevenue) * 100).toFixed(1) + '%'
      : null;

    // 5-year financial history
    const years = getYears(tsMap);
    const history = years.map(date => ({
      year:      date.slice(0, 4),
      revenue:   getVal(tsMap, 'annualTotalRevenue', date),
      netIncome: getVal(tsMap, 'annualNetIncome', date),
      eps:       getVal(tsMap, 'annualDilutedEPS', date),
      pe:        getVal(tsMap, 'annualPeRatio', date),
    }));

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
    });
  } catch (e) {
    console.error('API ERROR /profile:', e.message);
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
    const closes = result.indicators?.quote?.[0]?.close || [];
    let data = timestamps.map((ts, i) => ({
      time: ts,
      close: closes[i] != null ? +closes[i].toFixed(2) : null,
    })).filter(d => d.close != null);

    // For yearly view: aggregate full history to one point per year (last close of each year)
    if (view === 'yearly') {
      const byYear = {};
      data.forEach(p => {
        const yr = new Date(p.time * 1000).getFullYear();
        byYear[yr] = p; // last point in each year wins
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

    const sharesOutstanding = ks.sharesOutstanding ?? chart.sharesOutstanding ?? latest(map, 'annualShareIssued');
    const price = fd.currentPrice ?? chart.price ?? null;
    const marketCap = chart.marketCap ?? (sharesOutstanding && price ? sharesOutstanding * price : null);

    const tsRevenue = latest(map, 'annualTotalRevenue');
    const tsNetIncome = latest(map, 'annualNetIncome');
    const latestNetMargin = fd.profitMargins
      ?? latest(map, 'annualNetIncomeRatio')
      ?? (tsRevenue && tsNetIncome ? tsNetIncome / tsRevenue : null)
      ?? history[0]?.netMargin ?? null;

    const lastIdx = history.length - 1;
    const calcRevenueGrowth = (lastIdx >= 1 && history[lastIdx]?.revenue && history[lastIdx - 1]?.revenue && history[lastIdx - 1].revenue !== 0)
      ? (history[lastIdx].revenue - history[lastIdx - 1].revenue) / Math.abs(history[lastIdx - 1].revenue) : null;

    res.json({
      history,
      current: {
        price,
        pe: sd.trailingPE ?? latest(map, 'annualPeRatio'),
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
