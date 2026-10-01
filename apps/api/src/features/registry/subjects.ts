import { registerSubject } from '../decisions/index.js';
import { decide, findPromotion, setTier } from './infrastructure/registry.tables.js';

// Once a promotion's approval circuit decides (spec 005), the resource changes tier, or stays.
registerSubject('registry.promotion', async (db, promotionId, outcome, decidedBy) => {
  const promotion = await findPromotion(db, promotionId);
  if (!promotion || promotion.status !== 'pending') return;
  await decide(db, promotionId, outcome, decidedBy, null);
  if (outcome === 'approved') await setTier(db, promotion.resourceId, promotion.target);
});
