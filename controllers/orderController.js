const mongoose = require('mongoose');
const {
  normalizeIdempotencyKey,
  createOrderRequestFingerprint,
} = require('../utils/orderIdempotency');

const Order = require('../models/Order');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const {
  normalizeRequestedOrderItems,
  buildTrustedOrderItems,
  calculateRestaurantPricing,
} = require('../utils/orderPricing');

const { sendPushToUser } = require('../utils/pushNotifications');
const { evaluateDeliveryPayment } = require('../utils/orderGuards');
const { getMarketplaceRates } = require('../config/marketplaceRates');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');
const { sanitizeOrderForViewer } = require('../utils/orderResponseSanitizer');
const { evaluateCourierAssignmentEligibility } = require('../utils/courierAssignmentEligibility');
const { isConnectPayoutsEnabled } = require('../utils/marketplacePayouts');
const { createDeliveredOrderTransfers } = require('../utils/marketplacePayouts');
const { isProductionLocked } = require('../utils/runtimeEnvironment');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const allowedStatuses = [
  'En attente',
  'Confirmée',
  'En préparation',
  'En livraison',
  'Livrée',
  'Annulée',
];

const DELIVERY_FLOW_STATUSES = [
  'Confirmée',
  'En préparation',
  'En livraison',
  'Livrée',
];

const normalizeString = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const normalizeLowerString = (value, fallback = '') =>
  normalizeString(value, fallback).toLowerCase();

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBoolean = (value) => Boolean(value);

const roundMoney = (value) => Number(normalizeNumber(value, 0).toFixed(2));

const normalizeCoordinates = (value) => {
  const lat = normalizeNumber(value?.lat ?? value?.latitude, NaN);
  const lng = normalizeNumber(value?.lng ?? value?.longitude, NaN);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    updatedAt: new Date(),
  };
};

const toRad = (value) => (value * Math.PI) / 180;

