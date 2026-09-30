import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { findUserByUid, getOrCreateUser } from '../db/users.ts';
import { verifyLocalSessionToken } from '../server/localAuth.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

const SELF_HOSTED_OPERATOR_TOKEN =
  process.env.LOCAL_OPERATOR_TOKEN || 'infralab-self-hosted-operator-token';

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty token' });
  }

  // 1. Verify signed Local Session Token (ila_sess.*)
  if (token.startsWith('ila_sess.')) {
    const localPayload = verifyLocalSessionToken(token);
    if (!localPayload) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired local session token' });
    }
    try {
      const dbUser = await findUserByUid(localPayload.uid);
      const email = dbUser?.email || localPayload.email;
      if (!dbUser) {
        await getOrCreateUser(localPayload.uid, email, 'local');
      }
      req.user = {
        uid: localPayload.uid,
        email,
        aud: 'infralab-local',
        auth_time: localPayload.iat,
        exp: localPayload.exp,
        iat: localPayload.iat,
        iss: 'infralab-local',
        sub: localPayload.uid,
        firebase: { identities: {}, sign_in_provider: 'custom' },
      };
      return next();
    } catch (err) {
      console.error('Local session token verification failed:', err);
      return res.status(500).json({ error: 'Database verification error' });
    }
  }

  // 2. Support legacy self-hosted operator token
  if (token === SELF_HOSTED_OPERATOR_TOKEN) {
    const localUid = 'infralab-local-operator';
    const localEmail =
      process.env.ADMIN_EMAIL || process.env.OPERATOR_EMAIL || 'admin@infralab.local';
    try {
      await getOrCreateUser(localUid, localEmail, 'local');
      req.user = {
        uid: localUid,
        email: localEmail,
        aud: 'infralab-self-hosted',
        auth_time: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        iat: Math.floor(Date.now() / 1000),
        iss: 'infralab-self-hosted',
        sub: localUid,
        firebase: { identities: {}, sign_in_provider: 'custom' },
      };
      return next();
    } catch (err) {
      console.error('Local operator auth failed:', err);
      return res.status(500).json({ error: 'Database initialization error' });
    }
  }

  // 3. Verify Firebase Google OAuth ID token
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@infralab.local`,
      'google'
    );
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
