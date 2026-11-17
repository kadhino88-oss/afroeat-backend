'use strict';

// Extraction des visuels publics d'une page d'accueil : image de partage (og:image / twitter:image)
// et icône la plus grande (apple-touch-icon, icon). Aucune exécution de script, HTML lu en texte.

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
};

const decode = (value) =>
  String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const absolute = (value, base) => {
  try {
    const url = new URL(decode(value), base);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return '';
    return url.toString().slice(0, 1000);
  } catch {
    return '';
  }
};

const iconSize = (tag) => {
  const sizes = attr(tag, 'sizes');
  const n = Number(String(sizes).split(/x/i)[0]);
  if (Number.isFinite(n) && n > 0) return n;
  return /apple-touch-icon/i.test(attr(tag, 'rel')) ? 180 : 32;
};

const extractSiteMedia = (html, pageUrl) => {
  const head = String(html || '').slice(0, 400000);
  let imageUrl = '';
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(key)) {
      const url = absolute(attr(tag, 'content'), pageUrl);
      if (url && !/\.svg(\?|$)/i.test(url)) {
        imageUrl = url;
        break;
      }
    }
  }
  let logoUrl = '';
  let best = 0;
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel)) continue;
    const url = absolute(attr(tag, 'href'), pageUrl);
    if (!url || /\.ico(\?|$)/i.test(url)) continue;
    const size = iconSize(tag);
    if (size > best) {
      best = size;
      logoUrl = url;
    }
  }
  // Une icône minuscule n'apporte rien par rapport au repli actuel.
  if (best && best < 64) logoUrl = '';
  return { imageUrl, logoUrl };
};

module.exports = { extractSiteMedia };
