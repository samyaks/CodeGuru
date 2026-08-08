import type { ReadClaim } from '../../services/readApi';
import { isUncertain } from './ClaimPhrase';

function basename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/** One margin note per claim: number, lead, evidence note(s), file chips. */
export default function Marginalia({ claims }: { claims: ReadClaim[] }) {
  return (
    <div className="col-notes">
      {claims.map((claim, i) => {
        const uncertain = isUncertain(claim);
        const settledByYou = claim.status === 'settled' && claim.source === 'human';
        const noteText = claim.evidence
          .map((e) => e.note)
          .filter((n): n is string => !!n)
          .join(' ');
        const files = [...new Set(
          claim.evidence
            .map((e) => e.filePath)
            .filter((f): f is string => !!f),
        )];

        return (
          <div className={uncertain ? 'note transient' : 'note'} key={claim.id}>
            <span className="num">{i + 1}.</span>
            <span>
              {settledByYou ? <><em>Settled by you.</em>{' '}</> : null}
              {!settledByYou && uncertain ? <><em>We're guessing.</em>{' '}</> : null}
              {noteText}
              {files.length > 0 ? (
                <>
                  {noteText ? ' ' : null}
                  {files.map((f) => (
                    <span key={f}>
                      <span className="src">{basename(f)}</span>{' '}
                    </span>
                  ))}
                </>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
