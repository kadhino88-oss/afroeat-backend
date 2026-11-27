'use strict';

// Menus INDICATIFS recopiés des pages publiques des restaurants (texte seulement, aucune photo), phase de test.
// Rien n'est inventé : un prix ou une description absents de la page restent absents. Prix en monnaie du restaurant.
// `token` : mot distinctif cherché dans le nom de la fiche existante (le script exige un résultat unique).
const item = (category, name, price, description = '') => ({ category, name, price, description });

const bombayNaans = [
  ['Egg', 8], ['Poulet Curry', 8], ['Poulet Tandoori', 8], ['Naan Falafel', 8], ['Naan Poulet Spicy', 8],
  ['Green Chicken', 8], ['Bombay-Köfte', 8], ['Bœuf Madras - Dhaka', 10], ['Egg Chicken', 10], ['Naan Pakora', 8],
  ['Naan Mix Pakora Falafel', 8], ['Bangla / Tenders de poulet', 8], ['Cordon Bleu', 8], ['Nuggets', 8],
].map(([n, p]) => item('Naans', n, p, `En menu (avec frites et boisson au choix) : ${p + 3} €`));

const bombayKids = ['Burger', 'Tenders', 'Nuggets', 'Tandoori', 'Curry']
  .map((n) => item('Menu enfant', `Menu Kids · ${n}`, 8.5, '1 au choix + frites + boisson au choix'));

const bombayDrinks = [
  'Coca-Cola', 'Coca Cherry', 'Coca Zéro', 'Oasis Tropical', 'Fanta Orange', 'Eau minérale', 'Café', ['Red Bull', 3],
  'Orangina', 'Oasis Pomme Cassis', 'Lipton Pastèque', 'Lipton Pêche', 'Fanta Citron', 'Sprite', 'Fuze Tea',
  'Dada Cherry', 'Dada Cola', 'Hawaï', 'Schweppes Agrumes', 'Eau gazeuse',
].map((d) => (Array.isArray(d) ? item('Boissons', d[0], d[1]) : item('Boissons', d, 2)));

