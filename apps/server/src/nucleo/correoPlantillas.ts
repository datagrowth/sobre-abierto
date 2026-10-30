// Plantillas de los avisos por email, montadas por código, sin LLM, con el aspecto de la marca de la instalación.

// Cabecera en el color del texto con el nombre en el de la acción, cuerpo blanco y botón en píldora del color de
// la acción. Todo lo que llega de fuera se escapa. Cada email va también en texto plano. Ningún aviso lleva
// precios, costes ni datos de CV: quien monta el contenido no los pone y aquí se recuerda al pie.
// Los del tema neutro de la web (tema.js); la marca de la instalación los cambia con los mismos nombres.
const NEUTROS = {
  tinta: '#1F2937',
  'tinta-2': '#4B5563',
  accion: '#A7F3D0',
  borde: '#E5E7EB',
  'superficie-2': '#F3F4F6',
};
type Colores = typeof NEUTROS;
export type MarcaCorreo = { nombre: string; tema: Partial<Record<string, string>> };
const MARCA_NEUTRA: MarcaCorreo = { nombre: 'Sobre Abierto', tema: {} };
const LETRA = "'DM Sans', Arial, Helvetica, sans-serif";

export type FilaCorreo = { texto: string; detalle?: string | null; enlace?: string | null };
export type BloqueCorreo = { titulo: string; filas: FilaCorreo[]; vacio?: string };
export type Plantilla = {
  asunto: string;
  titulo: string;
  intro: string;
  bloques: BloqueCorreo[];
  // enlace: una ruta de la web («#/licitacion/p-1»); sin URL pública de la web, el email va sin botón ni enlaces.
  boton?: { texto: string; enlace: string } | null;
};
export type Montado = { asunto: string; html: string; texto: string };

const PIE = 'Ningún aviso lleva precios, costes ni datos de CV. Cambia lo que te llega en Ajustes › Avisos.';

function escapar(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** La dirección completa de una ruta de la web («#/…»), o null sin URL pública. */
export const enlaceWeb = (urlWeb: string | null, ruta: string | null | undefined): string | null =>
  urlWeb && ruta ? `${urlWeb}/${ruta.replace(/^\/+/, '')}` : null;

function filaHtml(f: FilaCorreo, urlWeb: string | null, c: Colores): string {
  const url = enlaceWeb(urlWeb, f.enlace);
  const texto = url
    ? `<a href="${escapar(url)}" style="color:${c.tinta};font-weight:700;text-decoration:underline">${escapar(f.texto)}</a>`
    : `<b>${escapar(f.texto)}</b>`;
  const detalle = f.detalle
    ? `<div style="color:${c['tinta-2']};font-size:13px;margin-top:2px">${escapar(f.detalle)}</div>`
    : '';
  return `<tr><td style="padding:8px 0;border-top:1px solid ${c.borde};font-size:14px;color:${c.tinta}">${texto}${detalle}</td></tr>`;
}

function bloqueHtml(b: BloqueCorreo, urlWeb: string | null, c: Colores): string {
  const filas = b.filas.length
    ? b.filas.map((f) => filaHtml(f, urlWeb, c)).join('')
    : `<tr><td style="padding:8px 0;color:${c['tinta-2']};font-size:14px">${escapar(b.vacio ?? 'Nada esta vez.')}</td></tr>`;
  return `<h2 style="font-family:${LETRA};font-size:15px;color:${c.tinta};margin:24px 0 4px">${escapar(b.titulo)}</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:${LETRA}">${filas}</table>`;
}

function botonHtml(p: Plantilla, urlWeb: string | null, c: Colores): string {
  const url = p.boton ? enlaceWeb(urlWeb, p.boton.enlace) : null;
  if (!url) return '';
  return `<p style="margin:28px 0 8px"><a href="${escapar(url)}" style="display:inline-block;background:${c.accion};color:${c.tinta};font-family:${LETRA};font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px;text-decoration:none">${escapar(p.boton!.texto)}</a></p>`;
}

function html(p: Plantilla, urlWeb: string | null, marca: MarcaCorreo): string {
  const c: Colores = { ...NEUTROS, ...marca.tema };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapar(p.asunto)}</title></head>
<body style="margin:0;padding:0;background:${c['superficie-2']}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${c['superficie-2']}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${c.borde};border-radius:12px;overflow:hidden">
<tr><td style="background:${c.tinta};padding:18px 24px;font-family:${LETRA};font-size:20px;font-weight:700;color:${c.accion}">${escapar(marca.nombre)}</td></tr>
<tr><td style="padding:24px;font-family:${LETRA};color:${c.tinta}">
<h1 style="font-size:20px;margin:0 0 8px">${escapar(p.titulo)}</h1>
<p style="font-size:14px;line-height:1.5;margin:0;color:${c.tinta}">${escapar(p.intro)}</p>
${p.bloques.map((b) => bloqueHtml(b, urlWeb, c)).join('\n')}
${botonHtml(p, urlWeb, c)}
<p style="font-size:12px;color:${c['tinta-2']};margin:28px 0 0;border-top:1px solid ${c.borde};padding-top:12px">${escapar(PIE)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function texto(p: Plantilla, urlWeb: string | null): string {
  const bloques = p.bloques.map((b) =>
    [
      `== ${b.titulo} ==`,
      ...(b.filas.length
        ? b.filas.map((f) => {
            const url = enlaceWeb(urlWeb, f.enlace);
            return `- ${f.texto}${f.detalle ? ` — ${f.detalle}` : ''}${url ? `\n  ${url}` : ''}`;
          })
        : [b.vacio ?? 'Nada esta vez.']),
    ].join('\n'),
  );
  const boton =
    p.boton && enlaceWeb(urlWeb, p.boton.enlace) ? `${p.boton.texto}: ${enlaceWeb(urlWeb, p.boton.enlace)}` : null;
  return [p.titulo, '', p.intro, '', ...bloques.flatMap((b) => [b, '']), ...(boton ? [boton, ''] : []), '--', PIE].join(
    '\n',
  );
}

/** El email montado: asunto, HTML con la marca de la instalación (sin ella, la neutra) y texto plano. */
export function montarCorreo(p: Plantilla, urlWeb: string | null, marca: MarcaCorreo = MARCA_NEUTRA): Montado {
  return { asunto: p.asunto, html: html(p, urlWeb, marca), texto: texto(p, urlWeb) };
}
