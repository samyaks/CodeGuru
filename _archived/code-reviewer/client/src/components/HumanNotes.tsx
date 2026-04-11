import React, { useState } from 'react';
import { Save, MessageSquare } from 'lucide-react';

interface Props {
  initial: string;
  onSave: (text: string) => Promise<void>;
  label?: string;
  placeholder?: string;
}

export default function HumanNotes({ initial, onSave, label = 'Human Review Notes', placeholder = 'Add your review notes...' }: Props) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="human-notes">
      <div className="human-notes-header">
        <MessageSquare size={16} />
        <span>{label}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={4}
      />
      <div className="human-notes-actions">
        <button onClick={handleSave} disabled={saving} className="btn btn-secondary btn-sm">
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}
