const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ALLOWED_ROLES = ['client', 'restaurant', 'livreur', 'admin'];

const ALLOWED_ACCOUNT_STATUSES = [
  'pending_verification',
  'active',
  'suspended',
  'rejected',
];

const normalizeString = (value) => String(value || '').trim();

const normalizeEmail = (value) => normalizeString(value).toLowerCase();

const isStrongEnoughPassword = (value) => {
  const password = String(value || '');
  return password.length >= 6;
};

const fileUrlField = {
  type: String,
  default: '',
  trim: true,
  maxlength: [1200, 'URL trop longue'],
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom est obligatoire'],
      trim: true,
      minlength: [2, 'Le nom est trop court'],
      maxlength: [120, 'Le nom est trop long'],
      index: true,
    },

    email: {
      type: String,
      required: [true, 'L’email est obligatoire'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [190, 'L’email est trop long'],
      match: [/^\S+@\S+\.\S+$/, 'Email invalide'],
    },

    password: {
      type: String,
      required: [true, 'Le mot de passe est obligatoire'],
      minlength: [6, 'Le mot de passe doit contenir au moins 6 caractères'],
      select: false,
    },

    role: {
      type: String,
      enum: {
        values: ALLOWED_ROLES,
        message: 'Rôle invalide',
      },
      default: 'client',
      index: true,
    },

    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: [40, 'Le téléphone est trop long'],
    },

    address: {
      type: String,
      default: '',
      trim: true,
      maxlength: [300, 'L’adresse est trop longue'],
    },

    profileImage: fileUrlField,

    // ISO country for the user's Stripe Connect payout account.
    countryCode: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
      match: [/^$|^[A-Z]{2}$/, 'Le code pays doit contenir deux lettres'],
    },

    // Stripe Customer ID for reusable customer-level payment operations.
    // This is separate from the connected account used for partner payouts.
    stripeCustomerId: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'Identifiant client Stripe invalide'],
    },

    stripeConnectAccountId: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'Identifiant Stripe Connect invalide'],
      index: { sparse: true },
    },
    stripeConnectDetailsSubmitted: { type: Boolean, default: false },
    stripeConnectTransfersEnabled: { type: Boolean, default: false },
    stripeConnectPayoutsEnabled: { type: Boolean, default: false },
    stripeConnectRequirementsDueCount: { type: Number, default: 0, min: 0 },

    pushToken: {
      type: String,
      default: '',
      trim: true,
      maxlength: [200, 'Push token invalide'],
    },

    accountStatus: {
      type: String,
      enum: {
        values: ALLOWED_ACCOUNT_STATUSES,
        message: 'Statut de compte invalide',
      },
      default: 'pending_verification',
      index: true,
    },

    isIdentityVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    isWorkAuthorized: {
      type: Boolean,
      default: false,
      index: true,
    },

    isAvailable: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    refreshToken: {
      type: String,
      default: '',
      select: false,
    },

    resetPasswordToken: {
      type: String,
      default: '',
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },

    verificationNotes: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'Les notes sont trop longues'],
    },

    documents: {
      identity: {
        frontUrl: fileUrlField,
        backUrl: fileUrlField,
        uploadedAt: {
          type: Date,
          default: null,
        },
      },

      workPermit: {
        url: fileUrlField,
        uploadedAt: {
          type: Date,
          default: null,
        },
      },
    },

    deliveryProfile: {
      vehicleType: {
        type: String,
        default: '',
        trim: true,
        maxlength: [50, 'Type de véhicule trop long'],
      },

      vehicleBrand: {
        type: String,
        default: '',
        trim: true,
        maxlength: [60, 'Marque véhicule trop longue'],
      },

      vehicleColor: {
        type: String,
        default: '',
        trim: true,
        maxlength: [40, 'Couleur véhicule trop longue'],
      },

      plateNumber: {
        type: String,
        default: '',
        trim: true,
        maxlength: [30, 'Plaque trop longue'],
      },

      currentLat: {
        type: Number,
        default: null,
        min: [-90, 'Latitude invalide'],
        max: [90, 'Latitude invalide'],
      },

      currentLng: {
        type: Number,
        default: null,
        min: [-180, 'Longitude invalide'],
        max: [180, 'Longitude invalide'],
      },

      lastLocationUpdateAt: {
        type: Date,
        default: null,
      },
    },

    restaurantProfile: {
      businessName: {
        type: String,
        default: '',
        trim: true,
        maxlength: [120, 'Nom business trop long'],
      },

      contactName: {
        type: String,
        default: '',
        trim: true,
        maxlength: [120, 'Nom contact trop long'],
      },
    },

    adminProfile: {
      permissions: {
        type: [String],
        default: [],
      },

      lastAdminActionAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ role: 1, accountStatus: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ isAvailable: 1, role: 1 });
userSchema.index({ isIdentityVerified: 1, isWorkAuthorized: 1 });

