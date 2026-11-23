'use strict';

// Idempotence des webhooks Stripe : un événement (id unique) n'a ses effets exécutés qu'une fois.
// Un verrou « processing » abandonné (plantage en cours de traitement) est repris après STALE_LOCK_MS.

const STALE_LOCK_MS = 2 * 60 * 1000;
const DUPLICATE_KEY = 11000;

/** @returns {Promise<'claimed'|'duplicate'>} */
const claimEvent = async (StripeEvent, event, now = Date.now()) => {
  try {
    await StripeEvent.create({ _id: event.id, type: String(event.type || 'unknown'), status: 'processing', lockedAt: new Date(now) });
    return 'claimed';
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY) throw error;
    const takenOver = await StripeEvent.findOneAndUpdate(
      { _id: event.id, status: 'processing', lockedAt: { $lt: new Date(now - STALE_LOCK_MS) } },
      { $set: { lockedAt: new Date(now) } }
    );
    return takenOver ? 'claimed' : 'duplicate';
  }
};

const completeEvent = (StripeEvent, event) =>
  StripeEvent.updateOne({ _id: event.id }, { $set: { status: 'done', processedAt: new Date() } });

// Libère l'enregistrement après un échec : Stripe pourra rejouer l'événement.
const releaseEvent = (StripeEvent, event) => StripeEvent.deleteOne({ _id: event.id });

module.exports = { claimEvent, completeEvent, releaseEvent, STALE_LOCK_MS };