const calculateDistanceKm = (from, to) => {
  const start = normalizeCoordinates(from);
  const end = normalizeCoordinates(to);

  if (!start || !end) {
    return null;
  }

  const earthRadiusKm = 6371;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(start.lat)) *
      Math.cos(toRad(end.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Number((earthRadiusKm * c).toFixed(2));
};

const calculateEtaMinutes = (distanceKm) => {
  const safeDistance = normalizeNumber(distanceKm, NaN);

  if (!Number.isFinite(safeDistance) || safeDistance < 0) {
    return null;
  }

  const averageSpeedKmH = 22;
  return Math.max(3, Math.ceil((safeDistance / averageSpeedKmH) * 60));
};

const buildEtaLabel = (etaMinutes) => {
  const safeEta = normalizeNumber(etaMinutes, NaN);

  if (!Number.isFinite(safeEta) || safeEta <= 0) {
    return '';
  }

  if (safeEta < 60) {
    return `${safeEta} min`;
  }

  const hours = Math.floor(safeEta / 60);
  const minutes = safeEta % 60;

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h${String(minutes).padStart(2, '0')}`;
};

const extractMenuItemId = (item) => {
  const raw =
    item?.menuItem?._id ||
    item?.menuItem?.id ||
    item?.menuItemId ||
    item?.productId ||
    item?.dishId ||
    item?.menuItem ||
    item?._id ||
    item?.id ||
    null;

  if (!raw) return null;
  return typeof raw === 'object' ? raw.toString?.() || null : raw;
};

const normalizeDeliveryAddress = (deliveryAddress) => {
  if (typeof deliveryAddress === 'string') {
    return normalizeString(deliveryAddress);
  }

  if (deliveryAddress && typeof deliveryAddress === 'object') {
    const parts = [
      deliveryAddress.label,
      deliveryAddress.street,
      deliveryAddress.address,
      deliveryAddress.addressLine1,
      deliveryAddress.addressLine2,
      deliveryAddress.city,
      deliveryAddress.postalCode,
      deliveryAddress.zipCode,
      deliveryAddress.country,
    ]
      .map((part) => normalizeString(part))
      .filter(Boolean);

    return normalizeString(parts.join(', '));
  }

  return '';
};

const normalizeItems = (items = []) => {
  const safeItems = Array.isArray(items) ? items : [];

  return safeItems.map((item) => ({
    menuItem: extractMenuItemId(item),
    name: normalizeString(item?.name || item?.title || item?.menuItem?.name),
    quantity: normalizeNumber(item?.quantity, 0),
    price: roundMoney(item?.price ?? item?.unitPrice ?? item?.menuItem?.price),
    image: normalizeString(item?.image || item?.menuItem?.image),
    notes: normalizeString(item?.notes || item?.specialInstructions),
  }));
};

const populateOrder = (query) => {
  return query
    .populate('user', 'name email role phone address accountStatus')
    .populate(
      'restaurant',
      'name image coverImage cuisine owner address city country latitude longitude location'
    )
    .populate(
      'deliveryPerson',
      [
        'name',
        'email',
        'role',
        'phone',
        'accountStatus',
        'isAvailable',
        'deliveryProfile.vehicleType',
        'deliveryProfile.vehicleBrand',
        'deliveryProfile.vehicleColor',
        'deliveryProfile.plateNumber',
        'deliveryProfile.currentLat',
        'deliveryProfile.currentLng',
        'deliveryProfile.lastLocationUpdateAt',
      ].join(' ')
    );
};

const pushStatusHistoryEntry = (order, { status, updatedBy, updatedByRole, note = '' }) => {
  if (!order) return;

  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }

  const normalizedStatus = normalizeString(status);
  if (!normalizedStatus) return;

  const lastEntry = order.statusHistory[order.statusHistory.length - 1];
  const lastStatus = normalizeString(lastEntry?.status);

  if (lastStatus === normalizedStatus && !normalizeString(note)) {
    return;
  }

  order.statusHistory.push({
    status: normalizedStatus,
    updatedBy: updatedBy || null,
    updatedByRole: normalizeString(updatedByRole),
    note: normalizeString(note),
    at: new Date(),
  });
};

const syncTrackingLocations = (order, driverLocationInput = null) => {
  if (!order) return;

  const safeDriverLocation = driverLocationInput
    ? normalizeCoordinates(driverLocationInput)
    : normalizeCoordinates(order.driverLocation) ||
      normalizeCoordinates(order.deliveryLocation);

  if (!safeDriverLocation) {
    return;
  }

  order.driverLocation = {
    lat: safeDriverLocation.lat,
    lng: safeDriverLocation.lng,
    updatedAt: safeDriverLocation.updatedAt || new Date(),
  };

  order.deliveryLocation = {
    latitude: safeDriverLocation.lat,
    longitude: safeDriverLocation.lng,
    updatedAt: safeDriverLocation.updatedAt || new Date(),
  };

  order.lastTrackingEventAt =
    safeDriverLocation.updatedAt || order.lastTrackingEventAt || new Date();
};

const buildOrderTrackingPayload = (order) => {
  if (!order) {
    return null;
  }

  const customerLocation = normalizeCoordinates(order?.customerLocation);
  const driverLocation =
    normalizeCoordinates(order?.driverLocation) ||
    normalizeCoordinates(order?.deliveryLocation);
  const restaurantLocation = normalizeCoordinates(order?.restaurantLocation);

  let distanceKm = null;
  let etaMinutes = null;
  let estimatedDeliveryTime = '';

  if (driverLocation && customerLocation) {
    distanceKm = calculateDistanceKm(driverLocation, customerLocation);
    etaMinutes = calculateEtaMinutes(distanceKm);
    estimatedDeliveryTime = buildEtaLabel(etaMinutes);
  }

  return {
    trackingEnabled: normalizeBoolean(order?.status === 'En livraison'),
    status: normalizeString(order?.status, 'En attente'),
    customerLocation,
    driverLocation,
    restaurantLocation,
    distanceKm,
    etaMinutes,
    estimatedDeliveryTime,
    lastLocationUpdateAt:
      driverLocation?.updatedAt ||
      order?.driverLocation?.updatedAt ||
      order?.deliveryLocation?.updatedAt ||
      order?.updatedAt ||
      null,
  };
};

const sanitizeOrderForResponse = (orderDocument, viewerRole = '') => {
  if (!orderDocument) {
    return null;
  }

  const rawOrder =
    typeof orderDocument.toObject === 'function'
      ? orderDocument.toObject({ virtuals: true })
      : { ...orderDocument };
  const order = sanitizeOrderForViewer(rawOrder, viewerRole);
  const tracking = buildOrderTrackingPayload(order);
  const financials = {
    totalPrice: roundMoney(order?.totalPrice),
    deliveryFee: roundMoney(order?.deliveryFee),
    donationAmount: roundMoney(order?.donationAmount),
    currency: normalizeString(order?.currency, 'EUR'),
  };
  const role = String(viewerRole || '').trim().toLowerCase();

  if (role === 'admin') {
    financials.platformCommissionAmount = roundMoney(order?.platformCommissionAmount);
    financials.restaurantEarning = roundMoney(order?.restaurantEarning);
    financials.driverEarning = roundMoney(order?.driverEarning);
    financials.platformDeliveryEarning = roundMoney(order?.platformDeliveryEarning);
  } else if (role === 'restaurant') {
    financials.platformCommissionAmount = roundMoney(order?.platformCommissionAmount);
    financials.restaurantEarning = roundMoney(order?.restaurantEarning);
  } else if (role === 'livreur') {
    financials.driverEarning = roundMoney(order?.driverEarning);
  }

  return {
    ...order,
    tracking,
    customerLocation: tracking?.customerLocation || order?.customerLocation || null,
    driverLocation: tracking?.driverLocation || order?.driverLocation || null,
    restaurantLocation:
      tracking?.restaurantLocation || order?.restaurantLocation || null,
    deliveryLocation: order?.deliveryLocation || null,
    distanceKm: tracking?.distanceKm ?? null,
    etaMinutes: tracking?.etaMinutes ?? null,
    estimatedDeliveryTime: tracking?.estimatedDeliveryTime || '',
    trackingEnabled: tracking?.trackingEnabled || false,
    financials,
  };
};

const sanitizeOrdersForResponse = (orders = [], viewerRole = '') => {
  const safeOrders = Array.isArray(orders) ? orders : [];
  return safeOrders.map((order) => sanitizeOrderForResponse(order, viewerRole)).filter(Boolean);
};

const canTransitionStatus = (currentStatus, nextStatus, role) => {
  if (role === 'admin') return true;

  if (currentStatus === 'Livrée' || currentStatus === 'Annulée') {
    return false;
  }

  if (role === 'client') {
    return nextStatus === 'Annulée' && currentStatus === 'En attente';
  }

  if (role === 'restaurant') {
    if (currentStatus === 'En attente' && nextStatus === 'Confirmée') return true;
    if (currentStatus === 'Confirmée' && nextStatus === 'En préparation') return true;

    if (
      ['En attente', 'Confirmée', 'En préparation'].includes(currentStatus) &&
      nextStatus === 'Annulée'
    ) {
      return true;
    }

    return false;
  }

  if (role === 'livreur') {
    if (
      (currentStatus === 'Confirmée' || currentStatus === 'En préparation') &&
      nextStatus === 'En livraison'
    ) {
      return true;
    }

    if (currentStatus === 'En livraison' && nextStatus === 'Livrée') {
      return true;
    }

    return false;
  }

  return false;
};

const canAccessOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const order = await Order.findById(id).populate('restaurant', 'owner');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isClientOwner =
      order.user && order.user.toString() === req.user._id.toString();
    const isDeliveryPerson =
      order.deliveryPerson &&
      order.deliveryPerson.toString() === req.user._id.toString();
    const isRestaurantOwner =
      req.user.role === 'restaurant' &&
      order.restaurant &&
      order.restaurant.owner &&
      order.restaurant.owner.toString() === req.user._id.toString();

    if (!isAdmin && !isClientOwner && !isDeliveryPerson && !isRestaurantOwner) {
      return res.status(403).json({
        success: false,
        message: 'Vous n’avez pas accès à cette commande.',
      });
    }

    req.order = order;
    return next();
  } catch (error) {
    console.error('CAN ACCESS ORDER ERROR =>', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const filter = {};
    const requestedStatus = normalizeString(req.query?.status);
    const requestedPaymentStatus = normalizeString(req.query?.paymentStatus);

    if (requestedStatus && allowedStatuses.includes(requestedStatus)) {
      filter.status = requestedStatus;
    }

    if (
      requestedPaymentStatus &&
      allowedPaymentStatuses.includes(requestedPaymentStatus)
    ) {
      filter.paymentStatus = requestedPaymentStatus;
    }

    if (req.user.role === 'client') {
      filter.user = req.user._id;
    } else if (req.user.role === 'livreur') {
      filter.deliveryPerson = req.user._id;
    } else if (req.user.role === 'restaurant') {
      const restaurants = await Restaurant.find({ owner: req.user._id }).select('_id');
      const restaurantIds = restaurants.map((restaurant) => restaurant._id);
      filter.restaurant = { $in: restaurantIds };
    }

    const orders = await populateOrder(Order.find(filter).sort({ createdAt: -1 }));
    const safeOrders = sanitizeOrdersForResponse(orders, req.user?.role);

    return res.status(200).json({
      success: true,
      count: safeOrders.length,
      orders: safeOrders,
    });
  } catch (error) {
    console.error('Erreur récupération commandes :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getOrdersByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID utilisateur invalide.',
      });
    }

    const orders = await populateOrder(
      Order.find({ user: userId }).sort({ createdAt: -1 })
    );

    const safeOrders = sanitizeOrdersForResponse(orders, req.user?.role);

    return res.status(200).json({
      success: true,
      count: safeOrders.length,
      orders: safeOrders,
    });
  } catch (error) {
    console.error('Erreur récupération commandes utilisateur :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getOrdersByRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;

    if (!isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: 'ID restaurant invalide.',
      });
    }

    const restaurant = await Restaurant.findById(restaurantId).select(
      '_id owner latitude longitude location address city country'
    );

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant introuvable.',
      });
    }

    if (
      req.user.role === 'restaurant' &&
      restaurant.owner &&
      restaurant.owner.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Vous n’avez pas accès aux commandes de ce restaurant.',
      });
    }

    const orders = await populateOrder(
      Order.find({ restaurant: restaurantId }).sort({ createdAt: -1 })
    );

    const safeOrders = sanitizeOrdersForResponse(orders, req.user?.role);

    return res.status(200).json({
      success: true,
      count: safeOrders.length,
      orders: safeOrders,
    });
  } catch (error) {
    console.error('Erreur récupération commandes restaurant :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await populateOrder(Order.findById(req.order._id));
    const safeOrder = sanitizeOrderForResponse(order, req.user?.role);

    return res.status(200).json({
      success: true,
      order: safeOrder,
    });
  } catch (error) {
    console.error('Erreur récupération commande :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const createOrder = async (req, res) => {
  let orderUser = null;
  let idempotencyKey = null;
  let requestFingerprint = null;

  const respondWithExistingOrder = async (existingOrder) => {
    if (!existingOrder) return false;

    if (!requestFingerprint || existingOrder.requestFingerprint !== requestFingerprint) {
      res.status(409).json({
        success: false,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Cette clé a déjà été utilisée pour une autre commande. Relance avec une nouvelle clé.',
      });
      return true;
    }

    const populatedOrder = await populateOrder(Order.findById(existingOrder._id));
    res.status(200).json({
      success: true,
      duplicate: true,
      message: 'Cette commande avait déjà été enregistrée.',
      order: sanitizeOrderForResponse(populatedOrder, req.user?.role),
    });
    return true;
  };

  try {
    const {
      user,
      restaurant,
      items,
      deliveryAddress,
      notes,
      customerLocation,
      donationAmount,
    } = req.body || {};

    orderUser = req.user.role === 'client' ? req.user._id : user;

    if (!orderUser || !restaurant || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ORDER_REQUEST',
        message: 'Les champs user, restaurant et items sont obligatoires.',
      });
    }

    if (!isValidObjectId(orderUser)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_USER_ID',
        message: 'ID utilisateur invalide.',
      });
    }

    if (!isValidObjectId(restaurant)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_RESTAURANT_ID',
        message: 'ID restaurant invalide.',
      });
    }

    const safeDeliveryAddress = normalizeDeliveryAddress(deliveryAddress);
    if (!safeDeliveryAddress) {
      return res.status(400).json({
        success: false,
        code: 'DELIVERY_ADDRESS_REQUIRED',
        message: 'Le champ deliveryAddress est obligatoire.',
      });
    }

    const keyResult = normalizeIdempotencyKey(
      req.get?.('Idempotency-Key') || req.body?.idempotencyKey
    );
    if (!keyResult.ok) {
      return res.status(400).json({
        success: false,
        code: keyResult.code,
        message: keyResult.message,
      });
    }
    idempotencyKey = keyResult.key;

    const requestedResult = normalizeRequestedOrderItems(items, isValidObjectId);
    if (!requestedResult.ok) {
      return res.status(400).json({
        success: false,
        code: requestedResult.code,
        message: requestedResult.message,
      });
    }

    const safeNotes = normalizeString(notes).slice(0, 500);
    if (idempotencyKey) {
      requestFingerprint = createOrderRequestFingerprint({
        restaurant: String(restaurant),
        items: requestedResult.items,
        deliveryAddress: safeDeliveryAddress,
        notes: safeNotes,
      });

      const previousOrder = await Order.findOne({ user: orderUser, idempotencyKey });
      if (previousOrder) {
        await respondWithExistingOrder(previousOrder);
        return;
      }
    }

    const restaurantExists = await Restaurant.findById(restaurant).select(
      '_id owner latitude longitude location address city country currency deliveryFee minimumOrderAmount isActive isOpen'
    );

    if (!restaurantExists) {
      return res.status(404).json({
        success: false,
        code: 'RESTAURANT_NOT_FOUND',
        message: 'Restaurant introuvable.',
      });
    }

    if (restaurantExists.isActive === false) {
      return res.status(409).json({
        success: false,
        code: 'RESTAURANT_INACTIVE',
        message: 'Ce restaurant ne prend pas de commandes pour le moment.',
      });
    }

    if (restaurantExists.isOpen === false) {
      return res.status(409).json({
        success: false,
        code: 'RESTAURANT_CLOSED',
        message: 'Ce restaurant est actuellement fermé.',
      });
    }

    // This repository snapshot is not cleared for marketplace production:
    // no verified payout corridor or cash-collection ledger is enabled.
    if (isProductionLocked()) {
      return res.status(503).json({
        success: false,
        code: 'MARKETPLACE_COMMERCE_NOT_READY',
        message: 'La prise de commandes sera activée après validation des paiements marketplace et des versements partenaires.',
      });
    }

    const requestedDonation =
      donationAmount === undefined || donationAmount === null ? 0 : Number(donationAmount);

    if (!Number.isFinite(requestedDonation) || requestedDonation < 0 || requestedDonation > 100) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DONATION_AMOUNT',
        message: 'Le montant du don est invalide.',
      });
    }

    // Donations stay unavailable until a beneficiary, accounting and settlement
    // flow is configured and publicly disclosed.
    if (requestedDonation > 0) {
      return res.status(409).json({
        success: false,
        code: 'DONATIONS_NOT_CONFIGURED',
        message: 'Les dons Afroeat Impact sont temporairement indisponibles.',
      });
    }

    const menuItems = await MenuItem.find({
      _id: { $in: requestedResult.menuItemIds },
      restaurant: restaurantExists._id,
      available: { $ne: false },
    })
      .select('_id restaurant name price image available')
      .lean();

    const trustedItemsResult = buildTrustedOrderItems({
      requestedItems: requestedResult.items,
      menuItems,
      restaurantId: restaurantExists._id,
    });

    if (!trustedItemsResult.ok) {
      const statusCode = trustedItemsResult.code === 'MENU_ITEM_UNAVAILABLE' ? 409 : 400;
      return res.status(statusCode).json({
        success: false,
        code: trustedItemsResult.code,
        message: trustedItemsResult.message,
      });
    }

    const pricing = calculateRestaurantPricing({
      items: trustedItemsResult.items,
      restaurant: restaurantExists,
    });

    if (!pricing.ok) {
      return res.status(pricing.code === 'MINIMUM_ORDER_NOT_MET' ? 409 : 400).json({
        success: false,
        code: pricing.code,
        message: pricing.message,
        ...(pricing.subtotal !== undefined ? { subtotal: pricing.subtotal } : {}),
        ...(pricing.minimumOrderAmount !== undefined
          ? { minimumOrderAmount: pricing.minimumOrderAmount }
          : {}),
        ...(pricing.currency ? { currency: pricing.currency } : {}),
      });
    }

    let marketplaceRates;
    try {
      marketplaceRates = getMarketplaceRates(pricing.currency);
    } catch (configurationError) {
      console.error('AFROEAT MARKETPLACE RATE CONFIG ERROR =>', configurationError?.message);
      return res.status(503).json({
        success: false,
        code: 'MARKETPLACE_RATES_UNAVAILABLE',
        message: 'Les taux de répartition des paiements ne sont pas configurés correctement.',
      });
    }

    if (isConnectPayoutsEnabled() && !marketplaceRates) {
      return res.status(503).json({
        success: false,
        code: 'MARKETPLACE_RATES_UNAVAILABLE',
        message: 'Les taux de répartition ne sont pas configurés pour cette devise.',
      });
    }

    const marketplaceSplit = calculateMarketplaceSplit({
      itemsSubtotal: pricing.subtotal,
      deliveryFee: pricing.deliveryFee,
      rates: marketplaceRates,
    });

    const safeCustomerLocation = normalizeCoordinates(customerLocation);
    const safeRestaurantLocation = normalizeCoordinates({
      lat: restaurantExists?.location?.latitude ?? restaurantExists?.latitude,
      lng: restaurantExists?.location?.longitude ?? restaurantExists?.longitude,
    });

    // Client-supplied status, payment state, currency, item prices, delivery
    // fees and courier earnings are deliberately ignored.
    const initialStatus = 'En attente';
    const newOrder = new Order({
      user: orderUser,
      restaurant: restaurantExists._id,
      items: trustedItemsResult.items,
      totalPrice: pricing.totalPrice,
      currency: pricing.currency,
      deliveryAddress: safeDeliveryAddress,
      status: initialStatus,
      paymentStatus: 'Non payé',
      paymentMethod: null,
      deliveryPerson: null,
      notes: safeNotes,
      customerLocation: safeCustomerLocation,
      restaurantLocation: safeRestaurantLocation,
      deliveryFee: pricing.deliveryFee,
      donationAmount: 0,
      driverEarning: marketplaceSplit.driverEarning,
      marketplaceSplitCalculated: true,
      commissionRateBps: marketplaceSplit.commissionRateBps,
      courierPayoutRateBps: marketplaceSplit.courierPayoutRateBps,
      platformCommissionAmount: marketplaceSplit.platformCommissionAmount,
      restaurantEarning: marketplaceSplit.restaurantEarning,
      platformDeliveryEarning: marketplaceSplit.platformDeliveryEarning,
      ...(idempotencyKey ? { idempotencyKey, requestFingerprint } : {}),
      statusHistory: [
        {
          status: initialStatus,
          updatedBy: req.user?._id || null,
          updatedByRole: req.user?.role || '',
          note: 'Création de commande',
          at: new Date(),
        },
      ],
    });

    let savedOrder;
    try {
      savedOrder = await newOrder.save();
    } catch (error) {
      // Concurrent retries can pass the first lookup together; the compound
      // unique index makes only one insert win and the loser returns that order.
      if (idempotencyKey && error?.code === 11000) {
        const existingOrder = await Order.findOne({ user: orderUser, idempotencyKey });
        if (existingOrder) {
          await respondWithExistingOrder(existingOrder);
          return;
        }
      }
      throw error;
    }

    const populatedOrder = await populateOrder(Order.findById(savedOrder._id));
    const safeOrder = sanitizeOrderForResponse(populatedOrder, req.user?.role);

    return res.status(201).json({
      success: true,
      message: 'Commande créée avec les prix et disponibilités confirmés par le serveur.',
      order: safeOrder,
    });
  } catch (error) {
    console.error('Erreur création commande :', {
      message: error.message,
      stack: error.stack,
      userId: req.user?._id || null,
      restaurant: req.body?.restaurant || null,
      itemsCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
    });

    return res.status(500).json({
      success: false,
      code: 'ORDER_CREATION_FAILED',
      message: 'Impossible de créer la commande. Réessaie plus tard.',
    });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const nextStatus = normalizeString(req.body?.status);
    const note = normalizeString(req.body?.note);

    if (!nextStatus || !allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide.',
      });
    }

    if (!canTransitionStatus(req.order.status, nextStatus, req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Transition de statut non autorisée.',
      });
    }

    const order = await Order.findById(req.order._id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    const deliveryPayment = evaluateDeliveryPayment({
      nextStatus,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
    });

    if (!deliveryPayment.allowed) {
      return res.status(409).json({
        success: false,
        code: deliveryPayment.code,
        message: deliveryPayment.message,
      });
    }

    order.status = nextStatus;

    if (deliveryPayment.cashPaymentCollected) {
      order.paymentStatus = 'Payé';
      order.paidAt = new Date();
    }

    if (nextStatus === 'En livraison') {
      if (!order.deliveryStartedAt) {
        order.deliveryStartedAt = new Date();
      }
      if (!order.pickedUpAt) {
        order.pickedUpAt = new Date();
      }
    }

    if (nextStatus === 'Livrée') {
      if (!order.deliveredAt) {
        order.deliveredAt = new Date();
      }
      if (!order.completedAt) {
        order.completedAt = new Date();
      }
    }

    pushStatusHistoryEntry(order, {
      status: nextStatus,
      updatedBy: req.user?._id || null,
      updatedByRole: req.user?.role || '',
      note: deliveryPayment.cashPaymentCollected
        ? normalizeString(note, 'Paiement à la livraison perçu')
        : note,
    });

    await order.save();

    if (nextStatus === 'Livrée') {
      try {
        await createDeliveredOrderTransfers(order._id);
      } catch (payoutError) {
        // Delivery remains saved; payout reconciliation is retried through admin endpoints.
        console.error('AFROEAT PAYOUT RECONCILIATION ERROR =>', payoutError?.message);
      }
    }

    sendPushToUser(order.user, {
      title: 'Afroeat',
      body: `Ta commande est maintenant "${nextStatus}".`,
      data: {
        orderId: String(order._id),
        type: 'order_status',
        status: nextStatus,
      },
    }).catch(() => {});

    const updatedOrder = await populateOrder(Order.findById(order._id));
    const safeOrder = sanitizeOrderForResponse(updatedOrder, req.user?.role);

    return res.status(200).json({
      success: true,
      message: 'Statut de commande mis à jour avec succès.',
      order: safeOrder,
    });
  } catch (error) {
    console.error('Erreur mise à jour statut commande :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const assignDriverToOrder = async (req, res) => {
  try {
    const { deliveryPerson } = req.body;

    if (!deliveryPerson || !isValidObjectId(deliveryPerson)) {
      return res.status(400).json({
        success: false,
        message: 'ID livreur invalide.',
      });
    }

    if (['Livrée', 'Annulée'].includes(req.order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Impossible d’assigner un livreur à cette commande.',
      });
    }

    const courier = await User.findById(deliveryPerson).select(
      '_id role accountStatus isIdentityVerified isWorkAuthorized isAvailable name'
    );

    const courierEligibility = evaluateCourierAssignmentEligibility(courier);
    if (!courierEligibility.ok) {
      return res.status(courierEligibility.status).json({
        success: false,
        code: courierEligibility.code,
        message: courierEligibility.message,
      });
    }

    const order = await Order.findById(req.order._id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    order.deliveryPerson = courier._id;

    pushStatusHistoryEntry(order, {
      status: order.status,
      updatedBy: req.user?._id || null,
      updatedByRole: req.user?.role || '',
      note: `Livreur assigné: ${courier.name || courier._id}`,
    });

    await order.save();

    sendPushToUser(courier._id, {
      title: 'Afroeat',
      body: 'Une nouvelle course vient de t’être assignée.',
      data: {
        orderId: String(order._id),
        type: 'order_assigned',
      },
    }).catch(() => {});

    const updatedOrder = await populateOrder(Order.findById(order._id));
    const safeOrder = sanitizeOrderForResponse(updatedOrder, req.user?.role);

    return res.status(200).json({
      success: true,
      message: 'Livreur assigné avec succès.',
      order: safeOrder,
    });
  } catch (error) {
    console.error('Erreur assignation livreur :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getOrderTracking = async (req, res) => {
  try {
    const order = await populateOrder(Order.findById(req.order._id));
    const safeOrder = sanitizeOrderForResponse(order, req.user?.role);

    return res.status(200).json({
      success: true,
      tracking: safeOrder?.tracking || null,
      order: safeOrder,
    });
  } catch (error) {
    console.error('Erreur récupération tracking commande :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const updateDriverLocation = async (req, res) => {
  try {
    if (!req.order?._id) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isAssignedDriver =
      req.user.role === 'livreur' &&
      req.order.deliveryPerson &&
      req.order.deliveryPerson.toString() === req.user._id.toString();

    if (!isAdmin && !isAssignedDriver) {
      return res.status(403).json({
        success: false,
        message: 'Seul le livreur assigné peut mettre à jour sa position.',
      });
    }

    if (!DELIVERY_FLOW_STATUSES.includes(req.order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Le tracking GPS n’est pas disponible pour ce statut de commande.',
      });
    }

    const rawCoordinates = req.body?.driverLocation || req.body;
    const safeDriverLocation = normalizeCoordinates(rawCoordinates);

    if (!safeDriverLocation) {
      return res.status(400).json({
        success: false,
        message: 'Coordonnées GPS invalides.',
      });
    }

    const order = await Order.findById(req.order._id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    syncTrackingLocations(order, safeDriverLocation);
    pushStatusHistoryEntry(order, {
      status: order.status,
      updatedBy: req.user?._id || null,
      updatedByRole: req.user?.role || '',
      note: 'Position GPS mise à jour',
    });

    await order.save();

    const updatedOrder = await populateOrder(Order.findById(order._id));
    const safeOrder = sanitizeOrderForResponse(updatedOrder, req.user?.role);

    return res.status(200).json({
      success: true,
      message: 'Position livreur mise à jour avec succès.',
      order: safeOrder,
      tracking: safeOrder?.tracking || null,
    });
  } catch (error) {
    console.error('Erreur update position livreur :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const deletedOrder = await Order.findByIdAndDelete(id);

    if (!deletedOrder) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Commande supprimée avec succès.',
    });
  } catch (error) {
    console.error('Erreur suppression commande :', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

module.exports = {
  canAccessOrder,
  getOrders,
  getOrdersByUser,
  getOrdersByRestaurant,
  getOrderById,
  createOrder,
  updateOrderStatus,
  assignDriverToOrder,
  getOrderTracking,
  updateDriverLocation,
  deleteOrder,
};