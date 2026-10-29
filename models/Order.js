const mongoose = require('mongoose');

const allowedStatuses = [
  'En attente',
  'Confirmée',
  'En préparation',
  'En livraison',
  'Livrée',
  'Annulée',
];

const allowedPaymentStatuses = ['Non payé', 'Payé', 'Remboursé'];

const allowedCurrencies = ['EUR', 'USD', 'GBP', 'CHF', 'XOF', 'XAF', 'CAD'];

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const isValidLatitude = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (isFiniteNumber(value) && Number(value) >= -90 && Number(value) <= 90);

const isValidLongitude = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (isFiniteNumber(value) && Number(value) >= -180 && Number(value) <= 180);

const normalizeString = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Number(normalizeNumber(value, 0).toFixed(2));

const orderItemSchema = new mongoose.Schema(
  {
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: [true, 'Le plat est obligatoire'],
    },

    name: {
      type: String,
      required: [true, 'Le nom du plat est obligatoire'],
      trim: true,
      minlength: [1, 'Le nom du plat est obligatoire'],
      maxlength: [160, 'Le nom du plat est trop long'],
    },

    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: [1, 'La quantité doit être au moins 1'],
      validate: {
        validator: Number.isFinite,
        message: 'La quantité est invalide',
      },
    },

    price: {
      type: Number,
      required: true,
      min: [0, 'Le prix ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le prix est invalide',
      },
    },

    image: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, "L'URL de l'image est trop longue"],
    },

    notes: {
      type: String,
      default: '',
      trim: true,
      maxlength: [300, 'Les notes de l’item sont trop longues'],
    },
  },
  { _id: false }
);

const geoPointSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      default: null,
      validate: {
        validator: isValidLatitude,
        message: 'Latitude invalide',
      },
    },

    lng: {
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

const legacyDeliveryLocationSchema = new mongoose.Schema(
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

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: {
        values: allowedStatuses,
        message: 'Statut historique invalide',
      },
      required: true,
      trim: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    updatedByRole: {
      type: String,
      default: '',
      trim: true,
      maxlength: [40, 'Le rôle historique est trop long'],
    },

    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: [300, 'La note historique est trop longue'],
    },

    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'L’utilisateur est obligatoire'],
      index: true,
    },

    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Le restaurant est obligatoire'],
      index: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'La commande doit contenir au moins un item',
      },
    },

    totalPrice: {
      type: Number,
      required: true,
      min: [0, 'Le prix total ne peut pas être négatif'],
      default: 0,
      validate: {
        validator: Number.isFinite,
        message: 'Le prix total est invalide',
      },
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

    // Don optionnel "Afro Impact" ajoute par le client au moment du
    // checkout (arrondi de commande reverse a une association) -
    // jamais applique automatiquement, toujours un choix explicite du client.
    donationAmount: {
      type: Number,
      default: 0,
      min: [0, 'Le don ne peut pas être négatif'],
      max: [100, 'Le don semble anormalement élevé'],
      validate: {
        validator: Number.isFinite,
        message: 'Le montant du don est invalide',
      },
    },

    driverEarning: {
      type: Number,
      default: 0,
      min: [0, 'Le gain livreur ne peut pas être négatif'],
      validate: {
        validator: Number.isFinite,
        message: 'Le gain livreur est invalide',
      },
    },

    deliveryAddress: {
      type: String,
      required: [true, 'L’adresse de livraison est obligatoire'],
      trim: true,
      minlength: [5, 'L’adresse de livraison est trop courte'],
      maxlength: [300, 'L’adresse de livraison est trop longue'],
    },

    status: {
      type: String,
      enum: {
        values: allowedStatuses,
        message: 'Statut de commande invalide',
      },
      default: 'En attente',
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: {
        values: allowedPaymentStatuses,
        message: 'Statut de paiement invalide',
      },
      default: 'Non payé',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ['card', 'stripe_checkout', 'cash'],
      default: null,
      trim: true,
    },

    stripePaymentIntentId: {
      type: String,
      default: null,
      trim: true,
      maxlength: [255, 'Identifiant PaymentIntent invalide'],
    },

    stripeCheckoutSessionId: {
      type: String,
      default: null,
      trim: true,
      maxlength: [255, 'Identifiant Checkout Session invalide'],
    },

    stripeRefundId: {
      type: String,
      default: null,
      trim: true,
      maxlength: [255, 'Identifiant de remboursement invalide'],
    },

    paidAt: {
      type: Date,
      default: null,
    },

    refundedAt: {
      type: Date,
      default: null,
    },

    lastPaymentError: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'Le message de paiement est trop long'],
    },

    deliveryPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    notes: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'Les notes sont trop longues'],
    },

    customerLocation: {
      type: geoPointSchema,
      default: () => ({
        lat: null,
        lng: null,
        updatedAt: null,
      }),
    },

    restaurantLocation: {
      type: geoPointSchema,
      default: () => ({
        lat: null,
        lng: null,
        updatedAt: null,
      }),
    },

    driverLocation: {
      type: geoPointSchema,
      default: () => ({
        lat: null,
        lng: null,
        updatedAt: null,
      }),
    },

    deliveryLocation: {
      type: legacyDeliveryLocationSchema,
      default: () => ({
        latitude: null,
        longitude: null,
        updatedAt: null,
      }),
    },

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    deliveryStartedAt: {
      type: Date,
      default: null,
    },

    pickedUpAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    lastTrackingEventAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ updatedAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, createdAt: -1 });
