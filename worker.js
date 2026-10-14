/**
 * CronoLeitura — servidor Amazon (Cloudflare Worker)
 *
 * Lê a busca de livros e a página do produto da Amazon Brasil e devolve JSON para o app.
 *   GET /search?q=o+poder+do+habito  -> { results: [ {asin, isbn, title, author, year, format, cover, sponsored} ] }
 *   GET /item?asin=8539004119         -> { asin, isbn, title, author, publisher, edition, year, pages, language, cover, format }
 *   GET /item?url=https://a.co/d/xxxx -> idem (aceita links amazon.com.br, amazon.com, a.co, amzn.to)
 *
 * Só acessa domínios da Amazon (não é um proxy aberto). Respostas ficam em cache por algumas horas
 * para reduzir acessos. Variável opcional ORIGIN restringe quem pode usar (ex.: https://seuusuario.github.io).
 *
 * Aviso: ler páginas da Amazon automaticamente vai contra as Condições de Uso dela e a Amazon pode
 * bloquear (o app avisa e continua funcionando com as outras fontes). Uso pessoal, volume baixo.
 */

const AMAZON = 'https://www.amazon.com.br';
const ALLOWED_HOSTS = /^(?:www\.)?(?:amazon\.com\.br|amazon\.com|a\.co|amzn\.to|amzn\.com)$/i;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export default {
  async fetch(request, env, ctx) {
    const origin = (env && env.ORIGIN) || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'método não permitido' }, 405, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '') {
        return json({ ok: true, service: 'CronoLeitura Amazon', version: 1 }, 200, cors);
      }
      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 150);
        if (!q) return json({ error: 'informe q' }, 400, cors);
        return await cached(request, ctx, 6 * 3600, cors, async () => {
          const html = await getHtml(AMAZON + '/s?k=' + encodeURIComponent(q) + '&i=stripbooks&language=pt_BR', DESKTOP_UA);
          return { query: q, results: parseSearch(html) };
        });
      }
      if (url.pathname === '/item') {
        const asin = (url.searchParams.get('asin') || '').trim().toUpperCase();
        const link = (url.searchParams.get('url') || '').trim();
        let target;
        if (/^[A-Z0-9]{10}$/.test(asin)) target = AMAZON + '/dp/' + asin;
        else if (link) {
          let u;
          try { u = new URL(link); } catch (e) { return json({ error: 'link inválido' }, 400, cors); }
          if (!ALLOWED_HOSTS.test(u.hostname)) return json({ error: 'só aceito links da Amazon' }, 400, cors);
          const a = asinFromUrl(u.href);
          target = a ? AMAZON + '/dp/' + a : u.href;
        } else return json({ error: 'informe asin ou url' }, 400, cors);
        return await cached(request, ctx, 24 * 3600, cors, async () => {
          const { html, finalUrl } = await getHtmlWithUrl(target, DESKTOP_UA);
          const item = parseItem(html);
          item.asin = item.asin || asinFromUrl(finalUrl) || (/^[A-Z0-9]{10}$/.test(asin) ? asin : '');
          if (!item.isbn && /^\d{9}[\dX]$/.test(item.asin)) item.isbn = isbn10to13(item.asin);
          if (!item.title) throw httpError(404, 'não encontrei os dados do livro nessa página');
          return item;
        });
      }
      return json({ error: 'rota desconhecida' }, 404, cors);
    } catch (e) {
      return json({ error: e.message || 'erro', blocked: !!e.blocked }, e.status || 502, cors);
    }
  }
};

/* ------------------------------ rede ------------------------------ */
function httpError(status, message, extra) { const e = new Error(message); e.status = status; Object.assign(e, extra || {}); return e; }
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers) });
}
async function cached(request, ctx, ttl, cors, produce) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(request.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
      r.headers.set('X-Cache', 'HIT');
      return r;
    }
  }
  const data = await produce();
  const res = json(data, 200, Object.assign({ 'Cache-Control': 'public, max-age=' + ttl }, cors));
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
async function getHtml(target, ua) { return (await getHtmlWithUrl(target, ua)).html; }
async function getHtmlWithUrl(target, ua) {
  const res = await fetch(target, {
    redirect: 'follow',
    headers: {
      'User-Agent': ua || UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
      'Cache-Control': 'no-cache'
    },
    cf: { cacheTtl: 0 }
  });
  const html = await res.text();
  if (isBlocked(html) || res.status === 503) throw httpError(503, 'a Amazon pediu verificação (bloqueio temporário)', { blocked: true });
  if (res.status === 404) throw httpError(404, 'página não encontrada na Amazon');
  if (!res.ok) throw httpError(502, 'a Amazon respondeu ' + res.status);
  return { html, finalUrl: res.url || target };
}
function isBlocked(html) {
  return /validateCaptcha|captcha\.html|Type the characters you see|Digite os caracteres que você vê|api-services-support@amazon\.com|To discuss automated access/i.test(html.slice(0, 20000));
}

