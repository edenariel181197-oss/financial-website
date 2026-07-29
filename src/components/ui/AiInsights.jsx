import { Sparkles } from 'lucide-react';

const GOOD = new Set(['cheap', 'strong', 'high']);
const BAD = new Set(['expensive', 'weak', 'declining', 'low', 'unprofitable']);
const toneOf = (v) => (GOOD.has(v) ? 'good' : BAD.has(v) ? 'bad' : 'neutral');

const VERDICT_LABEL = {
  cheap: 'זולה', fair: 'הוגנת', expensive: 'יקרה',
  strong: 'חזקה', moderate: 'בינונית', weak: 'חלשה', declining: 'יורדת',
  high: 'גבוהה', low: 'נמוכה', unprofitable: 'לא רווחית',
  unknown: '—',
};

export default function AiInsights({ thesis }) {
  if (!thesis) return null;

  const items = [
    { label: 'שווי', verdict: thesis.valuation.verdict },
    { label: 'צמיחה', verdict: thesis.growth.verdict },
    { label: 'רווחיות', verdict: thesis.profitability.verdict },
    { label: 'מאזן', verdict: thesis.health.verdict },
  ];
  const tones = items.map((i) => toneOf(i.verdict));
  const good = tones.filter((t) => t === 'good').length;
  const bad = tones.filter((t) => t === 'bad').length;
  const neutral = tones.length - good - bad;
  const score = Math.round((good * 100 + neutral * 55) / tones.length);
  const scoreTone = score >= 70 ? 'good' : score >= 45 ? 'neutral' : 'bad';

  return (
    <div className="ai-insights">
      <div className="ai-insights-head">
        <div className="ai-insights-title">
          <Sparkles size={17} strokeWidth={2} />
          <span>תובנות AI</span>
        </div>
        <div className={`ai-score ai-score-${scoreTone}`}>
          <span className="ai-score-value">{score}</span>
          <span className="ai-score-label">ציון השקעה</span>
        </div>
      </div>

      <div className="ai-insights-grid">
        {items.map((i) => (
          <div key={i.label} className={`ai-insight-item tone-${toneOf(i.verdict)}`}>
            <span className="ai-insight-label">{i.label}</span>
            <span className="ai-insight-verdict">{VERDICT_LABEL[i.verdict] || '—'}</span>
          </div>
        ))}
      </div>

      <p className="ai-insights-summary">{thesis.summary}</p>
    </div>
  );
}
