'use strict';

/**
 * Lit les pages publiques des sites listés dans data/showcase/sites.json et AFFICHE (journal uniquement) les lignes qui
 * contiennent un prix, avec la ligne qui précède (le nom du plat). N'écrit rien en base ni sur disque.
 * Sert à préparer, à la main, les fichiers data/showcase/menus/*.json. Texte seulement : aucune image n'est lue.
 *
 *   node scripts/fetch-public-menus.js
 *
 * Garde-fous : seules les adresses du fichier de la liste (et des liens du MÊME site) sont lues ; http(s) uniquement ;
 * 12 s et 1,5 Mo par page ; 3 pages de menu au plus par site ; un seul accès à la fois ; identifiant de robot clair.
 */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const MAX_MENU_PAGES = 3;
const MAX_LINES_PER_PAGE = 90;
const PRICE = /(\d{1,3}(?:[.,]\d{1,2})?\s?(?:€|eur\b|chf\b|fr\.?\b))|((?:€|chf\b|fr\.?\s)\s?\d{1,3}(?:[.,]\d{1,2})?)/i;
const MENU_LINK = /(menu|carte|plats?|food|restauration|a-emporter|emporter|commander|order|boissons|desserts?)/i;
const UA = 'AfroeatBot/1.0 (preparation de menus de demonstration; contact: BK Entreprise)';

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&[a-z]+;/g, ' ');

const toLines = (html) => decode(
  html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|ul|ol|table|br|span)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

const fetchPage = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return { ok: false, status: res.status };
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    controller.abort();
    return { ok: true, html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), finalUrl: res.url || url };
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 'délai dépassé' : (error.cause?.code || error.message) };
  } finally {
    clearTimeout(timer);
  }
};

const sameSiteMenuLinks = (html, base) => {
  const out = new Map();
  const origin = new URL(base);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (!['http:', 'https:'].includes(u.protocol) || u.hostname.replace(/^www\./, '') !== origin.hostname.replace(/^www\./, '')) continue;
    if (/\.(pdf|jpe?g|png|webp|gif|zip)$/i.test(u.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (MENU_LINK.test(u.pathname) || MENU_LINK.test(label)) out.set(u.origin + u.pathname, true);
  }
  return [...out.keys()].filter((u) => u !== origin.origin + origin.pathname).slice(0, MAX_MENU_PAGES);
};

// Contexte d'un prix : jusqu'à 2 lignes courtes sans prix juste avant (nom du plat, puis description).
const priceLines = (lines) => {
  const out = [];
  lines.forEach((l, i) => {
    if (l.length > 160 || !PRICE.test(l)) return;
    const ctx = [];
    for (let k = i - 1; k >= Math.max(0, i - 2); k -= 1) {
      if (PRICE.test(lines[k]) || lines[k].length > 160) break;
      ctx.unshift(lines[k]);
    }
    out.push((ctx.length ? `${ctx.join('  |  ')}  ||  ` : '') + l);
  });
  return [...new Set(out)].slice(0, MAX_LINES_PER_PAGE);
};

const main = async () => {
  const sites = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'showcase', 'sites.json'), 'utf8'));
  for (const site of sites) {
    console.log(`\n===== ${site.key} — ${site.name} — ${site.url}`);
    const home = await fetchPage(site.url);
    if (!home.ok) { console.log(`INACCESSIBLE (${home.status})`); continue; }
    const pages = [[home.finalUrl, home.html]];
    for (const link of sameSiteMenuLinks(home.html, home.finalUrl)) {
      const p = await fetchPage(link);
      if (p.ok) pages.push([p.finalUrl, p.html]);
    }
    let any = false;
    for (const [url, html] of pages) {
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
      const lines = priceLines(toLines(html));
      console.log(`--- ${url} | titre: ${decode(String(title || '')).replace(/\s+/g, ' ').trim().slice(0, 80)} | ${lines.length} ligne(s) avec prix`);
      lines.forEach((l) => console.log(`  ${l}`));
      if (lines.length) any = true;
    }
    if (!any) console.log('AUCUN PRIX LISIBLE EN TEXTE (carte probablement en image, en PDF ou chargée par un script).');
  }
};

if (require.main === module) {
  main().catch((e) => { console.error(`Échec : ${e.message}`); process.exit(1); });
}

module.exports = { toLines, priceLines, sameSiteMenuLinks, PRICE };
