import React from 'react';

// Minimal, dependency-free Markdown renderer for assistant messages.
// Returns real React nodes (no dangerouslySetInnerHTML → no XSS from LLM output).
// Supports: fenced code blocks, inline code, bold, italic, links, headings,
// unordered / ordered lists, blockquotes, horizontal rules, and paragraphs.

// Inline: `code`, **bold**, *italic* / _italic_, [text](url)
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))/;

function parseInline(text, kp = '') {
  const out = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok[0] === '`') {
      out.push(<code key={`${kp}c${k++}`}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${kp}b${k++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok[0] === '[') {
      const l = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      out.push(<a key={`${kp}a${k++}`} href={l[2]} target="_blank" rel="noreferrer">{l[1]}</a>);
    } else {
      out.push(<em key={`${kp}i${k++}`}>{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const isUL = (l) => /^\s*[-*+]\s+/.test(l);
const isOL = (l) => /^\s*\d+\.\s+/.test(l);
const isSpecial = (l) =>
  /^```/.test(l.trim()) || /^#{1,6}\s/.test(l) || isUL(l) || isOL(l) || /^\s*>\s?/.test(l) || /^\s*([-*_])\1{2,}\s*$/.test(l);

export default function Markdown({ text }) {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="md-pre">
          {lang && <span className="md-pre-lang">{lang}</span>}
          <code>{buf.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(h[1].length + 2, 6); // # → h3 (keeps it compact in the panel)
      const Tag = `h${lvl}`;
      blocks.push(<Tag key={key++} className="md-h">{parseInline(h[2], `h${key}`)}</Tag>);
      i++; continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={key++} className="md-hr" />); i++; continue; }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(<blockquote key={key++} className="md-quote">{parseInline(buf.join(' '), `q${key}`)}</blockquote>);
      continue;
    }

    // unordered list
    if (isUL(line)) {
      const items = [];
      while (i < lines.length && isUL(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items.map((it, j) => <li key={j}>{parseInline(it, `ul${key}-${j}`)}</li>)}
        </ul>
      );
      continue;
    }

    // ordered list
    if (isOL(line)) {
      const items = [];
      while (i < lines.length && isOL(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items.map((it, j) => <li key={j}>{parseInline(it, `ol${key}-${j}`)}</li>)}
        </ol>
      );
      continue;
    }

    // blank line
    if (line.trim() === '') { i++; continue; }

    // paragraph (consecutive plain lines joined with soft breaks)
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !isSpecial(lines[i])) { para.push(lines[i]); i++; }
    const content = [];
    para.forEach((p, j) => {
      if (j > 0) content.push(<br key={`br${key}-${j}`} />);
      content.push(...parseInline(p, `p${key}-${j}`));
    });
    blocks.push(<p key={key++} className="md-p">{content}</p>);
  }

  return <div className="md">{blocks}</div>;
}
