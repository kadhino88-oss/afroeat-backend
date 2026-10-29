const mongoose = require('mongoose');

const Order = require('../models/Order');
const User = require('../models/User');
const { sendPushToUser } = require('../utils/pushNotifications');
const { evaluateDeliveryPayment } = require('../utils/orderGuards');
const { createDeliveredOrderTransfers } = require('../utils/marketplacePayouts');
const { sanitizeOrderForViewer } = require('../utils/orderResponseSanitizer');
const { evaluateCourierAvailabilityChange } = require('../utils/courierAssignmentEligibility');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const normalizeString = (value) => String(value || '').trim();
const normalizeLowerString = (value) => normalizeString(value).toLowerCase();

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) =>
  Number(normalizeNumber(value, 0).toFixed(2));

const DELIVERY_VISIBLE_STATUSES = [
  'Confirmée',
  'En préparation',
  'En livraison',
  'Livrée',
];

const DELIVERY_ACTIVE_STATUSES = ['En préparation', 'En livraison'];

const DRIVER_ALLOWED_STATUS_UPDATES = ['En livraison', 'Livrée'];

const populateOrder = (query) =>
  query
    .populate('user', 'name email phone address role')
    .populate('restaurant', 'name cuisine address city country owner')
    .populate(
      'deliveryPerson',
      [
        'name',
        'email',
        'phone',
        'role',
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

const hasSchemaPath = (document, path) => {
  return Boolean(document?.schema?.path(path));
};

const setIfSchemaPathExists = (document, path, value) => {
  if (!document || !hasSchemaPath(document, path)) {
    return;
  }

  document.set(path, value);
};

const pushStatusHistoryIfSupported = (order, nextStatus, actor) => {
  if (!order || !hasSchemaPath(order, 'statusHistory')) {
    return;
  }

  const currentHistory = Array.isArray(order.statusHistory)
    ? order.statusHistory
    : [];

  currentHistory.push({
    status: nextStatus,
    updatedBy: actor?._id || null,
    updatedByRole: actor?.role || 'livreur',
    at: new Date(),
    note: actor?.note || '',
  });

  order.statusHistory = currentHistory;
};

const inferOrderAmount = (orderLike) => {
  const order = orderLike?.toObject ? orderLike.toObject() : orderLike || {};

  const candidates = [
    order.totalAmount,
    order.totalPrice,
    order.total,
    order.amount,
    order.pricing?.total,
    order.pricing?.grandTotal,
    order.totals?.total,
    order.summary?.total,
  ];

  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return roundMoney(parsed);
    }
  }

  return 0;
};

const inferDriverEarningFromOrder = (orderLike) => {
  const order = orderLike?.toObject ? orderLike.toObject() : orderLike || {};

  const directCandidates = [
    order.driverEarning,
    order.driverFee,
    order.deliveryEarning,
    order.deliveryFee,
    order.pricing?.driverEarning,
    order.pricing?.deliveryFee,
    order.pricing?.driverFee,
    order.totals?.driverEarning,
    order.totals?.deliveryFee,
    order.summary?.driverEarning,
  ];

  for (const value of directCandidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return roundMoney(parsed);
    }
  }

  const total = inferOrderAmount(order);
  if (!total) {
    return 0;
  }

  return roundMoney(total * 0.1);
};

const computeEtaLabel = (order) => {
  const safeOrder = order?.toObject ? order.toObject() : order || {};
  const status = normalizeString(safeOrder?.status);

  if (status !== 'En livraison') {
    return null;
  }

  const updatedAt = safeOrder?.deliveryLocation?.updatedAt
    ? new Date(safeOrder.deliveryLocation.updatedAt)
    : null;

  if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
    return 'Calcul ETA en attente';
  }

  const elapsedMinutes = Math.max(
    0,
    Math.round((Date.now() - updatedAt.getTime()) / (1000 * 60))
  );

  const remainingMinutes = Math.max(5, 28 - elapsedMinutes);

  return `${remainingMinutes} min estimées`;
};

