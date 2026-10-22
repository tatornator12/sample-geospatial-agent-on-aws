/**
 * One site of the archaeologist's condition survey, under the step that judged it: the relief the
 * agent looked at (a thumbnail that opens it), the site's name and distance, and the verdict with
 * its reason. Every word is the stage's own (utils/survey.ts); the file behind it holds enums only.
 */
import type { EvidenceItem } from '../utils/evidence.ts';
import { surveyRowText, type SurveyRecord } from '../utils/survey.ts';
import { EvidenceChip } from './EvidenceChip.tsx';

interface SurveyRowProps {
  record: SurveyRecord;
  /** The relief the agent inspected before this verdict, re-titled in the stage's words. */
  evidence: EvidenceItem | null;
  onOpenEvidence?: (item: EvidenceItem, imageUrl: string) => void;
}

export function SurveyRow({ record, evidence, onOpenEvidence }: SurveyRowProps) {
  const text = surveyRowText(record);
  return (
    <div className={`survey-row survey-row--${record.verdict}`}>
      <span className="survey-row__thumb">
        {evidence && onOpenEvidence ? <EvidenceChip item={evidence} onOpen={onOpenEvidence} compact /> : null}
      </span>
      <span className="survey-row__text">
        <span className="survey-row__site">
          {text.site} <span className="survey-row__km">{text.km}</span>
        </span>
        <span className="survey-row__verdict">
          <span className="survey-row__word">{text.verdict}:</span> {text.because}
        </span>
      </span>
    </div>
  );
}
