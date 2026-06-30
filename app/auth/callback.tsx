/**
 * Deep-link target for `egscrm://auth/callback?code=…`.
 * Lives at the exact path the OAuth redirect uses (outside the (auth) group).
 */
export { default } from '../(auth)/callback';
