// Renderizador ligero de markdown para las notas de la Biblioteca, con wikilinks navegables.
import { TINTA, TINTA_2, HERMES, BORDE, LIENZO, RADIUS, FONT_MONO } from '../../lib/tema';
import { urlEnlazable } from '../../lib/formato';

// Renderizador de markdown LIGERO (sin dependencias) suficiente para notas:
// encabezados, negrita/cursiva, código, listas, enlaces, y [[wikilinks]]
// navegables. No pretende ser CommonMark completo.

function renderInline(text, key, onWiki) {
  // Trocea por tokens: [[wiki]], [txt](url), **b**, *i*, `code`
  const parts = [];
  const re = /(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[[')) {
      const name = tok.slice(2, -2).trim();
      parts.push(
        <span
          key={`${key}-w${i}`}
          onClick={() => onWiki && onWiki(name)}
          style={{ color: TINTA, cursor: 'pointer', borderBottom: `1px dotted ${HERMES}` }}
        >
          {name}
        </span>,
      );
    } else if (tok.startsWith('[')) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      // Las notas vienen de Drive y de Hermes: un enlace con otro esquema queda como texto.
      const url = urlEnlazable(mm[2]);
      parts.push(
        url ? (
          <a key={`${key}-l${i}`} href={url} target="_blank" rel="noreferrer" style={{ color: TINTA }}>
            {mm[1]}
          </a>
        ) : (
          mm[1]
        ),
      );
    } else if (tok.startsWith('**')) {
      parts.push(
        <strong key={`${key}-b${i}`} style={{ color: TINTA }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('`')) {
      parts.push(
        <code
          key={`${key}-c${i}`}
          style={{
            background: LIENZO,
            padding: '1px 5px',
            borderRadius: RADIUS / 2,
            fontFamily: FONT_MONO,
            fontSize: 12.5,
            color: TINTA_2,
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={`${key}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text, onWiki }) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let list = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={`p${out.length}`} style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.65, color: TINTA }}>
          {renderInline(para.join(' '), `p${out.length}`, onWiki)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul
          key={`u${out.length}`}
          style={{ margin: '0 0 10px', paddingLeft: 20, color: TINTA, fontSize: 13.5, lineHeight: 1.6 }}
        >
          {list.map((li, k) => (
            <li key={k}>{renderInline(li, `u${out.length}-${k}`, onWiki)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) {
        out.push(
          <pre
            key={`pre${out.length}`}
            style={{
              margin: '0 0 10px',
              padding: '10px 12px',
              background: LIENZO,
              border: `1px solid ${BORDE}`,
              borderRadius: RADIUS,
              overflow: 'auto',
              fontFamily: FONT_MONO,
              fontSize: 12.5,
              color: TINTA_2,
              whiteSpace: 'pre-wrap',
            }}
          >
            {codeBuf.join('\n')}
          </pre>,
        );
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const lvl = h[1].length;
      out.push(
        <div
          key={`h${out.length}`}
          style={{ fontSize: lvl <= 1 ? 19 : lvl === 2 ? 16 : 14, fontWeight: 700, color: TINTA, margin: '14px 0 8px' }}
        >
          {renderInline(h[2], `h${out.length}`, onWiki)}
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      flushPara();
      list.push(raw.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    if (raw.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    para.push(raw.trim());
  }
  flushPara();
  flushList();
  return <div>{out}</div>;
}