module.exports = [
  {
    key: 'bombay-snacks-thonon',
    token: 'bombay',
    cuisine: 'Indienne, fast-food halal',
    source: 'https://bombaysnacks-thonon.fr/',
    items: [...bombayNaans, ...bombayKids, ...bombayDrinks],
  },
  {
    key: 'le-224-annemasse',
    token: '224',
    cuisine: 'Africaine',
    source: 'https://le224.fr/',
    items: [
      item('Entrées', 'Pastel Poisson', 6, 'Pâte fine et croustillante, farce au thon frais, persil, ail, oignon confit. Servi avec une réduction de sauce tomate.'),
      item('Entrées', 'Pastel Viande', 6, 'Chaussons croustillants farcis au bœuf haché assaisonné, avec oignons, ail et épices africaines. Servis chauds avec une sauce tomate.'),
      item('Entrées', 'Samoussas Viande', 6, 'Feuilletés croustillants farcis à la viande épicée, accompagnés de sauce tomate.'),
      item('Entrées', 'Samoussas Légume', 6, 'Feuilletés croustillants farcis aux légumes sautés et herbes fraîches, accompagnés de sauce maison.'),
      item('Entrées', 'Crevettes Croustillantes', 6, 'Crevettes fraîches enrobées d’une fine panure dorée, légèrement épicées. Servies chaudes avec une sauce.'),
      item('Entrées', 'Banane Écrasée & Pikliz', 6, 'Banane plantain dorée et écrasée, accompagnée de pikliz (chou, carottes et piments marinés).'),
      item('Entrées', 'Acras', 6, 'Petits beignets dorés parfumés aux épices africaines, accompagnés de sauce tomate. Disponibles le week-end uniquement.'),
      item('Entrées', 'Salade à l’Africaine', 10, 'Mélange frais de légumes croquants relevé d’une vinaigrette aux épices africaines et herbes fraîches.'),
      item('Plats', 'Mafé Viande ou Poulet', 20, 'Viande tendre (bœuf ou poulet) mijotée dans une sauce à la pâte d’arachide avec légumes. Servi avec riz blanc.'),
      item('Plats', 'Thiéboudienne', 25),
      item('Plats', 'Yassa Poulet ou Crevettes', 20, 'Poulet ou crevettes marinés au citron et aux oignons, mijotés lentement. Servi avec riz blanc.'),
      item('Plats', 'Sauce Feuilles de Patates Douces', 20, 'Feuilles de patates douces et viande de bœuf mijotées avec huile de palme et épices africaines. Servi avec riz.'),
      item('Plats', 'Sauce Feuilles de Manioc', 20, 'Feuilles de manioc mijotées avec huile de palme, épices africaines et viande de bœuf. Servi avec riz.'),
      item('Plats', 'Sauce Konkoé', 20, 'Poisson fumé mijoté avec oignons, tomates, poivrons et épices africaines. Servi avec riz.'),
      item('Plats', 'Sauce Tomate à la Viande', 20, 'Morceaux de viande tendres mijotés dans une sauce tomate aux épices africaines. Servi avec riz.'),
      item('Plats', 'Foufou Banane & Sauce Graine', 20),
      item('Plats', 'Couscous Sénégalais', 22, 'Semoule cuite à la vapeur, sauce aux légumes frais, épices africaines et viande. Disponible le vendredi.'),
      item('Grillades', 'Poisson Braisé Dorade', 25, 'Dorade entière grillée à la braise, légèrement épicée aux herbes africaines.'),
      item('Grillades', 'Poisson Braisé Tilapia', 20, 'Tilapia grillé à la braise, assaisonné aux épices et herbes africaines.'),
      item('Grillades', 'Dibi Agneau Grillé', 20, 'Morceaux d’agneau grillés à la braise, assaisonnés aux épices africaines.'),
      item('Grillades', 'Poulet Braisé', 20, 'Demi poulet grillé à la braise, assaisonné aux épices africaines et herbes locales.'),
      item('Grillades', 'Assiette XXL Mix Grillades', 50, 'Assortiment de grillades à partager : poulet braisé, agneau et poisson braisé. Pour 2-3 personnes.'),
      item('Menus', 'Menu Découverte', 29.99),
    ],
  },
  {
    key: 'nyala-barka',
    token: 'nyala',
    cuisine: 'Africaine',
    source: 'https://www.nyalabarka.ch/',
    items: [
      item('Plats', 'Zigni (bœuf)', 22, 'Mijoté de bœuf au berberet (sauce pimentée) et épices.'),
      item('Plats', 'Kitfo', 26),
      item('Plats', 'Tibs Kulwa', 25, 'Sauté de gigot d’agneau aux oignons, saupoudré de poivre vert et noir.'),
      item('Plats', 'Doro Wot', 24),
      item('Plats sur commande', 'Doro Alecha', 24, 'Morceaux de poulet marinés dans une sauce citronnée, cuits à l’étouffé avec oignons, ail et épices.'),
      item('Plats sur commande', 'Alecha Agneau', 25, 'Yebeg alecha : mijoté de gigot d’agneau au curry, oignons et épices du pays.'),
      item('Plats sur commande', 'Gorde Gorde', 26),
      item('Végétarien', 'Shiro', 20, 'Purée de pois chiche assaisonnée au berberet (sauce pimentée) et épices du pays, adoucie d’une noisette de beurre.'),
      item('Végétarien', 'Yemiser Wot', 19, 'Purée de lentilles assaisonnée au berberet (sauce pimentée), oignons et épices.'),
      item('Végétarien', 'Ymiser Alech', 19, 'Purée de lentilles avec ail, oignons et divers épices.'),
      item('Végétarien', 'Atekelt Alecha', 19),
      item('Desserts', 'Salade de fruits', 7),
    ],
  },
];
