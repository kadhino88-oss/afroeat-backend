'use strict';

/**
 * Dispatch des courses aux livreurs (comme Uber Eats / Deliveroo) :
 * - une commande payée, livrée par AFROEAT et sans livreur est « disponible » ;
 * - les livreurs vérifiés, disponibles et à proximité sont prévenus par notification ;
 * - le premier qui accepte la prend (attribution atomique), les autres voient qu'elle est partie.
 * L'attribution manuelle par l'administrateur reste possible.
 */
const DISPATCH_RADIUS_KM = Number(process.env.DISPATCH_RADIUS_KM || 8);
const LOCATION_FRESH_MS = 30 * 60 * 1000; // position du livreur considérée à jour pendant 30 min
const MAX_COURIERS_NOTIFIED = 25;
const OPEN_ORDER_STATUSES = ['Confirmée', 'En préparation'];

const toRad = (deg) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau en km (formule de haversine). */
const distanceKm = (a, b) => {
  if (!a || !b) return null;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
};

/** Filtre Mongo des commandes qu'un livreur peut prendre. */
const availableOrderFilter = () => ({
  status: { $in: OPEN_ORDER_STATUSES },
  paymentStatus: 'Payé',
  selfDelivery: { $ne: true },
  $or: [{ deliveryPerson: null }, { deliveryPerson: { $exists: false } }],
});

const courierPoint = (courier, now = Date.now()) => {
  const profile = courier?.deliveryProfile || {};
  const at = profile.lastLocationUpdateAt ? new Date(profile.lastLocationUpdateAt).getTime() : 0;
  if (!at || now - at > LOCATION_FRESH_MS) return null;
  if (!Number.isFinite(Number(profile.currentLat)) || !Number.isFinite(Number(profile.currentLng))) return null;
  return { lat: Number(profile.currentLat), lng: Number(profile.currentLng) };
};

const restaurantPoint = (order) => {
  const loc = order?.restaurantLocation;
  if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng)) && loc.lat !== null && loc.lng !== null) {
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  }
  const r = order?.restaurant;
  const lat = r?.location?.latitude ?? r?.latitude;
  const lng = r?.location?.longitude ?? r?.longitude;
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return { lat: Number(lat), lng: Number(lng) };
};

/**
 * Une course est proposée à un livreur si elle est proche de lui. Sans position connue
 * (livreur ou restaurant), on la propose quand même : mieux vaut une course visible
 * qu'une commande qui attend.
 */
const isWithinDispatchRadius = (courierPos, restaurantPos, radiusKm = DISPATCH_RADIUS_KM) => {
  const d = distanceKm(courierPos, restaurantPos);
  return d === null || d <= radiusKm;
};

const notifyRestaurantNewOrder = async (order) => {
  try {
    const Restaurant = require('../models/Restaurant');
    const { sendPushToUser } = require('./pushNotifications');
    const restaurant = await Restaurant.findById(order.restaurant?._id || order.restaurant).select('owner name');
    if (!restaurant?.owner) return;
    const ref = String(order._id).slice(-6).toUpperCase();
    const total = Number(order.totalPrice || 0).toFixed(2);
    await sendPushToUser(restaurant.owner, {
      title: 'Nouvelle commande',
      body: `Commande #${ref} · ${total} ${order.currency || ''}`.trim(),
      data: { orderId: String(order._id), type: 'restaurant_new_order' },
    });
  } catch (error) {
    console.error('Alerte restaurant non envoyée :', error.message);
  }
};

const notifyNearbyCouriers = async (order) => {
  try {
    if (order.selfDelivery === true || order.deliveryPerson) return 0;
    const User = require('../models/User');
    const Restaurant = require('../models/Restaurant');
    const { sendPushToUser } = require('./pushNotifications');
    const restaurant = await Restaurant.findById(order.restaurant?._id || order.restaurant).select('name location latitude longitude');
    const target = restaurantPoint({ restaurantLocation: order.restaurantLocation, restaurant });
    const couriers = await User.find({
      role: 'livreur',
      accountStatus: 'active',
      isIdentityVerified: true,
      isWorkAuthorized: true,
      isAvailable: true,
    }).select('_id deliveryProfile');
    const earning = Number(order.driverEarning || 0).toFixed(2);
    const targets = couriers
      .filter((courier) => isWithinDispatchRadius(courierPoint(courier), target))
      .slice(0, MAX_COURIERS_NOTIFIED);
    // Envois attendus : sur un hébergement serverless, une promesse non attendue peut être coupée.
    await Promise.allSettled(
      targets.map((courier) =>
        sendPushToUser(courier._id, {
          title: 'Nouvelle course disponible',
          body: `${restaurant?.name || 'Restaurant'} · ${earning} ${order.currency || ''} pour vous`.trim(),
          data: { orderId: String(order._id), type: 'order_available' },
        })
      )
    );
    return targets.length;
  } catch (error) {
    console.error('Alerte livreurs non envoyée :', error.message);
    return 0;
  }
};

/** Prévient le restaurant et les livreurs proches d'une commande qui vient d'être payée. */
const announcePaidOrder = async (order) => {
  await notifyRestaurantNewOrder(order);
  await notifyNearbyCouriers(order);
};

module.exports = {
  DISPATCH_RADIUS_KM,
  OPEN_ORDER_STATUSES,
  distanceKm,
  availableOrderFilter,
  courierPoint,
  restaurantPoint,
  isWithinDispatchRadius,
  notifyRestaurantNewOrder,
  notifyNearbyCouriers,
  announcePaidOrder,
};
