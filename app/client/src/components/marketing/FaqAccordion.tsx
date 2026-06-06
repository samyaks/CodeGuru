import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FaqItem } from './marketingContent';

interface FaqAccordionProps {
  items: FaqItem[];
  title?: string;
}

export default function FaqAccordion({
  items,
  title = 'Frequently asked questions',
}: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section>
      <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight mb-8 text-center v2-font-serif">
        {title}
      </h2>
      <div className="max-w-2xl mx-auto divide-y divide-stone-200 border border-stone-200 rounded-xl bg-white overflow-hidden">
        {items.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.question}>
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-stone-50 transition-colors"
              >
                <span className="text-sm font-medium text-stone-900">{item.question}</span>
                <ChevronDown
                  className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${
                    open ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {open && (
                <div className="px-5 pb-4 text-sm text-stone-600 leading-relaxed">
                  {item.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
