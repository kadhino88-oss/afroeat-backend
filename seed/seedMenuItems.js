const dotenv = require('dotenv');
const connectDB = require('../config/db');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const menuData = require('../data/menuData');

dotenv.config();

const FORCE_REPLACE_ALL = true;

const normalizeText = (value) => {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
};

const buildPremiumAfricanFallbackMenu = () => {
  return [
    {
      name: 'Poulet braisé',
      description: 'Poulet grillé mariné aux épices africaines, tendre et fumé.',
      price: 13.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Attiéké poisson',
      description: 'Attiéké frais servi avec poisson frit et sauce piment maison.',
      price: 14.5,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Garba premium',
      description: 'Attiéké, thon frit croustillant, oignons frais et tomate.',
      price: 11.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Alloco œuf',
      description: 'Bananes plantains frites servies avec œuf et sauce tomate relevée.',
      price: 8.5,
      image: '',
      category: 'Accompagnements',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Alloco poulet',
      description: 'Alloco généreux accompagné de morceaux de poulet grillé.',
      price: 10.9,
      image: '',
      category: 'Accompagnements',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Kedjenou de poulet',
      description: 'Poulet mijoté à l’ivoirienne avec légumes et épices douces.',
      price: 15.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Sauce graine',
      description: 'Sauce onctueuse à base de graine de palme servie avec viande.',
      price: 14.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Sauce arachide bœuf',
      description: 'Bœuf tendre mijoté dans une sauce arachide riche et parfumée.',
      price: 15.5,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Foutou sauce claire',
      description: 'Foutou banane servi avec sauce claire relevée et viande.',
      price: 16.2,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Placali sauce gombo',
      description: 'Placali accompagné de sauce gombo fraîche et viande.',
      price: 14.7,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Ivoirienne',
      isPopular: false,
      isRecommended: false,
      available: true,
    },

    {
      name: 'Yassa poulet',
      description: 'Poulet mariné au citron et aux oignons, recette sénégalaise.',
      price: 15.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Yassa poisson',
      description: 'Poisson grillé nappé de sauce yassa citronnée aux oignons.',
      price: 16.5,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Thiéboudiène rouge',
      description: 'Riz rouge sénégalais au poisson et légumes fondants.',
      price: 17.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Thiéboudiène blanc',
      description: 'Riz blanc parfumé avec poisson et légumes mijotés.',
      price: 17.5,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Mafé poulet',
      description: 'Poulet tendre dans une sauce arachide épaisse et savoureuse.',
      price: 15.4,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Mafé bœuf',
      description: 'Bœuf mijoté longuement dans une sauce mafé généreuse.',
      price: 16.4,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Dibi agneau',
      description: 'Agneau grillé à la sénégalaise, épicé et très tendre.',
      price: 18.9,
      image: '',
      category: 'Grillades',
      cuisine: 'Sénégalaise',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Pastels au poisson',
      description: 'Beignets croustillants farcis au poisson et épices.',
      price: 7.9,
      image: '',
      category: 'Entrées',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Fataya viande',
      description: 'Chaussons dorés et croustillants farcis à la viande hachée.',
      price: 7.5,
      image: '',
      category: 'Entrées',
      cuisine: 'Sénégalaise',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Bissap maison',
      description: 'Boisson fraîche à l’hibiscus, légèrement sucrée.',
      price: 3.9,
      image: '',
      category: 'Boissons',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },

    {
      name: 'Poulet DG',
      description: 'Poulet sauté aux plantains et légumes, signature camerounaise.',
      price: 17.4,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Camerounaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Ndolé crevettes',
      description: 'Ndolé traditionnel aux crevettes avec plantains ou riz.',
      price: 18.2,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Camerounaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Ndolé bœuf',
      description: 'Feuilles de ndolé mijotées avec bœuf et pâte d’arachide.',
      price: 17.6,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Camerounaise',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Eru traditionnel',
      description: 'Eru parfumé accompagné de viande et d’épices profondes.',
      price: 17.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Camerounaise',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Koki haricots',
      description: 'Gâteau de haricots vapeur moelleux et parfumé.',
      price: 9.2,
      image: '',
      category: 'Entrées',
      cuisine: 'Camerounaise',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Brochettes suya bœuf',
      description: 'Brochettes de bœuf épicées, style street food africaine.',
      price: 12.8,
      image: '',
      category: 'Grillades',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Plantains frits',
      description: 'Plantains mûrs frits, dorés et fondants.',
      price: 5.2,
      image: '',
      category: 'Accompagnements',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Riz jollof',
      description: 'Riz tomate épicé, riche en saveurs ouest-africaines.',
      price: 6.5,
      image: '',
      category: 'Accompagnements',
      cuisine: 'Nigériane',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Riz jollof poulet',
      description: 'Riz jollof servi avec poulet grillé mariné.',
      price: 14.2,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Nigériane',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Egusi soup',
      description: 'Soupe egusi riche et onctueuse avec viande et légumes.',
      price: 16.8,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Nigériane',
      isPopular: false,
      isRecommended: true,
      available: true,
    },

    {
      name: 'Pounded yam & egusi',
      description: 'Igname pilée servie avec soupe egusi savoureuse.',
      price: 17.3,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Nigériane',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Fufu sauce arachide',
      description: 'Fufu moelleux accompagné d’une sauce arachide généreuse.',
      price: 15.8,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Tilapia braisé',
      description: 'Tilapia entier grillé, mariné aux épices et herbes fraîches.',
      price: 18.5,
      image: '',
      category: 'Poissons',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Capitaine grillé',
      description: 'Poisson capitaine grillé, servi avec accompagnement maison.',
      price: 19.4,
      image: '',
      category: 'Poissons',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Brochettes de poulet',
      description: 'Brochettes marinées, grillées minute, très juteuses.',
      price: 11.7,
      image: '',
      category: 'Grillades',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Bœuf braisé',
      description: 'Pièces de bœuf grillées et marinées aux épices maison.',
      price: 15.2,
      image: '',
      category: 'Grillades',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Poisson braisé attiéké',
      description: 'Poisson braisé servi avec attiéké frais et crudités.',
      price: 16.9,
      image: '',
      category: 'Poissons',
      cuisine: 'Ivoirienne',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Akara',
      description: 'Beignets de haricots croustillants, parfaits en entrée.',
      price: 6.4,
      image: '',
      category: 'Entrées',
      cuisine: 'Nigériane',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Chin chin',
      description: 'Petites douceurs croustillantes légèrement sucrées.',
      price: 4.9,
      image: '',
      category: 'Desserts',
      cuisine: 'Nigériane',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Puff puff',
      description: 'Beignets moelleux et aériens, snack africain iconique.',
      price: 5.5,
      image: '',
      category: 'Desserts',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: false,
      available: true,
    },

    {
      name: 'Jus de gingembre',
      description: 'Boisson fraîche au gingembre, intense et tonique.',
      price: 3.9,
      image: '',
      category: 'Boissons',
      cuisine: 'Africaine',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Jus de baobab',
      description: 'Boisson onctueuse et rafraîchissante au fruit de baobab.',
      price: 4.2,
      image: '',
      category: 'Boissons',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Jus de tamarin',
      description: 'Boisson douce et acidulée, très désaltérante.',
      price: 4.2,
      image: '',
      category: 'Boissons',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Dégué',
      description: 'Dessert lacté aux petites perles, frais et gourmand.',
      price: 5.9,
      image: '',
      category: 'Desserts',
      cuisine: 'Sénégalaise',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Thiakry',
      description: 'Semoule fine au lait et yaourt, dessert très parfumé.',
      price: 5.7,
      image: '',
      category: 'Desserts',
      cuisine: 'Sénégalaise',
      isPopular: true,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Beignets africains',
      description: 'Beignets sucrés moelleux, servis chauds.',
      price: 4.8,
      image: '',
      category: 'Desserts',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Riz coco crevettes',
      description: 'Riz au lait de coco servi avec crevettes épicées.',
      price: 16.9,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Crevettes sautées africaines',
      description: 'Crevettes sautées aux épices douces, ail et herbes.',
      price: 17.8,
      image: '',
      category: 'Poissons',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: true,
      available: true,
    },
    {
      name: 'Haricots rouges plantain',
      description: 'Haricots rouges mijotés servis avec plantains frits.',
      price: 11.4,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
    {
      name: 'Riz sauce légumes',
      description: 'Riz blanc accompagné d’une sauce légumes maison.',
      price: 10.6,
      image: '',
      category: 'Plats principaux',
      cuisine: 'Africaine',
      isPopular: false,
      isRecommended: false,
      available: true,
    },
  ];
};

const findCuisineItems = (restaurantCuisine) => {
  const normalizedRestaurantCuisine = normalizeText(restaurantCuisine);

  return menuData.find((entry) => {
    const normalizedEntryCuisine = normalizeText(entry.cuisine);
    return normalizedEntryCuisine === normalizedRestaurantCuisine;
  });
};

const buildItemsForRestaurant = (restaurant) => {
  const cuisineBlock = findCuisineItems(restaurant.cuisine);

  if (cuisineBlock?.items?.length) {
    return cuisineBlock.items.map((item) => ({
      ...item,
      cuisine: item.cuisine || cuisineBlock.cuisine || restaurant.cuisine || 'Africaine',
      available: item.available !== undefined ? item.available : true,
      isPopular: item.isPopular || false,
      isRecommended: item.isRecommended || false,
      image: item.image || '',
      category: item.category || 'Plats principaux',
      price: Number(item.price || 0),
    }));
  }

  return buildPremiumAfricanFallbackMenu().map((item) => ({
    ...item,
    cuisine: item.cuisine || restaurant.cuisine || 'Africaine',
  }));
};

const seedMenuItems = async () => {
  try {
    await connectDB();

    console.log('✅ Connexion MongoDB OK');
    console.log('🍽️ Début injection menus...');

    const restaurants = await Restaurant.find().select('_id name cuisine');

    if (!restaurants.length) {
      console.log('⚠️ Aucun restaurant trouvé en base.');
      process.exit(0);
    }

    for (const restaurant of restaurants) {
      const existingItems = await MenuItem.find({ restaurant: restaurant._id }).select('_id');

      if (FORCE_REPLACE_ALL) {
        await MenuItem.deleteMany({ restaurant: restaurant._id });
        console.log(`🧹 "${restaurant.name}" : ancien menu supprimé (${existingItems.length} plats).`);
      } else {
        if (existingItems.length > 1) {
          console.log(
            `⏭️ "${restaurant.name}" ignoré : menu déjà existant (${existingItems.length} plats).`
          );
          continue;
        }

        if (existingItems.length === 1) {
          await MenuItem.deleteMany({ restaurant: restaurant._id });
          console.log(`🧹 "${restaurant.name}" : menu minimal supprimé (1 plat).`);
        }
      }

      const itemsSource = buildItemsForRestaurant(restaurant);

      const itemsToInsert = itemsSource
        .filter((item) => item.name && Number.isFinite(Number(item.price)))
        .map((item) => ({
          restaurant: restaurant._id,
          name: item.name,
          description: item.description || '',
          price: Number(Number(item.price).toFixed(2)),
          image: item.image || '',
          category: item.category || 'Plats principaux',
          cuisine: item.cuisine || restaurant.cuisine || 'Africaine',
          isPopular: item.isPopular || false,
          isRecommended: item.isRecommended || false,
          available: item.available !== undefined ? item.available : true,
        }));

      if (!itemsToInsert.length) {
        console.log(`⚠️ "${restaurant.name}" : aucun plat exploitable à injecter.`);
        continue;
      }

      await MenuItem.insertMany(itemsToInsert);

      console.log(`✅ "${restaurant.name}" : ${itemsToInsert.length} plats ajoutés.`);
    }

    console.log('🔥 Injection terminée avec succès.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur pendant le seed des menus :', error);
    process.exit(1);
  }
};

seedMenuItems();