const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Le restaurant est obligatoire'],
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Le nom du plat est obligatoire'],
      trim: true,
      minlength: [2, 'Le nom du plat est trop court'],
      maxlength: [160, 'Le nom du plat est trop long'],
    },

    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'La description est trop longue'],
    },

    price: {
      type: Number,
      required: [true, 'Le prix est obligatoire'],
      min: [0, 'Le prix ne peut pas être négatif'],
    },

    image: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'L’URL de l’image est trop longue'],
    },

    category: {
      type: String,
      default: 'Plats principaux',
      trim: true,
      maxlength: [100, 'La catégorie est trop longue'],
      index: true,
    },

    cuisine: {
      type: String,
      default: '',
      trim: true,
      maxlength: [100, 'La cuisine est trop longue'],
      index: true,
    },

    isPopular: {
      type: Boolean,
      default: false,
      index: true,
    },

    isRecommended: {
      type: Boolean,
      default: false,
      index: true,
    },

    available: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

menuItemSchema.index({ restaurant: 1, category: 1 });
menuItemSchema.index({ restaurant: 1, available: 1 });
menuItemSchema.index({ restaurant: 1, isPopular: -1, isRecommended: -1, createdAt: -1 });
menuItemSchema.index({ category: 1, available: 1 });
menuItemSchema.index({ cuisine: 1, available: 1 });
menuItemSchema.index({ createdAt: -1 });

menuItemSchema.pre('validate', function () {
  if (typeof this.name === 'string') {
    this.name = this.name.trim();
  }

  if (typeof this.description === 'string') {
    this.description = this.description.trim();
  }

  if (typeof this.image === 'string') {
    this.image = this.image.trim();
  }

  if (typeof this.category === 'string') {
    this.category = this.category.trim();
  }

  if (typeof this.cuisine === 'string') {
    this.cuisine = this.cuisine.trim();
  }

  if (this.price !== undefined && this.price !== null) {
    const numericPrice = Number(this.price);

    if (Number.isNaN(numericPrice)) {
      throw new Error('Le prix doit être un nombre valide');
    }

    this.price = numericPrice;
  }
});

menuItemSchema.pre('save', function () {
  if (this.price !== undefined && this.price !== null) {
    const numericPrice = Number(this.price);

    if (Number.isNaN(numericPrice)) {
      throw new Error('Le prix doit être un nombre valide');
    }

    this.price = Number(numericPrice.toFixed(2));
  }
});

module.exports = mongoose.models.MenuItem || mongoose.model('MenuItem', menuItemSchema);