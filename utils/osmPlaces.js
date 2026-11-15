'use strict';

// Cuisines explicitement non africaines : si le lieu en déclare une (sans cuisine africaine),
// un nom qui ressemble à un pays d'Afrique (ex. « Mali Pizza », « Wakara ») ne suffit pas.
const NON_AFRICAN_CUISINE_RE = /\b(japanese|thai|chinese|korean|vietnamese|indian|italian|turkish|greek|mexican|sushi|ramen|pizza_only)\b/i;
const AFRICAN_CUISINE_RE = /afri|senegal|ivor|camerou|congol|nigeria|ghana|ethiop|eritre|somali|moroc|alger|tunis|egypt|couscous|tajine|mafe|yassa|attieke/i;

// Restauration rapide halal (kebab, tacos, burger, sandwich, poulet…) : majoritairement tenue par des commerçants
// nord-africains. OpenStreetMap n'indique pas l'origine du gérant : ce signal « halal + fast-food » sert de proxy.
const FASTFOOD_WORDS_RE = /\b(kebabs?|kebaps?|d[oö]ner|shawarma|tacos|french[ _]tacos|burgers?|sandwich(?:es)?|chicken|poulet|grill|snack|wraps?|panini|kebab)\b/i;
const TURKISH_RE = /turk|t[uü]rk/i;

const isHalalFastFood = (tags) => {
  const kind = String(tags.amenity || '');
  if (kind !== 'fast_food' && kind !== 'restaurant') return false;
  const halalTag = ['yes', 'only'].includes(String(tags['diet:halal'] || '').toLowerCase());
  const halalName = /halal/i.test(tags.name || '');
  if (!halalTag && !halalName) return false;
  if (TURKISH_RE.test(String(tags.cuisine || ''))) return false;
  return FASTFOOD_WORDS_RE.test(`${tags.cuisine || ''} ${tags.name || ''}`);
};

const isAfricanPlace = (tags) => {
  if (isHalalFastFood(tags)) return true;
  const text = [tags.name, tags.cuisine, tags.brand, tags.operator, tags.description].join(' ');
  if (!AFRICAN_RE.test(text)) return false;
  const cuisine = String(tags.cuisine || '');
  if (NON_AFRICAN_CUISINE_RE.test(cuisine) && !AFRICAN_CUISINE_RE.test(cuisine)) return false;
  return true;
};

// Un lieu est « africain » si son nom, sa cuisine, sa marque ou sa description évoque l'Afrique
// (pays, nationalités, plats typiques, boutiques « exotic / afro »).
const AFRICAN_RE = new RegExp(
  [
    'afri', 'afro(?!d)', 'exotic', 'tropic', 'antill', 'cara[iï]b',
    's[ée]n[ée]gal', 'ivoir', "cote d'?ivoire", 'c[oô]te d.?ivoire', 'camerou', 'congo', 'nigeria', 'ghana',
    '\\bmali\\b', 'malien', 'guin[ée]', '\\btogo\\b', 'b[ée]nin', 'burkina', '\\bgabon', 'tchad', 'niger\\b',
    'ethiop', '[ée]rythr', 'somali', 'kenya', 'ugand', 'tanzan', 'rwanda', 'burundi', 'angola',
    'mozambi', 'zambi', 'zimbab', 'madagas', 'mauritan', 'mauritius', 'sierra leone', 'liberia', 'gambia', 'gambie', 'cap.?vert', 'cabo verde',
    'maroc', 'moroc', 'alg[ée]r', 'tunis', 'egypt', '[ée]gypt', 'liby', 'sudan', 'comor',
    'afrique du sud', 'south africa', 'namibi', 'botswan', 'malawi', 'lesotho', 'eswatini', 'swazi', 'djibouti',
    '[ée]quatorial', 'sao tom', 's[aã]o tom', 'seychell', 'maghreb', 'sahel', 'kabyl', 'berb[eè]re', 'touareg',
    'wolof', 'peul\\b', 'bambara', 'yoruba', 'igbo', 'hausa\\b', 'swahili', 'zulu', 'amhar', 'lingala', 'kinois', 'abidjan', 'dakar', 'douala', 'kinshasa', 'brazzaville', 'lagos', 'accra',
    'poulet dg', 'garba', 'placali', 'saka.?saka', 'pondu', 'liboke', 'chikwangue', 'ugali', 'nyama choma', 'braai', 'bunny chow', 'egusi', 'amala', '\\bakara\\b', 'waakye', 'kelewele', 'banku', 'peri.?peri', 'piri.?piri', 'shawarma africain',
    'poulet\\s+brais', 'brais[ée]s?\\s+(poulet|poisson)', 'tchep', 'dibi', 'soya', 'd[eè]gu[eè]', 'tacos? afri', 'burgers? afri',
    'yassa', 'maf[ée]', 'thi[eé]b', 'attieke', 'attiék', 'alloco', 'kedjenou', 'ndol[ée]', 'foufou', 'fufu', 'foutou',
    'injera', 'suya', 'jollof', 'couscous', 'tajine', 'tagine', 'bissap', 'gnamakoudji', 'kandia',
  ].join('|'),
  'i'
);

