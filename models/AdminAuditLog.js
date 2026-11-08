const mongoose = require('mongoose');

const normalizeTrim = (value) => String(value || '').trim();

const sanitizeMetadata = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'object') {
    return value;
  }

  return {
    value: String(value),
  };
};

const sanitizeTargetId = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
};

const adminAuditLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'L’admin est obligatoire'],
      index: true,
    },

    action: {
      type: String,
      required: [true, 'L’action est obligatoire'],
      trim: true,
      maxlength: [120, 'Le nom de l’action est trop long'],
      index: true,
    },

    targetType: {
      type: String,
      required: [true, 'Le type de cible est obligatoire'],
      enum: {
        values: ['user', 'restaurant', 'driver', 'order', 'system', 'other'],
        message: 'Type de cible invalide',
      },
      index: true,
    },

    targetId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },

    targetLabel: {
      type: String,
      default: '',
      trim: true,
      maxlength: [180, 'Le libellé cible est trop long'],
    },

    details: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'Les détails sont trop longs'],
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    ipAddress: {
      type: String,
      default: '',
      trim: true,
      maxlength: [100, 'IP trop longue'],
    },

    userAgent: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'User agent trop long'],
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ admin: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });
adminAuditLogSchema.index({ targetType: 1, createdAt: -1 });
adminAuditLogSchema.index({ targetId: 1, createdAt: -1 });
adminAuditLogSchema.index({ admin: 1, action: 1, createdAt: -1 });
adminAuditLogSchema.index({ targetType: 1, action: 1, createdAt: -1 });

adminAuditLogSchema.pre('validate', function () {
  try {
    this.action = normalizeTrim(this.action);
    this.targetType = normalizeTrim(this.targetType);
    this.targetLabel = normalizeTrim(this.targetLabel);
    this.details = normalizeTrim(this.details);
    this.ipAddress = normalizeTrim(this.ipAddress);
    this.userAgent = normalizeTrim(this.userAgent);
    this.targetId = sanitizeTargetId(this.targetId);
    this.metadata = sanitizeMetadata(this.metadata);

    if (!this.action) {
      throw new Error('L’action admin est obligatoire.');
    }

    if (!this.targetType) {
      throw new Error('Le type de cible est obligatoire.');
    }

    return;
  } catch (error) {
    throw error;
  }
});

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);