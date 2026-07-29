import { useState, useEffect } from 'react';
import { FileText, TrendingUp, Percent } from 'lucide-react';
import { getIncomeStatement, getBalanceSheet, getCashFlow, getRatios, fmt, fmtPct, fmtRaw } from '../utils/api';
import SectionHeader from './ui/SectionHeader';
import SegmentedToggle from './ui/SegmentedToggle';
import KpiCard from './ui/KpiCard';
import Badge from './ui/Badge';

const TABS = ['דוח רווח והפסד', 'דוח מאזן', 'תזרים מזומנים', 'יחסים פיננסיים'];

// rows[0] is the newest year (server sorts descending) — CAGR spans rows[0]..rows[last].
function calcCAGR(rows, key) {
  if (!rows?.length || rows.length < 2) return null;
  const newest = rows[0]?.[key];
  const oldest = rows[rows.length - 1]?.[key];
  if (newest == null || oldest == null || oldest <= 0) return null;
  const years = rows.length - 1;
  return Math.pow(newest / oldest, 1 / years) - 1;
}

export default function FinancialReports({ ticker }) {
  const [activeTab, setActiveTab] = useState(0);
  const [data, setData] = useState({ income: null, balance: null, cashflow: null, ratios: null });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoaded(false);
    setLoading(true);
    setError(null);
    Promise.all([
      getIncomeStatement(ticker),
      getBalanceSheet(ticker),
      getCashFlow(ticker),
      getRatios(ticker),
    ]).then(([income, balance, cashflow, ratios]) => {
      setData({ income, balance, cashflow, ratios });
      setLoaded(true);
      setLoading(false);
    }).catch(() => {
      setError('שגיאה בטעינת דוחות כספיים');
      setLoading(false);
    });
  }, [ticker]);

  if (!ticker) return <div className="no-ticker">הכנס טיקר בראש העמוד לצפייה בדוחות</div>;
  if (loading) return <div className="data-loading">טוען דוחות כספיים...</div>;
  if (error) return <div className="data-error">{error}</div>;
  if (!loaded) return null;

  const years = data.income?.slice(0, 5).map(d => d.date?.slice(0, 4)) || [];

  return (
    <div className="reports-container">
      <SectionHeader title="דוחות כספיים" description="דוח רווח והפסד, מאזן, תזרים מזומנים ויחסים פיננסיים" icon={FileText} />
      <div className="report-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab-btn ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 0 && <IncomeTab data={data.income} years={years} />}
      {activeTab === 1 && <BalanceTab data={data.balance} years={years} />}
      {activeTab === 2 && <CashFlowTab data={data.cashflow} years={years} />}
      {activeTab === 3 && <RatiosTab ratios={data.ratios} />}
    </div>
  );
}

