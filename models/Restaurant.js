const mongoose = require('mongoose');

const allowedCurrencies = ['EUR', 'USD', 'GBP', 'CHF', 'XOF', 'XAF', 'CAD'];

const normalizeString = (value) => String(value || '').trim();

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isValidLatitude = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Number.isFinite(Number(value)) &&
    Number(value) >= -90 &&
    Number(value) <= 90);

const isValidLongitude = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Number.isFinite(Number(value)) &&
    Number(value) >= -180 &&
    Number(value) <= 180);

const openingSlotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      trim: true,
      required: false,
      default: '',
      maxlength: [30, 'Le jour est trop long'],
    },
    open: {
      type: String,
      trim: true,
      default: '',
      maxlength: [10, "L'heure d'ouverture est invalide"],
    },
    close: {
      type: String,
      trim: true,
      default: '',
      maxlength: [10, "L'heure de fermeture est invalide"],
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const geoLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      default: null,
      validate: {
        validator: isValidLatitude,
        message: 'Latitude invalide',
      },
    },
    longitude: {
      type: Number,
      default: null,
      validate: {
        validator: isValidLongitude,
        message: 'Longitude invalide',
      },
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const restaurantSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Le propriétaire du restaurant est obligatoire'],
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Le nom du restaurant est obligatoire'],
      trim: true,
      minlength: [2, 'Le nom du restaurant est trop court'],
      maxlength: [160, 'Le nom du restaurant est trop long'],
    },

    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [2000, 'La description est trop longue'],
    },

    cuisine: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'La cuisine est trop longue'],
      index: true,
    },

    // AFROEAT merchant type; default keeps existing records as restaurants.
    businessType: {
      type: String,
      enum: {
        values: ['restaurant', 'grocery', 'drinks', 'shop'],
        message: 'Type de commerce AFROEAT invalide',
      },
      default: 'restaurant',
      trim: true,
      index: true,
    },

    categories: {
      type: [String],
      default: [],
    },

    image: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1200, "L'URL de l'image est trop longue"],
    },

    coverImage: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1200, "L'URL de l'image de couverture est trop longue"],
    },

    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: [40, 'Le téléphone est trop long'],
    },

    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
      maxlength: [180, "L'email est trop long"],
      index: true,
    },

    address: {
      type: String,
      required: [true, 'L’adresse du restaurant est obligatoire'],
      trim: true,
      minlength: [5, 'L’adresse du restaurant est trop courte'],
      maxlength: [300, 'L’adresse du restaurant est trop longue'],
    },

    city: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'La ville est trop longue'],
      index: true,
    },

    country: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'Le pays est trop long'],
      index: true,
    },

    postalCode: {
      type: String,
      default: '',
      trim: true,
      maxlength: [20, 'Le code postal est trop long'],
    },

    currency: {
      type: String,
      default: 'EUR',
      trim: true,
      uppercase: true,
      enum: {
        values: allowedCurrencies,
        message: 'Devise non prise en charge',
      },
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: [0, 'Les frais de livraison ne peuvent pas être négatifs'],
      validate: {
        validator: Number.isFinite,
        message: 'Les frais de livraison sont invalides',
      },
    },

    minimumOrderAmount: {
      type: Number,
      default: 0,
      min: [0, 'Le minimum de commande ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le minimum de commande est invalide',
      },
    },

    averagePreparationTimeMinutes: {
      type: Number,
      default: 25,
      min: [0, 'Le temps de préparation ne peut pas être négatif'],
      max: [300, 'Le temps de préparation est trop élevé'],
      validate: {
        validator: Number.isFinite,
        message: 'Le temps de préparation est invalide',
      },
    },

    ratingAverage: {
      type: Number,
      default: 0,
      min: [0, 'La note moyenne ne peut pas être négative'],
      max: [5, 'La note moyenne ne peut pas dépasser 5'],
      validate: {
        validator: Number.isFinite,
        message: 'La note moyenne est invalide',
      },
    },

    ratingCount: {
      type: Number,
      default: 0,
      min: [0, 'Le nombre d’avis ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le nombre d’avis est invalide',
      },
    },

    totalOrders: {
      type: Number,
      default: 0,
      min: [0, 'Le total des commandes ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le total des commandes est invalide',
      },
    },

    deliveredOrders: {
      type: Number,
      default: 0,
      min: [0, 'Le total des commandes livrées ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le total des commandes livrées est invalide',
      },
    },

    cancelledOrders: {
      type: Number,
      default: 0,
      min: [0, 'Le total des commandes annulées ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le total des commandes annulées est invalide',
      },
    },

    pendingOrders: {
      type: Number,
      default: 0,
      min: [0, 'Le total des commandes en attente ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le total des commandes en attente est invalide',
      },
    },

    revenue: {
      type: Number,
      default: 0,
      min: [0, 'Le revenu ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le revenu est invalide',
      },
    },

    stats: {
      totalOrders: {
        type: Number,
        default: 0,
        min: 0,
      },
      deliveredOrders: {
        type: Number,
        default: 0,
        min: 0,
      },
      cancelledOrders: {
        type: Number,
        default: 0,
        min: 0,
      },
      pendingOrders: {
        type: Number,
        default: 0,
        min: 0,
      },
      revenue: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    isOpen: {
      type: Boolean,
      default: true,
      index: true,
    },

    autoAcceptOrders: {
      type: Boolean,
      default: false,
    },

    notificationsEnabled: {
      type: Boolean,
      default: true,
    },

    preparationMode: {
      type: Boolean,
      default: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    openingHours: {
      type: [openingSlotSchema],
      default: [],
    },

    location: {
      type: geoLocationSchema,
      default: () => ({
        latitude: null,
        longitude: null,
        updatedAt: null,
      }),
    },

    latitude: {
      type: Number,
      default: null,
      validate: {
        validator: isValidLatitude,
        message: 'Latitude invalide',
      },
    },

    longitude: {
      type: Number,
      default: null,
      validate: {
        validator: isValidLongitude,
        message: 'Longitude invalide',
      },
    },
  },
  {
    timestamps: true,
  }
);

