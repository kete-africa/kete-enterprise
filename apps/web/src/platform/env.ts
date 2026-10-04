function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example).`);
  return value;
}

/** Read lazily: importing a module never fails at build time. */
export const env = {
  get publicUrl() {
    return required('PUBLIC_URL').replace(/\/$/, '');
  },
  /** Kete Enterprise's API, as this server reaches it. */
  get apiUrl() {
    return required('API_URL').replace(/\/$/, '');
  },
  /** The API as browsers reach it (the apps' views run there, spec 030); `API_URL` by default. */
  get publicApiUrl() {
    return (process.env.PUBLIC_API_URL ?? required('API_URL')).replace(/\/$/, '');
  },
  get accountUrl() {
    return required('KETE_ACCOUNT_URL').replace(/\/$/, '');
  },
  get clientId() {
    return required('KETE_CLIENT_ID');
  },
  get clientSecret() {
    return required('KETE_CLIENT_SECRET');
  },
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
};
