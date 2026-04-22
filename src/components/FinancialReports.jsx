import { useState, useEffect } from 'react';
import { getIncomeStatement, getBalanceSheet, getCashFlow, getRatios, fmt, fmtPct, fmtRaw } from '../utils/api';

const TABS = ['דוח רווח והפסד', 'דוח מאזן', 'תזרים מזומנים', 'יחסים פיננסיים'];

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

  const row = (label, key, formatter = fmt) => (
    <tr key={label}>
      <td className="row-label">{label}</td>
      {data.slice(0, 5).map((d, i) => (
        <td key={i} className="number">{formatter(d[key])}</td>
      ))}
    </tr>
  );

  const marginRow = (label, numeratorKey) => (
    <tr key={label} className="margin-row">
      <td className="row-label">{label}</td>
      {data.slice(0, 5).map((d, i) => {
        const pct = d.revenue && d[numeratorKey] != null ? d[numeratorKey] / d.revenue : null;
        return <td key={i} className="center">{fmtPct(pct)}</td>;
      })}
    </tr>
  );

  return (
    <div className="table-wrap">
      <h3>דוח רווח והפסד</h3>
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
          {row('רווח גולמי', 'grossProfit')}
          {marginRow('שיעור רווח גולמי (רווח גולמי ÷ הכנסות)', 'grossProfit')}
          <tr className="section-divider"><td colSpan={6}></td></tr>
          {row('מכירה, הנהלה וכלליות (SG&A)', 'sellingAndMarketingExpenses')}
          {row('מחקר ופיתוח (R&D)', 'otherExpenses')}
          <tr className="section-divider"><td colSpan={6}></td></tr>
          {row('רווח תפעולי (EBIT)', 'operatingIncome')}
          {marginRow('שיעור רווח תפעולי (רווח תפעולי ÷ הכנסות)', 'operatingIncome')}
          <tr className="section-divider"><td colSpan={6}></td></tr>
          {row('הוצאות מימון (ריבית)', 'interestExpense')}
          {row('מיסים', 'incomeTaxExpense')}
          <tr className="section-divider"><td colSpan={6}></td></tr>
          {row('רווח נקי', 'netIncome')}
          {marginRow('שיעור רווח נקי (רווח נקי ÷ הכנסות)', 'netIncome')}
        </tbody>
      </table>
      <p className="table-note">* כל הסכומים במיליונים ($M)</p>
    </div>
  );
}