restaurantSchema.index({ createdAt: -1 });
restaurantSchema.index({ owner: 1, createdAt: -1 });
restaurantSchema.index({ name: 1 });
restaurantSchema.index({ cuisine: 1, city: 1, country: 1 });
restaurantSchema.index({ isActive: 1, isOpen: 1, createdAt: -1 });

restaurantSchema.pre('validate', function () {
  try {
    this.name = normalizeString(this.name);
    this.description = normalizeString(this.description);
    this.cuisine = normalizeString(this.cuisine);
    this.image = normalizeString(this.image);
    this.coverImage = normalizeString(this.coverImage);
    this.phone = normalizeString(this.phone);
    this.email = normalizeString(this.email).toLowerCase();
    this.address = normalizeString(this.address);
    this.city = normalizeString(this.city);
    this.country = normalizeString(this.country);
    this.postalCode = normalizeString(this.postalCode);
    this.currency = normalizeString(this.currency || 'EUR').toUpperCase();

    if (!this.owner) {
      throw new Error('Le propriétaire du restaurant est obligatoire');
    }

    if (!this.name) {
      throw new Error('Le nom du restaurant est obligatoire');
    }

    if (!this.address) {
      throw new Error('L’adresse du restaurant est obligatoire');
    }

    if (!allowedCurrencies.includes(this.currency)) {
      throw new Error('Devise non prise en charge');
    }

    if (
      this.latitude !== null &&
      this.latitude !== undefined &&
      !isValidLatitude(this.latitude)
    ) {
      throw new Error('Latitude invalide');
    }

    if (
      this.longitude !== null &&
      this.longitude !== undefined &&
      !isValidLongitude(this.longitude)
    ) {
      throw new Error('Longitude invalide');
    }

    if (this.location) {
      if (
        this.location.latitude !== null &&
        this.location.latitude !== undefined &&
        !isValidLatitude(this.location.latitude)
      ) {
        throw new Error('Latitude de géolocalisation invalide');
      }

      if (
        this.location.longitude !== null &&
        this.location.longitude !== undefined &&
        !isValidLongitude(this.location.longitude)
      ) {
        throw new Error('Longitude de géolocalisation invalide');
      }
    }

    if (Array.isArray(this.categories)) {
      this.categories = [
        ...new Set(
          this.categories.map((item) => normalizeString(item)).filter(Boolean)
        ),
      ];
    } else {
      this.categories = [];
    }

    return;
  } catch (error) {
    throw error;
  }
});

restaurantSchema.pre('save', function () {
  try {
    this.deliveryFee = Number(normalizeNumber(this.deliveryFee, 0).toFixed(2));
    this.minimumOrderAmount = Number(
      normalizeNumber(this.minimumOrderAmount, 0).toFixed(2)
    );
    this.ratingAverage = Number(
      normalizeNumber(this.ratingAverage, 0).toFixed(2)
    );
    this.revenue = Number(normalizeNumber(this.revenue, 0).toFixed(2));

    this.totalOrders = normalizeNumber(this.totalOrders, 0);
    this.deliveredOrders = normalizeNumber(this.deliveredOrders, 0);
    this.cancelledOrders = normalizeNumber(this.cancelledOrders, 0);
    this.pendingOrders = normalizeNumber(this.pendingOrders, 0);
    this.ratingCount = normalizeNumber(this.ratingCount, 0);
    this.averagePreparationTimeMinutes = normalizeNumber(
      this.averagePreparationTimeMinutes,
      25
    );

    if (!this.stats || typeof this.stats !== 'object') {
      this.stats = {};
    }

    this.stats.totalOrders = normalizeNumber(
      this.stats.totalOrders,
      this.totalOrders
    );
    this.stats.deliveredOrders = normalizeNumber(
      this.stats.deliveredOrders,
      this.deliveredOrders
    );
    this.stats.cancelledOrders = normalizeNumber(
      this.stats.cancelledOrders,
      this.cancelledOrders
    );
    this.stats.pendingOrders = normalizeNumber(
      this.stats.pendingOrders,
      this.pendingOrders
    );
    this.stats.revenue = Number(
      normalizeNumber(this.stats.revenue, this.revenue).toFixed(2)
    );

    const hasRootLat =
      this.latitude !== null &&
      this.latitude !== undefined &&
      this.latitude !== '';
    const hasRootLng =
      this.longitude !== null &&
      this.longitude !== undefined &&
      this.longitude !== '';

    if (!this.location || typeof this.location !== 'object') {
      this.location = {
        latitude: null,
        longitude: null,
        updatedAt: null,
      };
    }

    const hasLocationLat =
      this.location.latitude !== null &&
      this.location.latitude !== undefined &&
      this.location.latitude !== '';
    const hasLocationLng =
      this.location.longitude !== null &&
      this.location.longitude !== undefined &&
      this.location.longitude !== '';

    if (hasRootLat && hasRootLng) {
      this.location.latitude = Number(this.latitude);
      this.location.longitude = Number(this.longitude);
      this.location.updatedAt = new Date();
    } else if (hasLocationLat && hasLocationLng) {
      this.latitude = Number(this.location.latitude);
      this.longitude = Number(this.location.longitude);

      if (!this.location.updatedAt) {
        this.location.updatedAt = new Date();
      }
    }

    return;
  } catch (error) {
    throw error;
  }
});

module.exports = mongoose.model('Restaurant', restaurantSchema);