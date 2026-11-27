const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toLines, priceLines, sameSiteMenuLinks, PRICE } = require('../scripts/fetch-public-menus');

const HTML = `<html><head><title>Chez Test</title><style>.x{color:red}</style><script>var p="12 €"</script></head><body>
<h2>Plats</h2><div class="dish"><h3>Poulet yassa</h3><p>Citron, oignons</p><span>15,50 €</span></div>
<li>Mafé de bœuf</li><li>CHF 18.-</li><li>Thiéboudienne 17.50 CHF</li><p>Ouvert dès 11 h 30</p>
<a href="/menu">Notre carte</a><a href="https://www.exemple.fr/boissons">Boissons</a><a href="https://autre.com/menu">Autre site</a>
<a href="/photos.jpg">menu photo</a><a href="/contact">Contact</a><a href="javascript:alert(1)">menu</a></body></html>`;

test('le texte est extrait sans script ni style, et les prix reconnus', () => {
  const lines = toLines(HTML);
  assert.ok(!lines.join(' ').includes('color:red') && !lines.join(' ').includes('var p='));
  const prix = priceLines(lines);
  assert.ok(prix.some((l) => l.includes('Poulet yassa') && l.includes('15,50 €')));
  assert.ok(prix.some((l) => l.includes('Thiéboudienne') && l.includes('17.50 CHF')));
  assert.ok(prix.some((l) => l.includes('CHF 18')));
  assert.ok(!prix.some((l) => l.includes('Ouvert dès 11 h 30')));
});

test('la reconnaissance des prix', () => {
  for (const ok of ['12 €', '12,5€', '9.90 CHF', 'CHF 14', 'Fr. 22', '8 EUR']) assert.ok(PRICE.test(ok), ok);
  for (const ko of ['Ouvert 11h30', 'Tel 04 50 12', 'Plat du jour']) assert.ok(!PRICE.test(ko), ko);
});

test('seuls les liens de menu du MÊME site, http(s), hors images, sont suivis', () => {
  const liens = sameSiteMenuLinks(HTML, 'https://www.exemple.fr/');
  assert.deepEqual(liens, ['https://www.exemple.fr/menu', 'https://www.exemple.fr/boissons']);
});

test('le script n\'écrit rien (ni base ni fichier) et le bouton n\'utilise aucun secret', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-public-menus.js'), 'utf8');
  assert.doesNotMatch(src, /mongoose|writeFile|appendFile|createWriteStream/);
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'fetch-public-menus.yml'), 'utf8');
  assert.doesNotMatch(wf, /secrets\./);
  assert.match(wf, /permissions:\n\s+contents: read/);
});

test('décodage en une seule passe et adresses refusées', () => {
  const { decode, safeUrl } = require('../scripts/fetch-public-menus');
  assert.equal(decode('Poulet &amp; riz &euro; &#233;'), 'Poulet & riz € é');
  assert.equal(decode('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  for (const ko of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/', 'https://a:b@exemple.fr/', 'https://exemple.fr:8080/', 'http://serveur.internal/', 'ftp://exemple.fr']) assert.equal(safeUrl(ko), null, ko);
  assert.equal(safeUrl('https://www.exemple.fr/menu'), 'https://www.exemple.fr/menu');
});

test('la liste des 13 sites est valide', () => {
  const { safeUrl } = require('../scripts/fetch-public-menus');
  const sites = require('../data/showcase/sites');
  assert.equal(sites.length, 13);
  assert.equal(new Set(sites.map((s) => s.key)).size, 13);
  for (const s of sites) assert.ok(safeUrl(s.url), s.url);
});