function BalanceTab({ data, years }) {
  if (!data?.length) return <div className="no-data">אין נתונים</div>;

  const cols = data.slice(0, 5);

  const fmtCell = (v) => <td className="number">{fmt(v)}</td>;

  const row = (label, key, sub) => (
    <tr key={label} className={sub ? 'sub-row' : ''}>
      <td className="row-label">{label}</td>
      {cols.map((d, i) => <td key={i} className="number">{fmt(d[key])}</td>)}
    </tr>
  );

  const totalRow = (label, key) => (
    <tr key={label} className="total-row">
      <td className="row-label">{label}</td>
      {cols.map((d, i) => <td key={i} className="number">{fmt(d[key])}</td>)}
    </tr>
  );

  const section = (title) => (
    <tr className="section-header">
      <td colSpan={cols.length + 1}>{title}</td>
    </tr>
  );

  return (
    <div className="table-wrap">
      <h3>דוח מאזן</h3>

      {/* Balance summary — assets vs liabilities+equity */}
      <div className="balance-summary-grid">
        <div className="balance-side assets-side">
          <div className="balance-side-title">נכסים (Assets)</div>
          {cols.map((d, i) => (
            <div key={i} className="balance-year-row">
              <span className="balance-year">{years[i]}</span>
              <div className="balance-breakdown">
                <span>שוטפים: <strong>{fmt(d.totalCurrentAssets)}</strong></span>
                <span>+ לא שוטפים: <strong>{fmt(d.totalNonCurrentAssets)}</strong></span>
                <span className="balance-total">= סה"כ נכסים: <strong>{fmt(d.totalAssets)}</strong></span>
              </div>
            </div>
          ))}
        </div>
        <div className="balance-equals">=</div>
        <div className="balance-side liab-side">
          <div className="balance-side-title">התחייבויות + הון עצמי</div>
          {cols.map((d, i) => (
            <div key={i} className="balance-year-row">
              <span className="balance-year">{years[i]}</span>
              <div className="balance-breakdown">
                <span>התחייבויות: <strong>{fmt(d.totalLiabilities)}</strong></span>
                <span>+ הון עצמי: <strong>{fmt(d.totalStockholdersEquity)}</strong></span>
                <span className="balance-total">= סה"כ: <strong>{fmt((d.totalLiabilities ?? 0) + (d.totalStockholdersEquity ?? 0))}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed table */}
      <table className="financial-table" style={{ marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <th>סעיף</th>
            {years.map(y => <th key={y}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {section('נכסים שוטפים')}
          {row('מזומנים ושווי מזומנים', 'cashAndCashEquivalents', true)}
          {row('השקעות לטווח קצר', 'shortTermInvestments', true)}
          {row('לקוחות נטו', 'netReceivables', true)}
          {row('מלאי', 'inventory', true)}
          {row('נכסים שוטפים אחרים', 'otherCurrentAssets', true)}
          {totalRow('סה"כ נכסים שוטפים', 'totalCurrentAssets')}

          {section('נכסים לא שוטפים')}
          {row('השקעות לזמן ארוך', 'longTermInvestments', true)}
          {row('רכוש קבוע נטו (PP&E)', 'propertyPlantEquipmentNet', true)}
          {row('מוניטין', 'goodwill', true)}
          {row('נכסים בלתי מוחשיים', 'intangibleAssets', true)}
          {totalRow('סה"כ נכסים לא שוטפים', 'totalNonCurrentAssets')}
          {totalRow('▶ סה"כ נכסים', 'totalAssets')}

          {section('התחייבויות שוטפות')}
          {row('אשראי לזמן קצר וחלויות שוטפות', 'shortTermDebt', true)}
          {row('ספקים וזכאים', 'accountPayables', true)}
          {row('התחייבויות שוטפות אחרות', 'otherCurrentLiabilities', true)}
          {totalRow('סה"כ התחייבויות שוטפות', 'totalCurrentLiabilities')}

          {section('התחייבויות לא שוטפות')}
          {row('הלוואה לזמן ארוך ואג"ח', 'longTermDebt', true)}
          {row('התחייבויות אחרות', 'otherNonCurrentLiabilities', true)}
          {totalRow('סה"כ התחייבויות', 'totalLiabilities')}

          {section('הון עצמי')}
          {row('הון מניות ופרמיה', 'commonStock', true)}
          {row('עודפים (רווחים שנצברו)', 'retainedEarnings', true)}
          {totalRow('סה"כ הון עצמי', 'totalStockholdersEquity')}

          <tr className="total-row" style={{ borderTop: '3px solid var(--accent)' }}>
            <td className="row-label">▶ סה"כ התחייבויות + הון עצמי</td>
            {cols.map((d, i) => (
              <td key={i} className="number">
                {fmt((d.totalLiabilities ?? 0) + (d.totalStockholdersEquity ?? 0))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="table-note">* כל הסכומים במיליונים ($M)</p>
    </div>
  );
}

function CashFlowTab({ data, years }) {
  if (!data?.length) return <div className="no-data">אין נתונים</div>;

  const row = (label, key, sub) => (
    <tr key={label} className={sub ? 'sub-row' : ''}>
      <td className="row-label">{label}</td>
      {data.slice(0, 5).map((d, i) => <td key={i} className={`number ${d[key] > 0 ? 'pos' : d[key] < 0 ? 'neg' : ''}`}>{fmt(d[key])}</td>)}
    </tr>
  );

  const section = (title, desc) => (
    <tr className="section-header">
      <td colSpan={6}>
        <div>{title}</div>
        <div className="section-desc">{desc}</div>
      </td>
    </tr>
  );

  return (
    <div className="table-wrap">
      <h3>דוח תזרים מזומנים</h3>
      <table className="financial-table">
        <thead>
          <tr>
            <th>סעיף</th>
            {years.map(y => <th key={y}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {section('תזרים שוטף (Operations)', 'דוג׳: רווח נקי, פחת והפחתות, שינוי ספקים, שינוי לקוחות, שינוי מלאי')}
          {row('רווח/הפסד נקי', 'netIncome', true)}
          {row('פחת והפחתות', 'depreciationAndAmortization', true)}
          {row('שינוי בהון חוזר', 'changeInWorkingCapital', true)}
          {row('תזרים שוטף נטו', 'netCashProvidedByOperatingActivities')}

          {section('תזרים השקעה (Investing)', 'דוג׳: רכישת מכונות, רכישת רכוש קבוע, רכישת חברות, מכירת השקעות')}
          {row('רכישת רכוש קבוע (CapEx)', 'capitalExpenditure', true)}
          {row('רכישות והשקעות', 'acquisitionsNet', true)}
          {row('תזרים השקעה נטו', 'netCashUsedForInvestingActivites')}

          {section('תזרים מימון (Financing)', 'דוג׳: לקיחת הלוואה מבנק, תשלום ריבית, הנפקת מניות, רכישה חוזרת של מניות, חלוקת דיבידנד')}
          {row('שינוי בחוב', 'debtRepayment', true)}
          {row('הנפקת/רכישת מניות', 'commonStockRepurchased', true)}
          {row('דיבידנד', 'dividendsPaid', true)}
          {row('תזרים מימון נטו', 'netCashUsedProvidedByFinancingActivities')}

          <tr className="total-row">
            <td>שינוי נטו במזומנים</td>
            {data.slice(0, 5).map((d, i) => (
              <td key={i} className={`number ${d.netChangeInCash > 0 ? 'pos' : 'neg'}`}>
                {fmt(d.netChangeInCash)}
              </td>
            ))}
          </tr>
          <tr>
            <td>תזרים חופשי (FCF)</td>
            {data.slice(0, 5).map((d, i) => (
              <td key={i} className={`number ${d.freeCashFlow > 0 ? 'pos' : 'neg'}`}>
                {fmt(d.freeCashFlow)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="table-note">* כל הסכומים במיליונים ($M). ירוק = תזרים חיובי, אדום = יציאת מזומנים</p>
    </div>
  );
}

function RatiosTab({ ratios }) {
  if (!ratios) return <div className="no-data">אין נתונים</div>;

  const r = ratios;

  const RatioCard = ({ title, items }) => (
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
        { name: 'ימי לקוחות (DSO)', value: fmtRaw(r.daysOfSalesOutstandingTTM) + ' ימים', formula: '(לקוחות ÷ הכנסות) × 365' },
        { name: 'ימי ספקים (DPO)', value: fmtRaw(r.daysPayablesOutstandingTTM) + ' ימים', formula: '(ספקים ÷ עלות מכר) × 365' },
        { name: 'ימי מלאי (DIO)', value: fmtRaw(r.daysOfInventoryOutstandingTTM) + ' ימים', formula: '(מלאי ÷ עלות מכר) × 365' },
        { name: 'מחזור המרה למזומן (CCC)', value: fmtRaw(r.cashConversionCycleTTM) + ' ימים', formula: 'DSO + DIO − DPO' },
      ]} />

      <RatioCard title="תשואה" items={[
        { name: 'תשואה על ההון (ROE)', value: fmtPct(r.returnOnEquityTTM), formula: 'רווח נקי ÷ הון עצמי ממוצע' },
        { name: 'תשואה על הנכסים (ROA)', value: fmtPct(r.returnOnAssetsTTM), formula: 'רווח נקי ÷ סך נכסים ממוצע' },
      ]} />

      <RatioCard title="מבנה הון" items={[
        { name: 'חוב לטווח ארוך להון', value: fmtRaw(r.longTermDebtToCapitalizationTTM), formula: 'חוב ארוך טווח ÷ (חוב + הון עצמי)' },
        { name: 'חוב נטו (Net Debt)', value: '(ראה מאזן)', formula: 'חוב כולל − מזומנים ושווי מזומנים' },
      ]} />
    </div>
  );
}
