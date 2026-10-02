// The mail feature's only door: e-mails queued with the gesture, and the test outbox (spec 010).
export { mailMigrationSql } from './infrastructure/mail.tables.js';
export { renderMail, type MailContent } from './layout.js';
export { mailRoutes, queueMail, sendQueuedMail, useEmailSender } from './mail.js';
export type { Locale } from './words.js';
