import { useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  quickPrompts?: string[];
  title?: string;
  className?: string;
}

export function ChatDrawer({
  open,
  onClose,
  messages,
  onSend,
  quickPrompts = [],
  title = 'Ask Claude',
  className = '',
}: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages.length]);

  if (!open) return null;

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value) return;
    onSend(value);
    setInput('');
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-stone-900/40 backdrop-blur-sm v2-font-sans ${className}`.trim()}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-lg bg-white sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[600px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-stone-700" />
            <p className="font-semibold text-stone-900">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 text-sm"
          >
            Close
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-stone-900 text-white rounded-br-sm'
                    : 'bg-stone-100 text-stone-900 rounded-bl-sm'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {quickPrompts.length > 0 ? (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => submit(prompt)}
                className="text-xs px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-full transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        <div className="p-3 border-t border-stone-200 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="Ask anything..."
            className="flex-1 px-3 py-2 border border-stone-300 rounded-md text-sm focus:outline-none focus:border-stone-900"
          />
          <button
            type="button"
            onClick={() => submit()}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatDrawer;
