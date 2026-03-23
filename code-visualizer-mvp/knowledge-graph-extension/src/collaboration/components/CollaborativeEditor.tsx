/**
 * CollaborativeEditor Component
 * 
 * Tiptap-based rich text editor with real-time collaboration.
 * Features:
 * - CRDT-based synchronization via Y.js
 * - Collaborative cursors
 * - Undo/redo (Y.js aware)
 * - Rich text formatting
 */

import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { throttle, debounce } from '../utils/performance';

interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  provider: WebsocketProvider | null;
  awareness: any;
  fieldName?: string;
  placeholder?: string;
  editable?: boolean;
  onUpdate?: (content: string) => void;
  user: {
    name: string;
    color: string;
  };
  className?: string;
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  ydoc,
  provider,
  awareness,
  fieldName = 'default',
  placeholder = 'Start typing...',
  editable = true,
  onUpdate,
  user,
  className = '',
}) => {
  const [isTyping, setIsTyping] = useState(false);

  // Debounced typing indicator (reset after 300ms of no typing)
  const resetTypingIndicator = React.useMemo(
    () =>
      debounce(() => {
        setIsTyping(false);
        if (awareness) {
          awareness.setLocalStateField('isTyping', false);
        }
      }, 300),
    [awareness]
  );

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable built-in history (use Y.js history instead)
        history: false,
      }),
      Collaboration.configure({
        document: ydoc,
        field: fieldName,
      }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: user.name,
          color: user.color,
        },
      }),
    ],
    content: '',
    editable,
    editorProps: {
      attributes: {
        class: 'collaborative-editor-content',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      // Set typing indicator
      if (!isTyping) {
        setIsTyping(true);
        if (awareness) {
          awareness.setLocalStateField('isTyping', true);
        }
      }

      // Reset typing indicator after delay
      resetTypingIndicator();

      // Callback with content
      if (onUpdate) {
        onUpdate(editor.getHTML());
      }
    },
  });

  // Update editor editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // Track cursor position for awareness
  useEffect(() => {
    if (!editor || !awareness) return;

    const throttledCursorUpdate = throttle((event: MouseEvent) => {
      const selection = editor.state.selection;
      if (selection) {
        awareness.setLocalStateField('selection', {
          anchor: selection.anchor,
          head: selection.head,
        });
      }
    }, 16); // ~60fps

    // Listen to selection updates
    const handleSelectionUpdate = () => {
      const selection = editor.state.selection;
      if (selection && awareness) {
        awareness.setLocalStateField('selection', {
          anchor: selection.anchor,
          head: selection.head,
        });
        awareness.setLocalStateField('lastActive', Date.now());
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, awareness]);

  // Cleanup
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, []);

  return (
    <div className={`collaborative-editor ${className}`}>
      <style>{`
        .collaborative-editor {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .collaborative-editor-content {
          flex: 1;
          outline: none;
          padding: 16px;
          font-size: 14px;
          line-height: 1.6;
          color: #1f2937;
          min-height: 200px;
        }

        .collaborative-editor-content[data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
          position: absolute;
        }

        .collaborative-editor-content p {
          margin: 0 0 8px 0;
        }

        .collaborative-editor-content h1 {
          font-size: 24px;
          font-weight: 700;
          margin: 24px 0 12px 0;
        }

        .collaborative-editor-content h2 {
          font-size: 20px;
          font-weight: 600;
          margin: 20px 0 10px 0;
        }

        .collaborative-editor-content h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 16px 0 8px 0;
        }

        .collaborative-editor-content ul,
        .collaborative-editor-content ol {
          padding-left: 24px;
          margin: 8px 0;
        }

        .collaborative-editor-content li {
          margin: 4px 0;
        }

        .collaborative-editor-content code {
          background: #f3f4f6;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 13px;
        }

        .collaborative-editor-content pre {
          background: #1f2937;
          color: #f9fafb;
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          margin: 12px 0;
        }

        .collaborative-editor-content pre code {
          background: transparent;
          color: inherit;
          padding: 0;
        }

        .collaborative-editor-content blockquote {
          border-left: 3px solid #d1d5db;
          padding-left: 16px;
          margin: 12px 0;
          color: #6b7280;
        }

        .collaborative-editor-content strong {
          font-weight: 600;
        }

        .collaborative-editor-content em {
          font-style: italic;
        }

        /* Collaboration cursor styles */
        .collaboration-cursor__caret {
          border-left: 2px solid;
          border-color: var(--cursor-color, #000);
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }

        .collaboration-cursor__label {
          border-radius: 4px;
          color: white;
          font-size: 11px;
          font-weight: 600;
          left: -1px;
          line-height: normal;
          padding: 2px 6px;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
          background-color: var(--cursor-color, #000);
        }
      `}</style>

      <EditorContent editor={editor} />
    </div>
  );
};
