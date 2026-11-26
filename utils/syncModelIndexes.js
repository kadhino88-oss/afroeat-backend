'use strict';

/**
 * Crée les index d'un modèle Mongoose. Si `createIndexes()` échoue (par exemple un index existant de même
 * nom mais d'options différentes), on retente index par index pour qu'un seul conflit n'empêche pas
 * la création des autres index du modèle. Ne supprime jamais d'index.
 *
 * @returns {{ ok: boolean, failed: Array<{ key: string, message: string }> }}
 */
const syncModelIndexes = async (model) => {
  try {
    await model.createIndexes();
    return { ok: true, failed: [] };
  } catch (firstError) {
    const failed = [];
    for (const [fields, options] of model.schema.indexes()) {
      try {
        await model.collection.createIndex(fields, options || {});
      } catch (error) {
        failed.push({ key: JSON.stringify(fields), message: String(error?.message || firstError?.message || 'erreur') });
      }
    }
    return { ok: failed.length === 0, failed };
  }
};

module.exports = { syncModelIndexes };