orderSchema.index({ deliveryPerson: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ stripePaymentIntentId: 1 });
orderSchema.index({ stripeCheckoutSessionId: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ status: 1, deliveryPerson: 1, updatedAt: -1 });
orderSchema.index({ restaurant: 1, status: 1, createdAt: -1 });
orderSchema.index({ user: 1, status: 1, createdAt: -1 });

const validateGeoPoint = (point) => {
  if (!point) return true;

  const hasLat = point.lat !== null && point.lat !== undefined && point.lat !== '';
  const hasLng = point.lng !== null && point.lng !== undefined && point.lng !== '';

  if (!hasLat && !hasLng) {
    return true;
  }

  return isValidLatitude(point.lat) && isValidLongitude(point.lng);
};

const touchGeoPointUpdatedAt = (point) => {
  if (!point) return;

  const hasLat = point.lat !== null && point.lat !== undefined && point.lat !== '';
  const hasLng = point.lng !== null && point.lng !== undefined && point.lng !== '';

  if ((hasLat || hasLng) && !point.updatedAt) {
    point.updatedAt = new Date();
  }
};

const syncDriverAndLegacyDeliveryLocation = (order) => {
  if (!order) return;

  if (!order.driverLocation || typeof order.driverLocation !== 'object') {
    order.driverLocation = {
      lat: null,
      lng: null,
      updatedAt: null,
    };
  }

  if (!order.deliveryLocation || typeof order.deliveryLocation !== 'object') {
    order.deliveryLocation = {
      latitude: null,
      longitude: null,
      updatedAt: null,
    };
  }

  const hasDriverLat =
    order.driverLocation.lat !== null &&
    order.driverLocation.lat !== undefined &&
    order.driverLocation.lat !== '';

  const hasDriverLng =
    order.driverLocation.lng !== null &&
    order.driverLocation.lng !== undefined &&
    order.driverLocation.lng !== '';

  const hasLegacyLat =
    order.deliveryLocation.latitude !== null &&
    order.deliveryLocation.latitude !== undefined &&
    order.deliveryLocation.latitude !== '';

  const hasLegacyLng =
    order.deliveryLocation.longitude !== null &&
    order.deliveryLocation.longitude !== undefined &&
    order.deliveryLocation.longitude !== '';

  if (hasDriverLat && hasDriverLng) {
    order.deliveryLocation.latitude = Number(order.driverLocation.lat);
    order.deliveryLocation.longitude = Number(order.driverLocation.lng);
    order.deliveryLocation.updatedAt =
      order.driverLocation.updatedAt ||
      order.deliveryLocation.updatedAt ||
      new Date();
  } else if (hasLegacyLat && hasLegacyLng) {
    order.driverLocation.lat = Number(order.deliveryLocation.latitude);
    order.driverLocation.lng = Number(order.deliveryLocation.longitude);
    order.driverLocation.updatedAt =
      order.deliveryLocation.updatedAt ||
      order.driverLocation.updatedAt ||
      new Date();
  }
};

const ensureStatusHistory = (order) => {
  if (!order) return;

  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }

  const currentStatus = normalizeString(order.status);
  if (!currentStatus) {
    return;
  }

  const lastHistoryEntry = order.statusHistory[order.statusHistory.length - 1];
  const lastStatus = normalizeString(lastHistoryEntry?.status);

  if (lastStatus !== currentStatus) {
    order.statusHistory.push({
      status: currentStatus,
      updatedBy: null,
      updatedByRole: '',
      note: '',
      at: new Date(),
    });
  }
};