const buildOrderLiveMeta = (order) => {
  const rawOrder = order?.toObject ? order.toObject() : order || {};
  const safeOrder = sanitizeOrderForViewer(rawOrder, 'livreur');

  const driverLocation = safeOrder?.deliveryLocation
    ? {
        lat:
          typeof safeOrder.deliveryLocation.latitude === 'number'
            ? safeOrder.deliveryLocation.latitude
            : null,
        lng:
          typeof safeOrder.deliveryLocation.longitude === 'number'
            ? safeOrder.deliveryLocation.longitude
            : null,
        updatedAt: safeOrder.deliveryLocation.updatedAt || null,
      }
    : {
        lat: null,
        lng: null,
        updatedAt: null,
      };

  return {
    ...safeOrder,
    driverLocation,
    isActiveMission: DELIVERY_ACTIVE_STATUSES.includes(
      normalizeString(safeOrder?.status)
    ),
    estimatedDeliveryTime: computeEtaLabel(safeOrder),
    financials: {
      orderAmount: inferOrderAmount(safeOrder),
      driverEarning: inferDriverEarningFromOrder(safeOrder),
    },
  };
};

const buildDriverProfileResponse = (driver) => {
  const safeDriver = driver?.toObject ? driver.toObject() : driver || {};

  return {
    _id: safeDriver._id,
    id: safeDriver._id,
    name: safeDriver.name || '',
    email: safeDriver.email || '',
    phone: safeDriver.phone || '',
    address: safeDriver.address || '',
    role: safeDriver.role || 'livreur',
    accountStatus: safeDriver.accountStatus || 'pending_verification',
    isIdentityVerified: Boolean(safeDriver.isIdentityVerified),
    isWorkAuthorized: Boolean(safeDriver.isWorkAuthorized),
    isAvailable: Boolean(safeDriver.isAvailable),
    deliveryProfile: {
      vehicleType: safeDriver.deliveryProfile?.vehicleType || '',
      vehicleBrand: safeDriver.deliveryProfile?.vehicleBrand || '',
      vehicleColor: safeDriver.deliveryProfile?.vehicleColor || '',
      plateNumber: safeDriver.deliveryProfile?.plateNumber || '',
      currentLat:
        typeof safeDriver.deliveryProfile?.currentLat === 'number'
          ? safeDriver.deliveryProfile.currentLat
          : null,
      currentLng:
        typeof safeDriver.deliveryProfile?.currentLng === 'number'
          ? safeDriver.deliveryProfile.currentLng
          : null,
      lastLocationUpdateAt:
        safeDriver.deliveryProfile?.lastLocationUpdateAt || null,
    },
    createdAt: safeDriver.createdAt || null,
    updatedAt: safeDriver.updatedAt || null,
  };
};

const ensureDriverAccount = async (userId, options = {}) => {
  if (!isValidObjectId(userId)) {
    return null;
  }

  const { mustBeActive = true } = options;

  const driver = await User.findById(userId).select(
    [
      '_id',
      'name',
      'email',
      'phone',
      'address',
      'role',
      'accountStatus',
      'isIdentityVerified',
      'isWorkAuthorized',
      'isAvailable',
      'deliveryProfile.vehicleType',
      'deliveryProfile.vehicleBrand',
      'deliveryProfile.vehicleColor',
      'deliveryProfile.plateNumber',
      'deliveryProfile.currentLat',
      'deliveryProfile.currentLng',
      'deliveryProfile.lastLocationUpdateAt',
      'createdAt',
      'updatedAt',
    ].join(' ')
  );

  if (!driver) return null;
  if (normalizeLowerString(driver.role) !== 'livreur') return null;

  if (
    mustBeActive &&
    normalizeLowerString(driver.accountStatus) !== 'active'
  ) {
    return null;
  }

  return driver;
};

const findDriverCurrentOrder = async (driverId) => {
  const currentOrder =
    (await populateOrder(
      Order.findOne({
        deliveryPerson: driverId,
        status: 'En livraison',
      }).sort({ updatedAt: -1, createdAt: -1 })
    )) ||
    (await populateOrder(
      Order.findOne({
        deliveryPerson: driverId,
        status: 'En préparation',
      }).sort({ updatedAt: -1, createdAt: -1 })
    )) ||
    null;

  return currentOrder;
};

