/**
 * The playground's code editor, built on the editor packages in the docs
 * dependencies: TypeScript highlighting, line numbers and search,
 * coloured from the docs palette so it follows the light and dark schemes.
 */
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Token colours; the values are CSS variables set on the playground. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--pg-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--pg-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--pg-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--pg-call)' },
  { tag: [t.typeName, t.className], color: 'var(--pg-type)' },
  { tag: t.comment, color: 'var(--vp-c-text-3)', fontStyle: 'italic' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vp-c-text-1)',
    backgroundColor: 'var(--vp-code-block-bg)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--vp-font-family-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--vp-c-text-1)' },
  '.cm-cursor': { borderLeftColor: 'var(--vp-c-text-1)' },
  '.cm-gutters': { border: 'none', backgroundColor: 'transparent', color: 'var(--vp-c-text-3)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 14px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--vp-c-default-soft)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--pg-selection) !important',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--pg-selection)', outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--vp-c-bg-soft)', color: 'var(--vp-c-text-1)' },
  '.cm-tooltip': { border: '1px solid var(--vp-c-divider)', backgroundColor: 'var(--vp-c-bg-elv)' },
});

export interface Editor {
  /** Replace the whole text, as one step undo reverses. */
  setCode(code: string): void;
  destroy(): void;
}

/**
 * Mounts the editor in `parent`. `onChange` gets the text after each edit;
 * Ctrl+Enter or Cmd+Enter calls `onRun`. Tab indents; Escape then Tab leaves.
 */
export function createEditor(parent: HTMLElement, code: string, onChange: (code: string) => void, onRun: () => void): Editor {
  const view = new EditorView({
    parent,
    doc: code,
    extensions: [
      keymap.of([{ key: 'Mod-Enter', run: () => (onRun(), true) }, indentWithTab]),
      basicSetup,
      javascript({ typescript: true }),
      syntaxHighlighting(highlight),
      theme,
      EditorView.contentAttributes.of({ 'aria-label': 'Chart code, TypeScript', 'aria-describedby': 'playground-keys' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  return {
    setCode(next) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    },
    destroy: () => view.destroy(),
  };
}
