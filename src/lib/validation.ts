import net from 'node:net';

export interface CreateServerPayload {
  name?: unknown;
  hostname?: unknown;
  ip_address?: unknown;
  ssh_port?: unknown;
  username?: unknown;
  auth_type?: unknown;
  secret?: unknown;
  description?: unknown;
  verify_now?: unknown;
}

export interface ValidatedServerInput {
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  username: string;
  auth_type: 'password' | 'private_key';
  secret: string;
  description: string;
  verify_now: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  data?: ValidatedServerInput;
}

export function validateCreateServerPayload(payload: CreateServerPayload): ValidationResult {
  const errors: Record<string, string> = {};

  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    errors.name = 'Name is required and cannot be empty';
  } else if (name.length > 128) {
    errors.name = 'Name cannot exceed 128 characters';
  }

  const hostname = typeof payload?.hostname === 'string' ? payload.hostname.trim() : '';
  if (!hostname) {
    errors.hostname = 'Hostname is required and cannot be empty';
  } else if (hostname.length > 253) {
    errors.hostname = 'Hostname cannot exceed 253 characters';
  }

  const ipAddress = typeof payload?.ip_address === 'string' ? payload.ip_address.trim() : '';
  if (!ipAddress) {
    errors.ip_address = 'IP address is required';
  } else if (net.isIP(ipAddress) === 0) {
    errors.ip_address = 'IP address must be a valid IPv4 or IPv6 address';
  }

  const rawPort = payload?.ssh_port;
  const sshPort = typeof rawPort === 'number' ? rawPort : Number(rawPort);
  if (
    rawPort === undefined ||
    rawPort === null ||
    rawPort === '' ||
    !Number.isInteger(sshPort) ||
    sshPort < 1 ||
    sshPort > 65535
  ) {
    errors.ssh_port = 'SSH port must be an integer between 1 and 65535';
  }

  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  if (!username) {
    errors.username = 'Username is required and cannot be empty';
  } else if (username.length > 64) {
    errors.username = 'Username cannot exceed 64 characters';
  }

  const rawAuthType =
    typeof payload?.auth_type === 'string' ? payload.auth_type.trim() : 'password';
  const authType: 'password' | 'private_key' =
    rawAuthType === 'private_key' ? 'private_key' : 'password';

  const secret = typeof payload?.secret === 'string' ? payload.secret : '';

  const description =
    typeof payload?.description === 'string' ? payload.description.trim() : '';

  const verifyNow = payload?.verify_now === true;

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    data: {
      name,
      hostname,
      ip_address: ipAddress,
      ssh_port: sshPort,
      username,
      auth_type: authType,
      secret,
      description,
      verify_now: verifyNow,
    },
  };
}
