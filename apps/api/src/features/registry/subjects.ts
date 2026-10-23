import { registerSubject } from '../decisions/index.js';
import { decide, findPromotion, setTier } from './infrastructure/registry.tables.js';

// Once a promotion's approval circuit decides (spec 005), the resource changes tier, or stays.
registerSubject(
  'registry.promotion',
  async (db, promotionId, outcome, decidedBy) => {
    const promotion = await findPromotion(db, promotionId);
    if (!promotion || promotion.status !== 'pending') return;
    await decide(db, promotionId, outcome, decidedBy, null);
    if (outcome === 'approved') await setTier(db, promotion.resourceId, promotion.target);
  },
  // What a person reads in « Décider », instead of the subject's code.
  { fr: 'Ouverture d’un outil', en: 'Opening a tool' },
  // Its measure is the tool's risk (`riskLevel`); its reference, the promotion's own id.
  {
    measure: {
      label: { fr: 'Risque', en: 'Risk' },
      levels: {
        '1': { fr: 'faible', en: 'low' },
        '2': { fr: 'moyen', en: 'medium' },
        '3': { fr: 'élevé', en: 'high' },
      },
    },
    internalReference: true,
  },
);