userSchema.pre('validate', function () {
  try {
    this.name = normalizeString(this.name);
    this.email = normalizeEmail(this.email);
    this.phone = normalizeString(this.phone);
    this.address = normalizeString(this.address);
    this.profileImage = normalizeString(this.profileImage);
    this.verificationNotes = normalizeString(this.verificationNotes);

    if (!this.name) {
      throw new Error('Le nom est obligatoire');
    }

    if (!this.email) {
      throw new Error('L’email est obligatoire');
    }

    if (!ALLOWED_ROLES.includes(this.role)) {
      throw new Error('Rôle invalide');
    }

    if (!ALLOWED_ACCOUNT_STATUSES.includes(this.accountStatus)) {
      throw new Error('Statut de compte invalide');
    }

    if (this.isModified('password') && !isStrongEnoughPassword(this.password)) {
      throw new Error('Le mot de passe doit contenir au moins 6 caractères');
    }

    if (this.role !== 'livreur') {
      this.isAvailable = false;
      if (this.deliveryProfile) {
        this.deliveryProfile.currentLat = null;
        this.deliveryProfile.currentLng = null;
        this.deliveryProfile.lastLocationUpdateAt = null;
      }
    }

    if (this.role !== 'admin' && this.adminProfile?.permissions?.length) {
      this.adminProfile.permissions = [];
      this.adminProfile.lastAdminActionAt = null;
    }

    return;
  } catch (error) {
    throw error;
  }
});

userSchema.pre('save', async function () {
  try {
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }

    this.name = normalizeString(this.name);
    this.email = normalizeEmail(this.email);
    this.phone = normalizeString(this.phone);
    this.address = normalizeString(this.address);
    this.profileImage = normalizeString(this.profileImage);
    this.verificationNotes = normalizeString(this.verificationNotes);

    if (this.documents?.identity) {
      this.documents.identity.frontUrl = normalizeString(
        this.documents.identity.frontUrl
      );
      this.documents.identity.backUrl = normalizeString(
        this.documents.identity.backUrl
      );
    }

    if (this.documents?.workPermit) {
      this.documents.workPermit.url = normalizeString(
        this.documents.workPermit.url
      );
    }

    if (this.deliveryProfile) {
      this.deliveryProfile.vehicleType = normalizeString(
        this.deliveryProfile.vehicleType
      );
      this.deliveryProfile.vehicleBrand = normalizeString(
        this.deliveryProfile.vehicleBrand
      );
      this.deliveryProfile.vehicleColor = normalizeString(
        this.deliveryProfile.vehicleColor
      );
      this.deliveryProfile.plateNumber = normalizeString(
        this.deliveryProfile.plateNumber
      );
    }

    if (this.restaurantProfile) {
      this.restaurantProfile.businessName = normalizeString(
        this.restaurantProfile.businessName
      );
      this.restaurantProfile.contactName = normalizeString(
        this.restaurantProfile.contactName
      );
    }

    return;
  } catch (error) {
    throw error;
  }
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(String(enteredPassword || ''), this.password);
};

userSchema.methods.generateResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.resetPasswordExpires = new Date(Date.now() + 1000 * 60 * 30);

  return resetToken;
};

userSchema.methods.clearResetPasswordToken = function () {
  this.resetPasswordToken = '';
  this.resetPasswordExpires = null;
};

userSchema.methods.updateLastLogin = function () {
  this.lastLoginAt = new Date();
};

userSchema.methods.updateDriverLocation = function ({ lat, lng }) {
  if (this.role !== 'livreur') {
    return;
  }

  if (!this.deliveryProfile) {
    this.deliveryProfile = {};
  }

  this.deliveryProfile.currentLat = lat;
  this.deliveryProfile.currentLng = lng;
  this.deliveryProfile.lastLocationUpdateAt = new Date();
};

userSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    id: this._id,
    name: this.name || '',
    email: this.email || '',
    role: this.role || 'client',
    phone: this.phone || '',
    address: this.address || '',
    profileImage: this.profileImage || '',
    accountStatus: this.accountStatus || 'pending_verification',
    isIdentityVerified: Boolean(this.isIdentityVerified),
    isWorkAuthorized: Boolean(this.isWorkAuthorized),
    isAvailable: Boolean(this.isAvailable),
    lastLoginAt: this.lastLoginAt || null,
    verificationNotes: this.verificationNotes || '',
    documents: {
      identity: {
        frontUrl: this.documents?.identity?.frontUrl || '',
        backUrl: this.documents?.identity?.backUrl || '',
        uploadedAt: this.documents?.identity?.uploadedAt || null,
      },
      workPermit: {
        url: this.documents?.workPermit?.url || '',
        uploadedAt: this.documents?.workPermit?.uploadedAt || null,
      },
    },
    deliveryProfile: {
      vehicleType: this.deliveryProfile?.vehicleType || '',
      vehicleBrand: this.deliveryProfile?.vehicleBrand || '',
      vehicleColor: this.deliveryProfile?.vehicleColor || '',
      plateNumber: this.deliveryProfile?.plateNumber || '',
      currentLat:
        typeof this.deliveryProfile?.currentLat === 'number'
          ? this.deliveryProfile.currentLat
          : null,
      currentLng:
        typeof this.deliveryProfile?.currentLng === 'number'
          ? this.deliveryProfile.currentLng
          : null,
      lastLocationUpdateAt:
        this.deliveryProfile?.lastLocationUpdateAt || null,
    },
    restaurantProfile: {
      businessName: this.restaurantProfile?.businessName || '',
      contactName: this.restaurantProfile?.contactName || '',
    },
    adminProfile: {
      permissions: Array.isArray(this.adminProfile?.permissions)
        ? this.adminProfile.permissions
        : [],
      lastAdminActionAt: this.adminProfile?.lastAdminActionAt || null,
    },
    createdAt: this.createdAt || null,
    updatedAt: this.updatedAt || null,
  };
};

module.exports = mongoose.model('User', userSchema);