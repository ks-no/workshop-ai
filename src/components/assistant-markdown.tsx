'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAssistantLocale } from './assistant-i18n';

export function safeMarkdownUrl(value: string) {
  if (/^https?:\/\//i.test(value)) { try { const url = new URL(value); return url.username || url.password ? '' : url.href; } catch { return ''; } }
  if (/^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value)) return value;
  if (/^#[a-zA-Z0-9_-]+$/.test(value)) return value;
  return '';
}

/** Model text is untrusted: no HTML, images, embedded content or executable URLs. */
export function AssistantMarkdown({ text, language, tableLabel }: { text: string; language?: string; tableLabel?: string }) {
  const { locale } = useAssistantLocale();
  return <div className="assistant-markdown" lang={language}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl}
      allowedElements={['p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td']}
      components={{
        a: ({ href, children }) => href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
        h1: ({ children }) => <h3>{children}</h3>, h2: ({ children }) => <h3>{children}</h3>,
        h4: ({ children }) => <h4>{children}</h4>, h5: ({ children }) => <h4>{children}</h4>, h6: ({ children }) => <h4>{children}</h4>,
        table: ({ children }) => <div className="assistant-markdown-table" role="region" aria-label={tableLabel ?? (locale === 'en' ? 'Table' : 'Tabell')} tabIndex={0}><table className="pkt-table">{children}</table></div>,
      }}>{text}</Markdown>
  </div>;
}