/* ------------------------------ utilidades ------------------------------ */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rlm: '', lrm: '', '#39': "'" };
function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => (n in ENT ? ENT[n] : m));
}
function text(html) {
  return decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\u200e\u200f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  const m = String(tag || '').match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? decode(m[2] != null ? m[2] : m[3]) : '';
}
export function isbn10to13(i10) {
  const core = '978' + i10.slice(0, 9);
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += (+core[k]) * (k % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}
export function asinFromUrl(u) {
  const m = String(u || '').match(/\/(?:dp|gp\/product|gp\/aw\/d|o\/ASIN|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : '';
}
/* imagem da Amazon em tamanho bom para capa (remove o sufixo de miniatura) */
export function bigCover(src) {
  if (!src) return '';
  const s = src.replace(/^http:/, 'https:');
  return /m\.media-amazon\.com|images-amazon\.com|ssl-images-amazon\.com/.test(s) ? s.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, '._SY500_.$1') : s;
}
const FORMAT_RE = /(Capa dura|Capa comum|Capa flexível|Livro de bolso|Brochura|eBook Kindle|Edição Kindle|Kindle|Audiolivro|Audible|Espiral|Hardcover|Paperback)/i;
const DATE_RE = /\b\d{1,2}\s+(?:de\s+)?[a-zç]{3,9}\.?\s+(?:de\s+)?\d{4}\b|\b(?:19|20)\d{2}\b/i;

/* ------------------------------ busca ------------------------------ */
export function parseSearch(html) {
  const out = [];
  const re = /<div\b[^>]*data-component-type="s-search-result"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = re.exec(html))) starts.push({ i: m.index, tag: m[0] });
  starts.forEach((s, k) => {
    const chunk = html.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : s.i + 60000);
    const asin = attr(s.tag, 'data-asin').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return;
    const imgTag = (chunk.match(/<img\b[^>]*class="[^"]*\bs-image\b[^"]*"[^>]*>/i) || [''])[0];
    let title = '';
    const h2 = chunk.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2) title = attr(h2[0], 'aria-label') || text(h2[1]);
    if (!title) title = attr(imgTag, 'alt');
    title = title.replace(/^Anúncio patrocinado\s*[–-]\s*/i, '').trim();
    if (!title) return;

    // linha do autor: "de/por Fulano | 24 setembro 2012" (logo após o título)
    let author = '';
    let year = '';
    const after = h2 ? chunk.slice(chunk.indexOf(h2[0]) + h2[0].length) : chunk;
    const rows = after.match(/<div\b[^>]*class="[^"]*\ba-row\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const row of rows.slice(0, 4)) {
      const t = text(row);
      if (!t || /estrelas|avaliaç|R\$|frete|entrega|comprad/i.test(t)) continue;
      if (/^(de|por|by)\s/i.test(t) || /\|/.test(t)) {
        const parts = t.replace(/^(de|por|by)\s+/i, '').split('|').map((x) => x.trim()).filter(Boolean);
        const dateP = parts.find((p) => DATE_RE.test(p) && !/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(p.replace(DATE_RE, '')));
        const authP = parts.find((p) => p !== dateP && !/^edição/i.test(p) && !/^(português|inglês)$/i.test(p));
        author = (authP || '').replace(/^(de|por|by)\s+/i, '').replace(/\s*e\s*mais\s*\d+.*$/i, '').trim();
        const y = dateP && dateP.match(/(?:19|20)\d{2}/);
        year = y ? y[0] : '';
        break;
      }
    }
    const fm = text(chunk).match(FORMAT_RE);
    const isbn = /^\d{9}[\dX]$/.test(asin) ? isbn10to13(asin) : '';
    out.push({
      asin, isbn, title: decode(title), author, year,
      format: fm ? fm[1] : '',
      cover: bigCover(attr(imgTag, 'src')),
      sponsored: /AdHolder|Patrocinado|sponsored/i.test(s.tag + chunk.slice(0, 3000))
    });
  });
  // mantém a ordem da Amazon, mas joga patrocinados para o fim e remove repetidos
  const seen = new Set();
  return out.filter((r) => !seen.has(r.asin) && seen.add(r.asin))
    .sort((a, b) => (a.sponsored === b.sponsored ? 0 : a.sponsored ? 1 : -1))
    .slice(0, 30);
}