orderSchema.pre('validate', function () {
  if (!Array.isArray(this.items) || this.items.length === 0) {
    throw new Error('La commande doit contenir au moins un item');
  }

  const invalidItem = this.items.find((item) => {
    if (!item) return true;

    const hasMenuItem = Boolean(item.menuItem);
    const hasName = normalizeString(item.name).length > 0;
    const quantity = normalizeNumber(item.quantity, NaN);
    const price = normalizeNumber(item.price, NaN);

    return (
      !hasMenuItem ||
      !hasName ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    );
  });

  if (invalidItem) {
    throw new Error('Un ou plusieurs items de la commande sont invalides');
  }

  if (!allowedStatuses.includes(this.status)) {
    throw new Error('Statut de commande invalide');
  }

  if (!allowedPaymentStatuses.includes(this.paymentStatus)) {
    throw new Error('Statut de paiement invalide');
  }

  if (!allowedCurrencies.includes(this.currency)) {
    throw new Error('Devise non prise en charge');
  }

  if (!normalizeString(this.deliveryAddress)) {
    throw new Error('L’adresse de livraison est obligatoire');
  }

  if (!validateGeoPoint(this.customerLocation)) {
    throw new Error('Coordonnées client invalides');
  }

  if (!validateGeoPoint(this.restaurantLocation)) {
    throw new Error('Coordonnées restaurant invalides');
  }

  if (!validateGeoPoint(this.driverLocation)) {
    throw new Error('Coordonnées livreur invalides');
  }

  if (
    this.deliveryLocation &&
    ((this.deliveryLocation.latitude !== null &&
      this.deliveryLocation.latitude !== undefined &&
      !isValidLatitude(this.deliveryLocation.latitude)) ||
      (this.deliveryLocation.longitude !== null &&
        this.deliveryLocation.longitude !== undefined &&
        !isValidLongitude(this.deliveryLocation.longitude)))
  ) {
    throw new Error('Coordonnées legacy de livraison invalides');
  }
});

orderSchema.pre('save', function () {
  const normalizedDeliveryFee = roundMoney(this.deliveryFee);
  this.deliveryFee = normalizedDeliveryFee;

  const normalizedDonationAmount = roundMoney(this.donationAmount);
  this.donationAmount = normalizedDonationAmount;

  if (Array.isArray(this.items) && this.items.length > 0) {
    const calculatedItemsTotal = this.items.reduce((acc, item) => {
      const price = normalizeNumber(item.price, 0);
      const quantity = normalizeNumber(item.quantity, 0);
      return acc + price * quantity;
    }, 0);

    const itemsSubtotal = roundMoney(calculatedItemsTotal);
    this.totalPrice = roundMoney(
      itemsSubtotal + normalizedDeliveryFee + normalizedDonationAmount
    );
  } else {
    this.totalPrice = roundMoney(this.totalPrice);
  }

  this.driverEarning = roundMoney(
    this.driverEarning > 0 ? this.driverEarning : this.deliveryFee
  );

  this.notes = normalizeString(this.notes);
  this.deliveryAddress = normalizeString(this.deliveryAddress);
  this.currency = normalizeString(this.currency || 'EUR').toUpperCase();

  touchGeoPointUpdatedAt(this.customerLocation);
  touchGeoPointUpdatedAt(this.restaurantLocation);
  touchGeoPointUpdatedAt(this.driverLocation);

  if (this.deliveryLocation) {
    const hasLatitude =
      this.deliveryLocation.latitude !== null &&
      this.deliveryLocation.latitude !== undefined &&
      this.deliveryLocation.latitude !== '';

    const hasLongitude =
      this.deliveryLocation.longitude !== null &&
      this.deliveryLocation.longitude !== undefined &&
      this.deliveryLocation.longitude !== '';

    if ((hasLatitude || hasLongitude) && !this.deliveryLocation.updatedAt) {
      this.deliveryLocation.updatedAt = new Date();
    }
  }

  syncDriverAndLegacyDeliveryLocation(this);

  if (this.driverLocation && this.driverLocation.updatedAt) {
    this.lastTrackingEventAt = this.driverLocation.updatedAt;
  } else if (this.deliveryLocation && this.deliveryLocation.updatedAt) {
    this.lastTrackingEventAt = this.deliveryLocation.updatedAt;
  }

  if (this.status === 'En livraison') {
    if (!this.deliveryStartedAt) {
      this.deliveryStartedAt = new Date();
    }

    if (!this.pickedUpAt) {
      this.pickedUpAt = new Date();
    }
  }

  if (this.status === 'Livrée') {
    if (!this.deliveredAt) {
      this.deliveredAt = new Date();
    }

    if (!this.completedAt) {
      this.completedAt = new Date();
    }
  }

  ensureStatusHistory(this);
});

module.exports = mongoose.model('Order', orderSchema);