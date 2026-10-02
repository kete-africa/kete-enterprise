function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example).`);
  return value;
}

/** Read lazily: importing a module never fails before the server starts. */
export const env = {
  /** The application role: no BYPASSRLS, row-level security applies to every query. */
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  /** The owner role: migrations, and the worker's jobs schema. */
  get ownerDatabaseUrl() {
    return required('OWNER_DATABASE_URL');
  },
  /** The identity that issues people's tokens: the Compte Kete, or the instance's own. */
  get accountUrl() {
    return required('KETE_ACCOUNT_URL').replace(/\/$/, '');
  },
  get environment(): 'production' | 'staging' | 'preview' | 'development' {
    const value = process.env.KETE_ENVIRONMENT;
    return value === 'production' || value === 'staging' || value === 'preview'
      ? value
      : 'development';
  },
  /** Where people's copilots reach this API (the MCP gateway's resource). */
  get publicApiUrl() {
    return (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
  },
  /** Where people open the screens: the links of e-mails point there. */
  get publicWebUrl() {
    return (process.env.PUBLIC_WEB_URL ?? '').replace(/\/$/, '');
  },
  /** `capture` keeps e-mails in the test outbox; `send` hands them to the provider (spec 010). */
  get mailMode(): 'capture' | 'send' {
    return process.env.KETE_MAIL_MODE === 'send' && process.env.MAILKITE_API_KEY
      ? 'send'
      : 'capture';
  },
  get mailFrom() {
    return process.env.KETE_MAIL_FROM ?? 'Kete Enterprise <entreprise@kete.africa>';
  },
  get port() {
    return Number(process.env.PORT ?? 3000);
  },
};