function IncomeTab({ data, years }) {
  if (!data?.length) return <div className="no-data">אין נתונים</div>;

  const rows5 = data.slice(0, 5);
  const ttm = rows5[0];
  const revenueCAGR = calcCAGR(rows5, 'revenue');
  const grossMarginTTM = (ttm.revenue && ttm.grossProfit != null) ? ttm.grossProfit / ttm.revenue : null;
  const opMarginTTM = (ttm.revenue && ttm.operatingIncome != null) ? ttm.operatingIncome / ttm.revenue : null;
  const netMarginTTM = (ttm.revenue && ttm.netIncome != null) ? ttm.netIncome / ttm.revenue : null;

  const row = (label, key, formatter = fmt, opts = {}) => {
    const { highlight = false } = opts;
    return (
      <tr key={label} className={highlight ? 'subtotal-row' : undefined}>
        <td className="row-label">{label}</td>
        {rows5.map((d, i) => (
          <td key={i} className="number">{formatter(d[key])}</td>
        ))}
      </tr>
    );
  };

  const marginRow = (label, numeratorKey) => {
    const pctSeries = rows5.map(d => d.revenue && d[numeratorKey] != null ? d[numeratorKey] / d.revenue : null);
    return (
      <tr key={label} className="margin-row">
        <td className="row-label">{label}</td>
        {pctSeries.map((pct, i) => (
          <td key={i} className="center">
            {pct != null ? <Badge tone="neutral" className="margin-pill">{fmtPct(pct)}</Badge> : '—'}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="table-wrap">
      <h3>דוח רווח והפסד</h3>

      <div className="income-kpi-strip">
        <KpiCard title="צמיחת הכנסות (CAGR)" value={revenueCAGR != null ? `${revenueCAGR >= 0 ? '+' : ''}${(revenueCAGR * 100).toFixed(1)}%` : '—'} icon={TrendingUp} />
        <KpiCard title="שולי רווח גולמי (TTM)" value={fmtPct(grossMarginTTM)} icon={Percent} />
        <KpiCard title="שולי רווח תפעולי (TTM)" value={fmtPct(opMarginTTM)} icon={Percent} />
        <KpiCard title="שולי רווח נקי (TTM)" value={fmtPct(netMarginTTM)} icon={Percent} />
      </div>

      <div className="table-scroll">
        <table className="financial-table">
          <thead>
            <tr>
              <th>סעיף</th>
              {years.map(y => <th key={y}>{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {row('הכנסות', 'revenue')}
            {row('עלות מכר (COGS)', 'costOfRevenue')}
            <tr className="section-divider"><td colSpan={6}></td></tr>
            {row('רווח גולמי', 'grossProfit', fmt, { highlight: true })}
            {marginRow('שיעור רווח גולמי (רווח גולמי ÷ הכנסות)', 'grossProfit')}
            <tr className="section-divider"><td colSpan={6}></td></tr>
            {row('מכירה, הנהלה וכלליות (SG&A)', 'sellingAndMarketingExpenses')}
            {row('מחקר ופיתוח (R&D)', 'otherExpenses')}
            <tr className="section-divider"><td colSpan={6}></td></tr>
            {row('רווח תפעולי (EBIT)', 'operatingIncome', fmt, { highlight: true })}
            {marginRow('שיעור רווח תפעולי (רווח תפעולי ÷ הכנסות)', 'operatingIncome')}
            <tr className="section-divider"><td colSpan={6}></td></tr>
            {row('הוצאות מימון (ריבית)', 'interestExpense')}
            {row('מיסים', 'incomeTaxExpense')}
            <tr className="section-divider"><td colSpan={6}></td></tr>
            {row('רווח נקי', 'netIncome', fmt, { highlight: true })}
            {marginRow('שיעור רווח נקי (רווח נקי ÷ הכנסות)', 'netIncome')}
          </tbody>
        </table>
      </div>
      <p className="table-note">* כל הסכומים במיליונים ($M)</p>
    </div>
  );
}

function LedgerGroup({ title, items, data, totalLabel, totalKey }) {
  return (
    <div className="ledger-group">
      <div className="ledger-group-title">{title}</div>
      {items.map(([label, key]) => (
        <div className="ledger-row" key={label}>
          <span className="ledger-row-label">{label}</span>
          <span className="ledger-row-value">{fmt(data[key])}</span>
        </div>
      ))}
      <div className="ledger-subtotal">
        <span>{totalLabel}</span>
        <span>{fmt(data[totalKey])}</span>
      </div>
    </div>
  );
}

function BalanceTab({ data, years }) {
  const [yearIdx, setYearIdx] = useState(0);

  if (!data?.length) return <div className="no-data">אין נתונים</div>;

  const cols = data.slice(0, 5);
  const idx = Math.min(yearIdx, cols.length - 1);
  const d = cols[idx];
  const totalLiabAndEquity = (d.totalLiabilities ?? 0) + (d.totalStockholdersEquity ?? 0);

  return (
    <div className="table-wrap">
      <div className="table-wrap-head">
        <h3>דוח מאזן</h3>
        <SegmentedToggle
          options={years.map((y, i) => ({ key: String(i), label: y }))}
          value={String(idx)}
          onChange={(k) => setYearIdx(Number(k))}
        />
      </div>

      <div className="balance-ledger">
        <div className="ledger-col">
          <h4 className="ledger-col-title">נכסים</h4>
          <LedgerGroup
            title="נכסים שוטפים" data={d} totalLabel='סה"כ נכסים שוטפים' totalKey="totalCurrentAssets"
            items={[
              ['מזומנים ושווי מזומנים', 'cashAndCashEquivalents'],
              ['השקעות לטווח קצר', 'shortTermInvestments'],
              ['לקוחות נטו', 'netReceivables'],
              ['מלאי', 'inventory'],
              ['נכסים שוטפים אחרים', 'otherCurrentAssets'],
            ]}
          />
          <LedgerGroup
            title="נכסים לא שוטפים" data={d} totalLabel='סה"כ נכסים לא שוטפים' totalKey="totalNonCurrentAssets"
            items={[
              ['השקעות לזמן ארוך', 'longTermInvestments'],
              ['רכוש קבוע נטו (PP&E)', 'propertyPlantEquipmentNet'],
              ['מוניטין', 'goodwill'],
              ['נכסים בלתי מוחשיים', 'intangibleAssets'],
            ]}
          />
          <div className="ledger-grand-total">
            <span>סה"כ נכסים</span>
            <span>{fmt(d.totalAssets)}</span>
          </div>
        </div>

        <div className="ledger-col">
          <h4 className="ledger-col-title">התחייבויות והון עצמי</h4>
          <LedgerGroup
            title="התחייבויות שוטפות" data={d} totalLabel='סה"כ התחייבויות שוטפות' totalKey="totalCurrentLiabilities"
            items={[
              ['אשראי לזמן קצר וחלויות שוטפות', 'shortTermDebt'],
              ['ספקים וזכאים', 'accountPayables'],
              ['התחייבויות שוטפות אחרות', 'otherCurrentLiabilities'],
            ]}
          />
          <LedgerGroup
            title="התחייבויות לא שוטפות" data={d} totalLabel='סה"כ התחייבויות' totalKey="totalLiabilities"
            items={[
              ['הלוואה לזמן ארוך ואג"ח', 'longTermDebt'],
              ['התחייבויות אחרות', 'otherNonCurrentLiabilities'],
            ]}
          />
          <LedgerGroup
            title="הון עצמי" data={d} totalLabel='סה"כ הון עצמי' totalKey="totalStockholdersEquity"
            items={[
              ['הון מניות ופרמיה', 'commonStock'],
              ['עודפים (רווחים שנצברו)', 'retainedEarnings'],
            ]}
          />
          <div className="ledger-grand-total">
            <span>סה"כ התחייבויות + הון עצמי</span>
            <span>{fmt(totalLiabAndEquity)}</span>
          </div>
        </div>
      </div>

      <p className="table-note">* כל הסכומים במיליונים ($M). נכסים = התחייבויות + הון עצמי</p>
    </div>
  );
}

const CASHFLOW_ROWS = [
  { label: 'רווח נקי', key: 'netIncome', col: 'op' },
  { label: 'פחת והפחתות', key: 'depreciationAndAmortization', col: 'op' },
  { label: 'שינוי בהון חוזר', key: 'changeInWorkingCapital', col: 'op' },
  { label: 'רכישת רכוש קבוע (CapEx)', key: 'capitalExpenditure', col: 'inv' },
  { label: 'רכישות והשקעות', key: 'acquisitionsNet', col: 'inv' },
  { label: 'שינוי בחוב', key: 'debtRepayment', col: 'fin' },
  { label: 'הנפקת/רכישת מניות', key: 'commonStockRepurchased', col: 'fin' },
  { label: 'דיבידנד ששולם', key: 'dividendsPaid', col: 'fin' },
];

function CashFlowTab({ data, years }) {
  const [yearIdx, setYearIdx] = useState(0);

  if (!data?.length) return <div className="no-data">אין נתונים</div>;

  const cols = data.slice(0, 5);
  const idx = Math.min(yearIdx, cols.length - 1);
  const d = cols[idx];

  const cell = (row, colType) => {
    if (row.col !== colType) return <td className="cashflow-empty">—</td>;
    const v = d[row.key];
    return <td className={`number ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>{fmt(v)}</td>;
  };

  const totalCls = (v) => `number ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`;

  return (
    <div className="table-wrap">
      <div className="table-wrap-head">
        <h3>דוח תזרים מזומנים</h3>
        <SegmentedToggle
          options={years.map((y, i) => ({ key: String(i), label: y }))}
          value={String(idx)}
          onChange={(k) => setYearIdx(Number(k))}
        />
      </div>

      <div className="table-scroll">
        <table className="financial-table cashflow-matrix">
          <thead>
            <tr>
              <th>סעיף</th>
              <th>פעילות שוטפת</th>
              <th>פעילות השקעה</th>
              <th>פעילות מימון</th>
            </tr>
          </thead>
          <tbody>
            {CASHFLOW_ROWS.map((row) => (
              <tr key={row.label}>
                <td className="row-label">{row.label}</td>
                {cell(row, 'op')}
                {cell(row, 'inv')}
                {cell(row, 'fin')}
              </tr>
            ))}
            <tr className="total-row">
              <td className="row-label">סה"כ נטו לכל פעילות</td>
              <td className={totalCls(d.netCashProvidedByOperatingActivities)}>{fmt(d.netCashProvidedByOperatingActivities)}</td>
              <td className={totalCls(d.netCashUsedForInvestingActivites)}>{fmt(d.netCashUsedForInvestingActivites)}</td>
              <td className={totalCls(d.netCashUsedProvidedByFinancingActivities)}>{fmt(d.netCashUsedProvidedByFinancingActivities)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="cashflow-summary">
        <div className="cashflow-summary-item">
          <span>שינוי נטו במזומנים</span>
          <strong className={d.netChangeInCash > 0 ? 'pos-val' : 'neg-val'}>{fmt(d.netChangeInCash)}</strong>
        </div>
        <div className="cashflow-summary-item">
          <span>תזרים חופשי (FCF)</span>
          <strong className={d.freeCashFlow > 0 ? 'pos-val' : 'neg-val'}>{fmt(d.freeCashFlow)}</strong>
        </div>
      </div>

      <p className="table-note">* כל הסכומים במיליונים ($M). ירוק = תזרים חיובי, אדום = יציאת מזומנים</p>
    </div>
  );
}

function RatioCard({ title, items }) {
  return (
    <div className="ratio-card">
      <h4>{title}</h4>
      <table className="ratio-table">
        <thead><tr><th>יחס</th><th>ערך</th><th>נוסחה</th></tr></thead>
        <tbody>
          {items.map(item => (
            <tr key={item.name}>
              <td><strong>{item.name}</strong></td>
              <td className="ratio-value">{item.value}</td>
              <td className="ratio-formula">{item.formula}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatiosTab({ ratios }) {
  if (!ratios) return <div className="no-data">אין נתונים</div>;

  const r = ratios;

  return (
    <div className="ratios-container">
      <h3>יחסים פיננסיים</h3>

      <RatioCard title="נזילות" items={[
        { name: 'יחס שוטף', value: fmtRaw(r.currentRatioTTM), formula: 'נכסים שוטפים ÷ התחייבויות שוטפות' },
        { name: 'יחס מהיר', value: fmtRaw(r.quickRatioTTM), formula: '(נכסים שוטפים − מלאי) ÷ התחייבויות שוטפות' },
      ]} />

      <RatioCard title="רווחיות" items={[
        { name: 'שולי רווח גולמי', value: fmtPct(r.grossProfitMarginTTM), formula: 'רווח גולמי ÷ הכנסות' },
        { name: 'שולי רווח תפעולי', value: fmtPct(r.operatingProfitMarginTTM), formula: 'רווח תפעולי ÷ הכנסות' },
        { name: 'שולי רווח נקי', value: fmtPct(r.netProfitMarginTTM), formula: 'רווח נקי ÷ הכנסות' },
      ]} />

      <RatioCard title="יעילות" items={[
        { name: 'ימי לקוחות (DSO)', value: r.daysOfSalesOutstandingTTM != null ? `${r.daysOfSalesOutstandingTTM} ימים` : '—', formula: '(לקוחות ÷ הכנסות) × 365' },
        { name: 'ימי ספקים (DPO)', value: r.daysPayablesOutstandingTTM != null ? `${r.daysPayablesOutstandingTTM} ימים` : '—', formula: '(ספקים ÷ עלות מכר) × 365' },
        { name: 'ימי מלאי (DIO)', value: r.daysOfInventoryOutstandingTTM != null ? `${r.daysOfInventoryOutstandingTTM} ימים` : '—', formula: '(מלאי ÷ עלות מכר) × 365' },
        { name: 'מחזור המרה למזומן (CCC)', value: r.cashConversionCycleTTM != null ? `${r.cashConversionCycleTTM} ימים` : '—', formula: 'DSO + DIO − DPO' },
      ]} />

      <RatioCard title="תשואה" items={[
        { name: 'תשואה על ההון (ROE)', value: fmtPct(r.returnOnEquityTTM), formula: 'רווח נקי ÷ הון עצמי ממוצע' },
        { name: 'תשואה על הנכסים (ROA)', value: fmtPct(r.returnOnAssetsTTM), formula: 'רווח נקי ÷ סך נכסים ממוצע' },
      ]} />

      <RatioCard title="מבנה הון" items={[
        { name: 'חוב לטווח ארוך להון', value: fmtRaw(r.longTermDebtToCapitalizationTTM), formula: 'חוב ארוך טווח ÷ (חוב + הון עצמי)' },
        { name: 'חוב נטו (Net Debt)', value: (() => { const v = r.netDebt; if (v == null) return '—'; const abs = Math.abs(v); const sign = v < 0 ? '-' : ''; if (abs >= 1e12) return `${sign}$${(abs/1e12).toFixed(2)}T`; if (abs >= 1e9) return `${sign}$${(abs/1e9).toFixed(1)}B`; return `${sign}$${(abs/1e6).toFixed(0)}M`; })(), formula: 'חוב קצר + חוב ארוך − מזומנים' },
      ]} />
    </div>
  );
}
