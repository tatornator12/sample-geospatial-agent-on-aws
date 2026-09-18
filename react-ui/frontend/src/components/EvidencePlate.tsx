/**
 * The enlarged evidence view: one image the agent looked at, floated over the stage so the
 * room can read it. Closes on Escape, the close control, or a click outside; focus returns to
 * whatever opened it.
 */
import { useEffect, useRef } from 'react';
import type { EvidenceItem } from '../utils/evidence.ts';
import { Icon } from './Icons.tsx';

interface EvidencePlateProps {
  item: EvidenceItem;
  imageUrl: string;
  onClose: () => void;
}

/** A YYYY-MM-DD in the raster name is the acquisition date; show it in the mono register. */
function dateOf(item: EvidenceItem): string | null {
  const match = item.sourceUrl.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function EvidencePlate({ item, imageUrl, onClose }: EvidencePlateProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  // Titles usually name the date already; only add the mono date when they do not.
  const rawDate = dateOf(item);
  const date = rawDate && !item.title.includes(rawDate) ? rawDate : null;

  return (
    <div className="evidence-plate__backdrop" onMouseDown={onClose}>
      <figure
        className="evidence-plate"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="evidence-plate__head">
          <figcaption className="evidence-plate__title">
            <span>{item.title}</span>
            {date && <span className="evidence-plate__date">{date}</span>}
          </figcaption>
          <button
            ref={closeRef}
            type="button"
            className="stage-btn stage-btn--icon stage-btn--quiet"
            onClick={onClose}
            aria-label="Close evidence"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <img className="evidence-plate__image" src={imageUrl} alt={item.title} />
        {item.question && <p className="evidence-plate__question">{item.question}</p>}
      </figure>
    </div>
  );
}
