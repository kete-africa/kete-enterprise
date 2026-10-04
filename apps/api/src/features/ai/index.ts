// The AI feature's only door (specs 026, 026b): each person's own connection or subscription, the
// organization's policy.
export {
  aiConnectionsMigrationSql,
  modelChoiceFor,
  readConnection,
  readPolicy,
  type Connection,
  type ModelChoice,
  type PersonalPolicy,
} from './connections.js';
export { useKeyChecker } from './infrastructure/key-check.js';
export { subscriptionAgent, useSubscriptionAgent } from './infrastructure/subscription-agent.js';
export {
  aiSubscriptionsMigrationSql,
  markUsed as markSubscriptionUsed,
  payers,
  payersFor,
  readSubscription,
  SubscriptionLostError,
  type Payer,
  type Subscription,
  type SubscriptionAgent,
} from './subscriptions.js';
export { aiRoutes } from './routes.js';
