import { useState } from 'react';
import type { ReadAlternative } from '../../services/readApi';

interface EditorPopProps {
  alternative: ReadAlternative;
  saving: boolean;
  onSave: (optionId: string) => void;
}

/** The inline editor pop for an uncertain claim: question + radio options. */
export default function EditorPop({ alternative, saving, onSave }: EditorPopProps) {
  const [selected, setSelected] = useState<string>(alternative.options[0]?.id ?? '');

  return (
    <div className="editorpop">
      <p className="q">{alternative.question}</p>
      <div className="opts" role="radiogroup" aria-label={alternative.question}>
        {alternative.options.map((opt) => (
          <label
            key={opt.id}
            className={opt.id === selected ? 'opt sel' : 'opt'}
            onClick={() => setSelected(opt.id)}
          >
            <input
              type="radio"
              name="read-alt-option"
              value={opt.id}
              checked={opt.id === selected}
              onChange={() => setSelected(opt.id)}
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            />
            <span className="tick" aria-hidden />
            <span className="ot">
              <strong>{opt.label}</strong>
              <span>{opt.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="save"
        disabled={saving || !selected}
        onClick={() => selected && onSave(selected)}
      >
        {saving ? 'Saving the correction…' : 'Save the correction →'}
      </button>
    </div>
  );
}