/* ------------------------------ produto ------------------------------ */
export function detailPairs(html) {
  const pairs = {};
  const put = (k, v) => {
    const key = text(k).replace(/[:\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const val = text(v);
    if (key && val && !(key in pairs)) pairs[key] = val;
  };
  let m;
  const bullets = /<span\b[^>]*class="[^"]*\ba-text-bold\b[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/gi;
  while ((m = bullets.exec(html))) put(m[1], m[2]);
  const table = /<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  while ((m = table.exec(html))) put(m[1], m[2]);
  // cartões "informações do produto" (rpi): id="rpi-attribute-book_details-fiona_pages" … <span>408 páginas</span>
  const rpi = /id="rpi-attribute-([\w-]+)"[\s\S]{0,1500}?rpi-attribute-value[^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = rpi.exec(html))) put('rpi ' + m[1], m[2]);
  return pairs;
}
export function parseItem(html) {
  const pick = (re) => { const m = html.match(re); return m ? text(m[1]) : ''; };
  const title = pick(/<span\b[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/i) || pick(/<meta\b[^>]*name="title"[^>]*content="([^"]*)"/i).split(/\s*[|:]\s*Amazon/i)[0];
  const subtitle = pick(/<span\b[^>]*id="productSubtitle"[^>]*>([\s\S]*?)<\/span>/i);

  // autores (ignora tradutor, ilustrador etc.)
  const people = [];
  const byline = (html.match(/id="bylineInfo"[\s\S]*?(?=<div\b[^>]*id="(?:averageCustomerReviews|centerCol|title_feature_div|bookDescription)|$)/i) || [''])[0].slice(0, 12000);
  const reA = /<span\b[^>]*class="[^"]*\bauthor\b[^"]*"[^>]*>([\s\S]*?)(?=<span\b[^>]*class="[^"]*\bauthor\b|$)/gi;
  let m;
  while ((m = reA.exec(byline))) {
    const name = text((m[1].match(/<a\b[^>]*>([\s\S]*?)<\/a>/i) || ['', ''])[1]);
    const role = text((m[1].match(/class="[^"]*contribution[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/i) || ['', ''])[1]).replace(/[(),]/g, ' ').trim();
    if (name) people.push({ name, role });
  }
  const authors = people.filter((p) => !p.role || /autor|author|organiz|editor/i.test(p.role) && !/tradu|ilustr|narr/i.test(p.role));
  const author = (authors.length ? authors : people.slice(0, 1)).map((p) => p.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');

  const d = detailPairs(html);
  const get = (...keys) => { for (const k of keys) { const f = Object.keys(d).find((x) => x === k || x.startsWith(k)); if (f) return d[f]; } return ''; };

  const pagesText = get('número de páginas', 'capa comum', 'capa dura', 'capa flexível', 'livro de bolso', 'brochura', 'comprimento de impressão',
    'rpi book_details-fiona_pages', 'rpi book_details-ebook_pages', 'paperback', 'hardcover', 'print length');
  const pm = pagesText.match(/(\d[\d.]*)\s*(?:páginas|pages|pág)/i);
  const pages = pm ? parseInt(pm[1].replace(/\./g, ''), 10) : 0;

  const pubRaw = get('editora', 'publisher', 'rpi book_details-publisher');
  let publisher = pubRaw.split(/[;(]/)[0].trim();
  let edition = get('edição', 'edition', 'rpi book_details-edition');
  const edInPub = pubRaw.match(/;\s*([^(;]*edi[çc][ãa]o[^(;]*)/i);
  if (!edition && edInPub) edition = edInPub[1].trim();
  edition = edition.replace(/\s*\(.*$/, '').trim();
  const dateTxt = get('data da publicação', 'publication date', 'rpi book_details-publication_date') || (pubRaw.match(/\(([^)]*)\)/) || ['', ''])[1] || subtitle;
  const ym = dateTxt.match(/(?:19|20)\d{2}/);

  const isbn13 = get('isbn-13', 'rpi book_details-isbn13').replace(/[^0-9X]/gi, '');
  const isbn10 = get('isbn-10', 'rpi book_details-isbn10').replace(/[^0-9X]/gi, '');
  const isbn = isbn13.length === 13 ? isbn13 : isbn10.length === 10 ? isbn10to13(isbn10) : '';

  // capa: maior imagem disponível
  let cover = '';
  const imgTag = (html.match(/<img\b[^>]*id="(?:landingImage|imgBlkFront|ebooksImgBlkFront|main-image)"[^>]*>/i) || [''])[0];
  if (imgTag) {
    const dyn = attr(imgTag, 'data-a-dynamic-image');
    if (dyn) {
      try {
        const obj = JSON.parse(dyn);
        cover = Object.keys(obj).sort((a, b) => (obj[b][0] * obj[b][1]) - (obj[a][0] * obj[a][1]))[0] || '';
      } catch (e) { /* ignora */ }
    }
    cover = cover || attr(imgTag, 'data-old-hires') || attr(imgTag, 'src');
  }
  if (!cover || /^data:/.test(cover)) cover = pick(/<meta\b[^>]*property="og:image"[^>]*content="([^"]*)"/i);

  const fm = (subtitle || '').match(FORMAT_RE);
  return {
    title, author, publisher, edition,
    year: ym ? ym[0] : '',
    pages,
    language: get('idioma', 'language', 'rpi language'),
    isbn,
    format: fm ? fm[1] : '',
    cover: bigCover(cover),
    asin: get('asin').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  };
}