const GROCERY_SHOPS = new Set(['supermarket', 'convenience', 'greengrocer', 'general', 'grocery', 'deli']);
// Autres commerces africains, quelle que soit leur taille : mode, beauté, coiffure, boucherie, boulangerie...
const SALON_SHOPS = new Set(['beauty', 'cosmetics', 'hairdresser', 'hairdresser_supply']);
const OTHER_SHOPS = new Set([
  'clothes', 'fabric', 'tailor', 'boutique', 'shoes', 'jewelry', 'beauty', 'cosmetics', 'hairdresser', 'hairdresser_supply',
  'butcher', 'bakery', 'seafood', 'variety_store', 'wholesale', 'department_store', 'mobile_phone', 'money_transfer',
  'florist', 'gift', 'art', 'books', 'music', 'electronics', 'furniture', 'kiosk', 'market', 'marketplace', 'spices', 'tea', 'coffee',
]);

const centroid = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  const ring =
    geometry.type === 'Polygon' ? geometry.coordinates?.[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0]
    : geometry.type === 'LineString' ? geometry.coordinates
    : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
};

// Transforme une feature GeoJSON (osmium export) en document Place, ou null.
const featureToPlace = (feature, region = '') => {
  const tags = feature?.properties || {};
  const name = String(tags.name || '').trim();
  if (!name) return null;

  let kind = null;
  if (tags.amenity === 'restaurant') kind = 'restaurant';
  else if (tags.amenity === 'fast_food') kind = 'fast_food';
  else if (GROCERY_SHOPS.has(tags.shop)) kind = 'grocery';
  else if (OTHER_SHOPS.has(tags.shop) || tags.amenity === 'marketplace') kind = 'shop';
  if (!kind) return null;

  const point = centroid(feature.geometry);
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;

  const idRaw = String(feature.id || tags['@id'] || '');
  if (!idRaw) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || '';
  const text = [tags.name, tags.cuisine, tags.brand, tags.operator, tags.description].join(' ');

  return {
    osmKey: idRaw,
    kind,
    name,
    subtype: tags.shop || '',
    cuisine: tags.cuisine || '',
    address: [street, tags['addr:postcode'], city].filter(Boolean).join(', '),
    city,
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    openingHours: tags.opening_hours || '',
    isAfrican: isAfricanPlace(tags),
    location: { type: 'Point', coordinates: [point[0], point[1]] },
    region,
  };
};

module.exports = { isHalalFastFood, isAfricanPlace, featureToPlace, centroid, AFRICAN_RE, OTHER_SHOPS, GROCERY_SHOPS, SALON_SHOPS };
