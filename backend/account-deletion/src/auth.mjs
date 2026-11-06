import { ServiceError, validateClaims } from './policy.mjs';

export async function authenticate(auth, token, now) {
  let claims;
  try { claims = await auth.verifyIdToken(token, false); }
  catch { throw new ServiceError(401, 'authentication_required'); }
  const session = validateClaims(claims, now);
  try {
    // A cryptographically valid token alone does not prove an active, unrevoked account.
    await auth.verifyIdToken(token, true);
    const user = await auth.getUser(session.uid);
    if (user.uid !== session.uid || user.disabled || !Array.isArray(user.providerData)
        || !user.providerData.some(provider => provider.providerId === session.provider)) {
      throw new ServiceError(401, 'authentication_required');
    }
    return { ...session, authMissing: false };
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return { ...session, authMissing: true };
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(401, 'authentication_required');
  }
}
