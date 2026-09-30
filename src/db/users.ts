import crypto from 'node:crypto';
import { eq, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';
import {
  DEFAULT_LOCAL_ADMIN_EMAIL,
  DEFAULT_LOCAL_ADMIN_USERNAME,
  ensureDatabaseSchema,
} from './bootstrap.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  authProvider: 'local' | 'google' = 'google'
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        authProvider,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Database user registration failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function findUserByUid(uid: string) {
  const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
  return rows[0] ?? null;
}

export async function findLocalUserByIdentifier(identifier: string) {
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;

  const queryUser = async () => {
    const rows = await db
      .select()
      .from(users)
      .where(
        or(
          sql`lower(${users.email}) = ${clean}`,
          sql`lower(${users.username}) = ${clean}`
        )
      )
      .limit(1);
    return rows[0] ?? null;
  };

  try {
    let found = await queryUser();
    if (
      (!found || !found.passwordHash) &&
      (clean === DEFAULT_LOCAL_ADMIN_USERNAME.toLowerCase() ||
        clean === DEFAULT_LOCAL_ADMIN_EMAIL.toLowerCase())
    ) {
      await ensureDatabaseSchema();
      found = await queryUser();
    }
    return found;
  } catch {
    await ensureDatabaseSchema();
    return await queryUser();
  }
}

export async function createLocalUserAccount(params: {
  username: string;
  email: string;
  passwordHash: string;
}) {
  const uid = `local_${crypto.randomBytes(10).toString('hex')}`;
  const rows = await db
    .insert(users)
    .values({
      uid,
      username: params.username.trim(),
      email: params.email.trim().toLowerCase(),
      passwordHash: params.passwordHash,
      authProvider: 'local',
      totpEnabled: 0,
    })
    .returning();
  return rows[0];
}

export async function updateUserPasswordHash(uid: string, passwordHash: string) {
  const rows = await db
    .update(users)
    .set({ passwordHash, authProvider: 'local' })
    .where(eq(users.uid, uid))
    .returning();
  return rows[0] ?? null;
}

export async function savePendingTotpSecret(uid: string, encryptedPendingSecret: string) {
  const rows = await db
    .update(users)
    .set({ totpPendingSecretEncrypted: encryptedPendingSecret })
    .where(eq(users.uid, uid))
    .returning();
  return rows[0] ?? null;
}

export async function activateUserTotp(
  uid: string,
  encryptedSecret: string,
  recoveryCodesHashesJson: string
) {
  const rows = await db
    .update(users)
    .set({
      totpEnabled: 1,
      totpSecretEncrypted: encryptedSecret,
      totpPendingSecretEncrypted: '',
      recoveryCodesHashes: recoveryCodesHashesJson,
    })
    .where(eq(users.uid, uid))
    .returning();
  return rows[0] ?? null;
}

export async function updateUserRecoveryCodes(uid: string, recoveryCodesHashesJson: string) {
  const rows = await db
    .update(users)
    .set({
      recoveryCodesHashes: recoveryCodesHashesJson,
    })
    .where(eq(users.uid, uid))
    .returning();
  return rows[0] ?? null;
}

export async function disableUserTotp(uid: string) {
  const rows = await db
    .update(users)
    .set({
      totpEnabled: 0,
      totpSecretEncrypted: '',
      totpPendingSecretEncrypted: '',
      recoveryCodesHashes: '[]',
    })
    .where(eq(users.uid, uid))
    .returning();
  return rows[0] ?? null;
}