const validateCoordinates = (lat, lng) => {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return 'Latitude invalide.';
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return 'Longitude invalide.';
  }

  return '';
};

const canDriverMoveOrderToStatus = (currentStatus, nextStatus) => {
  const normalizedCurrent = normalizeString(currentStatus);
  const normalizedNext = normalizeString(nextStatus);

  if (!DRIVER_ALLOWED_STATUS_UPDATES.includes(normalizedNext)) {
    return false;
  }

  if (
    (normalizedCurrent === 'Confirmée' ||
      normalizedCurrent === 'En préparation') &&
    normalizedNext === 'En livraison'
  ) {
    return true;
  }

  if (
    normalizedCurrent === 'En livraison' &&
    normalizedNext === 'Livrée'
  ) {
    return true;
  }

  return false;
};

const getMyDeliveryProfile = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const [currentOrder, assignedOrders, deliveredOrders] = await Promise.all([
      findDriverCurrentOrder(driver._id),
      Order.countDocuments({
        deliveryPerson: driver._id,
        status: { $in: DELIVERY_VISIBLE_STATUSES },
      }),
      Order.countDocuments({
        deliveryPerson: driver._id,
        status: 'Livrée',
      }),
    ]);

    return res.status(200).json({
      success: true,
      profile: buildDriverProfileResponse(driver),
      live: {
        hasActiveMission: Boolean(currentOrder),
        currentOrder: currentOrder ? buildOrderLiveMeta(currentOrder) : null,
      },
      stats: {
        assignedOrders,
        deliveredOrders,
      },
    });
  } catch (error) {
    console.error('DELIVERY PROFILE ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getAssignedDeliveryOrders = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const requestedStatus = normalizeString(req.query?.status);
    const limit = Math.min(
      Math.max(parseInt(req.query?.limit, 10) || 50, 1),
      100
    );

    const statuses = DELIVERY_VISIBLE_STATUSES.includes(requestedStatus)
      ? [requestedStatus]
      : DELIVERY_VISIBLE_STATUSES;

    const orders = await populateOrder(
      Order.find({
        deliveryPerson: driver._id,
        status: { $in: statuses },
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(limit)
    );

    const mappedOrders = orders.map(buildOrderLiveMeta);

    return res.status(200).json({
      success: true,
      count: mappedOrders.length,
      filters: {
        statuses,
        limit,
      },
      orders: mappedOrders,
    });
  } catch (error) {
    console.error('DELIVERY ASSIGNED ORDERS ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getCurrentDeliveryOrder = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const order = await findDriverCurrentOrder(driver._id);

    return res.status(200).json({
      success: true,
      order: order ? buildOrderLiveMeta(order) : null,
    });
  } catch (error) {
    console.error('DELIVERY CURRENT ORDER ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getDeliveryOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const order = await populateOrder(
      Order.findOne({
        _id: id,
        deliveryPerson: driver._id,
      })
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      order: buildOrderLiveMeta(order),
    });
  } catch (error) {
    console.error('DELIVERY ORDER BY ID ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const updateMyAvailability = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id, {
      mustBeActive: false,
    });

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide.',
      });
    }

    if (normalizeLowerString(driver.accountStatus) !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur non actif.',
      });
    }

    const rawValue = req.body?.available;
    const available =
      rawValue === true ||
      rawValue === 'true' ||
      rawValue === 1 ||
      rawValue === '1';

    const availabilityDecision = evaluateCourierAvailabilityChange(driver, available);
    if (!availabilityDecision.ok) {
      return res.status(availabilityDecision.status).json({
        success: false,
        code: availabilityDecision.code,
        message: availabilityDecision.message,
      });
    }

    driver.isAvailable = available;
    await driver.save();

    return res.status(200).json({
      success: true,
      message: available
        ? 'Disponibilité activée.'
        : 'Disponibilité désactivée.',
      available,
      profile: buildDriverProfileResponse(driver),
    });
  } catch (error) {
    console.error('DELIVERY AVAILABILITY ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const updateMyLocation = async (req, res) => {
  try {
    const driver = await User.findById(req.user?._id);

    if (!driver || normalizeLowerString(driver.role) !== 'livreur') {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide.',
      });
    }

    if (normalizeLowerString(driver.accountStatus) !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur inactif.',
      });
    }

    const { orderId, lat, lng, latitude, longitude } = req.body || {};

    const finalLat = normalizeNumber(lat ?? latitude, NaN);
    const finalLng = normalizeNumber(lng ?? longitude, NaN);

    const coordinateError = validateCoordinates(finalLat, finalLng);
    if (coordinateError) {
      return res.status(400).json({
        success: false,
        message: coordinateError,
      });
    }

    if (!driver.deliveryProfile || typeof driver.deliveryProfile !== 'object') {
      driver.deliveryProfile = {};
    }

    driver.deliveryProfile.currentLat = finalLat;
    driver.deliveryProfile.currentLng = finalLng;
    driver.deliveryProfile.lastLocationUpdateAt = new Date();

    await driver.save();

    let targetOrder = null;

    if (orderId) {
      if (!isValidObjectId(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'orderId invalide.',
        });
      }

      targetOrder = await Order.findOne({
        _id: orderId,
        deliveryPerson: driver._id,
      });
    } else {
      targetOrder = await Order.findOne({
        deliveryPerson: driver._id,
        status: { $in: DELIVERY_ACTIVE_STATUSES },
      }).sort({ updatedAt: -1, createdAt: -1 });
    }

    if (targetOrder) {
      targetOrder.deliveryLocation = {
        latitude: finalLat,
        longitude: finalLng,
        updatedAt: new Date(),
      };

      await targetOrder.save();
    }

    const populatedOrder = targetOrder
      ? await populateOrder(Order.findById(targetOrder._id))
      : null;

    return res.status(200).json({
      success: true,
      message: 'Position livreur mise à jour.',
      location: {
        lat: finalLat,
        lng: finalLng,
        updatedAt: driver.deliveryProfile.lastLocationUpdateAt,
      },
      order: populatedOrder ? buildOrderLiveMeta(populatedOrder) : null,
      profile: buildDriverProfileResponse(driver),
    });
  } catch (error) {
    console.error('DELIVERY LOCATION UPDATE ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const updateDeliveryMissionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const nextStatus = normalizeString(req.body?.status);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    if (!nextStatus) {
      return res.status(400).json({
        success: false,
        message: 'Le statut est obligatoire.',
      });
    }

    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const order = await Order.findOne({
      _id: id,
      deliveryPerson: driver._id,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable pour ce livreur.',
      });
    }

    if (!canDriverMoveOrderToStatus(order.status, nextStatus)) {
      return res.status(400).json({
        success: false,
        message:
          'Transition de statut invalide pour cette mission livreur.',
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
      setIfSchemaPathExists(order, 'pickedUpAt', new Date());
      setIfSchemaPathExists(order, 'deliveryStartedAt', new Date());
    }

    if (nextStatus === 'Livrée') {
      setIfSchemaPathExists(order, 'deliveredAt', new Date());
      setIfSchemaPathExists(order, 'completedAt', new Date());
    }

    pushStatusHistoryIfSupported(order, nextStatus, {
      _id: driver._id,
      role: 'livreur',
      note: deliveryPayment.cashPaymentCollected
        ? normalizeString(req.body?.note, 'Paiement à la livraison perçu')
        : normalizeString(req.body?.note),
    });

    await order.save();

    if (nextStatus === 'Livrée') {
      try {
        await createDeliveredOrderTransfers(order._id);
      } catch (payoutError) {
        // Delivery status is persisted even if external Stripe reconciliation fails.
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

    const populatedOrder = await populateOrder(Order.findById(order._id));

    return res.status(200).json({
      success: true,
      message: `Mission mise à jour : ${nextStatus}.`,
      order: buildOrderLiveMeta(populatedOrder),
    });
  } catch (error) {
    console.error('DELIVERY STATUS UPDATE ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getDeliveryOverview = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const [assigned, active, delivered, deliveredOrders] = await Promise.all([
      Order.countDocuments({
        deliveryPerson: driver._id,
        status: { $in: DELIVERY_VISIBLE_STATUSES },
      }),
      Order.countDocuments({
        deliveryPerson: driver._id,
        status: { $in: DELIVERY_ACTIVE_STATUSES },
      }),
      Order.countDocuments({
        deliveryPerson: driver._id,
        status: 'Livrée',
      }),
      Order.find({
        deliveryPerson: driver._id,
        status: 'Livrée',
      }).select(
        'deliveryFee driverFee driverEarning deliveryEarning total totalAmount totalPrice pricing totals summary'
      ),
    ]);

    const totalEarnings = roundMoney(
      deliveredOrders.reduce(
        (sum, order) => sum + inferDriverEarningFromOrder(order),
        0
      )
    );

    return res.status(200).json({
      success: true,
      overview: {
        assignedOrders: assigned,
        activeOrders: active,
        deliveredOrders: delivered,
        totalEarnings,
        isAvailable: Boolean(driver.isAvailable),
      },
    });
  } catch (error) {
    console.error('DELIVERY OVERVIEW ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getMyDeliveryEarnings = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const deliveredOrders = await Order.find({
      deliveryPerson: driver._id,
      status: 'Livrée',
    })
      .select(
        '_id status createdAt updatedAt deliveryFee driverFee driverEarning deliveryEarning total totalAmount totalPrice pricing totals summary'
      )
      .sort({ updatedAt: -1, createdAt: -1 });

    const items = deliveredOrders.map((order) => ({
      _id: order._id,
      id: order._id,
      status: order.status || '',
      amount: inferDriverEarningFromOrder(order),
      orderAmount: inferOrderAmount(order),
      createdAt: order.createdAt || null,
      updatedAt: order.updatedAt || null,
    }));

    const totalEarnings = roundMoney(
      items.reduce((sum, item) => sum + item.amount, 0)
    );

    return res.status(200).json({
      success: true,
      count: items.length,
      totalEarnings,
      earnings: items,
    });
  } catch (error) {
    console.error('DELIVERY EARNINGS ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const getMyDeliveryStats = async (req, res) => {
  try {
    const driver = await ensureDriverAccount(req.user?._id);

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Compte livreur invalide ou inactif.',
      });
    }

    const [confirmed, preparing, inDelivery, delivered, cancelled] =
      await Promise.all([
        Order.countDocuments({
          deliveryPerson: driver._id,
          status: 'Confirmée',
        }),
        Order.countDocuments({
          deliveryPerson: driver._id,
          status: 'En préparation',
        }),
        Order.countDocuments({
          deliveryPerson: driver._id,
          status: 'En livraison',
        }),
        Order.countDocuments({
          deliveryPerson: driver._id,
          status: 'Livrée',
        }),
        Order.countDocuments({
          deliveryPerson: driver._id,
          status: 'Annulée',
        }),
      ]);

    return res.status(200).json({
      success: true,
      stats: {
        confirmedOrders: confirmed,
        preparingOrders: preparing,
        inDeliveryOrders: inDelivery,
        deliveredOrders: delivered,
        cancelledOrders: cancelled,
        activeOrders: preparing + inDelivery,
        totalVisibleOrders: confirmed + preparing + inDelivery + delivered,
      },
    });
  } catch (error) {
    console.error('DELIVERY STATS ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

module.exports = {
  getMyDeliveryProfile,
  getAssignedDeliveryOrders,
  getCurrentDeliveryOrder,
  getDeliveryOrderById,
  updateMyAvailability,
  updateMyLocation,
  updateDeliveryMissionStatus,
  getDeliveryOverview,
  getMyDeliveryEarnings,
  getMyDeliveryStats,
};