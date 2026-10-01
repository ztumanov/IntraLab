import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const SPIFFE_TRUST_DOMAIN = 'infralab';
export const DEFAULT_AGENT_CERT_TTL_HOURS = 72;

export interface AgentCaBundle {
  caCertPem: string;
  caKeyPem: string;
  caCert: crypto.X509Certificate;
  caPrivateKey: crypto.KeyObject;
}

export interface SignedAgentCertificate {
  agentId: string;
  clientCertPem: string;
  caCertPem: string;
  serialHex: string;
  fingerprintSha256: string;
  subject: string;
  sanUri: string;
  notBefore: Date;
  notAfter: Date;
}

export interface VerifiedClientCertificate {
  agentId: string;
  serialHex: string;
  fingerprintSha256: string;
  subject: string;
  sanUri: string;
  notBefore: Date;
  notAfter: Date;
}

export function buildAgentSpiffeUri(agentId: string): string {
  return `spiffe://${SPIFFE_TRUST_DOMAIN}/agent/${agentId.trim()}`;
}

export function getConfiguredAgentCertTtlHours(): number {
  const raw = Number(process.env.AGENT_CERT_TTL_HOURS);
  if (Number.isFinite(raw) && raw > 0 && raw <= 8760) {
    return raw;
  }
  return DEFAULT_AGENT_CERT_TTL_HOURS;
}

// --- Minimal ASN.1 DER Builder & Parser for X.509v3 and PKCS#10 CSR ---

function encodeDerLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeDerLength(content.length), content]);
}

function derSequence(items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items));
}

function derSet(items: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(items));
}

function derOctetString(buf: Buffer): Buffer {
  return derTlv(0x04, buf);
}

function derBitString(buf: Buffer, unusedBits = 0): Buffer {
  return derTlv(0x03, Buffer.concat([Buffer.from([unusedBits]), buf]));
}

function derBoolean(val: boolean): Buffer {
  return derTlv(0x01, Buffer.from([val ? 0xff : 0x00]));
}

function derInteger(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0 && (buf[start + 1] & 0x80) === 0) {
    start++;
  }
  let slice = buf.subarray(start);
  if (slice[0] & 0x80) {
    slice = Buffer.concat([Buffer.from([0x00]), slice]);
  }
  return derTlv(0x02, slice);
}

function derIntegerFromNumber(num: number): Buffer {
  return derInteger(Buffer.from([num & 0xff]));
}

function derOid(oidStr: string): Buffer {
  const parts = oidStr.split('.').map((n) => Number(n));
  if (parts.length < 2) {
    throw new Error(`Invalid OID: ${oidStr}`);
  }
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val === 0) {
      bytes.push(0);
      continue;
    }
    const sub: number[] = [];
    while (val > 0) {
      sub.unshift(val & 0x7f);
      val = Math.floor(val / 128);
    }
    for (let j = 0; j < sub.length - 1; j++) {
      sub[j] |= 0x80;
    }
    bytes.push(...sub);
  }
  return derTlv(0x06, Buffer.from(bytes));
}

function derUtf8String(str: string): Buffer {
  return derTlv(0x0c, Buffer.from(str, 'utf8'));
}

function derUtcOrGeneralizedTime(date: Date): Buffer {
  const year = date.getUTCFullYear();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const rest =
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z';
  if (year >= 1950 && year <= 2049) {
    const yy = pad2(year % 100);
    return derTlv(0x17, Buffer.from(yy + rest, 'ascii'));
  }
  return derTlv(0x18, Buffer.from(String(year) + rest, 'ascii'));
}

function derExplicit(tagNumber: number, inner: Buffer): Buffer {
  return derTlv(0xa0 | tagNumber, inner);
}

function derName(attrs: Array<{ oid: string; value: string }>): Buffer {
  const rdns = attrs.map((a) =>
    derSet([derSequence([derOid(a.oid), derUtf8String(a.value)])])
  );
  return derSequence(rdns);
}

function derExtension(oid: string, critical: boolean, valueDer: Buffer): Buffer {
  const items: Buffer[] = [derOid(oid)];
  if (critical) {
    items.push(derBoolean(true));
  }
  items.push(derOctetString(valueDer));
  return derSequence(items);
}

// OIDs
const OID_COMMON_NAME = '2.5.4.3';
const OID_ORGANIZATION = '2.5.4.10';
const OID_ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const OID_ED25519 = '1.3.101.112';

const OID_EXT_SUBJECT_KEY_ID = '2.5.29.14';
const OID_EXT_KEY_USAGE = '2.5.29.15';
const OID_EXT_SAN = '2.5.29.17';
const OID_EXT_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_EXT_AUTHORITY_KEY_ID = '2.5.29.35';
const OID_EXT_EXT_KEY_USAGE = '2.5.29.37';
const OID_KP_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_KP_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

interface Asn1Element {
  tag: number;
  headerLen: number;
  length: number;
  raw: Buffer;
  value: Buffer;
}

function readAsn1Element(buf: Buffer, offset = 0): Asn1Element {
  if (offset >= buf.length) {
    throw new Error('ASN.1 parse error: unexpected end of buffer');
  }
  const tag = buf[offset];
  let lenByte = buf[offset + 1];
  let length = 0;
  let headerLen = 2;

  if ((lenByte & 0x80) === 0) {
    length = lenByte;
  } else {
    const numOctets = lenByte & 0x7f;
    if (numOctets === 0 || numOctets > 4 || offset + 2 + numOctets > buf.length) {
      throw new Error('ASN.1 parse error: invalid length octets');
    }
    for (let i = 0; i < numOctets; i++) {
      length = (length << 8) | buf[offset + 2 + i];
    }
    headerLen = 2 + numOctets;
  }

  const totalLen = headerLen + length;
  if (offset + totalLen > buf.length) {
    throw new Error('ASN.1 parse error: element exceeds buffer bounds');
  }

  return {
    tag,
    headerLen,
    length,
    raw: buf.subarray(offset, offset + totalLen),
    value: buf.subarray(offset + headerLen, offset + totalLen),
  };
}

function readAsn1SequenceChildren(seqValue: Buffer): Asn1Element[] {
  const children: Asn1Element[] = [];
  let offset = 0;
  while (offset < seqValue.length) {
    const el = readAsn1Element(seqValue, offset);
    children.push(el);
    offset += el.raw.length;
  }
  return children;
}

function decodeOid(oidValue: Buffer): string {
  if (oidValue.length === 0) return '';
  const first = oidValue[0];
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let current = 0;
  for (let i = 1; i < oidValue.length; i++) {
    const byte = oidValue[i];
    current = current * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(current);
      current = 0;
    }
  }
  return parts.join('.');
}

function pemToDer(pem: string, expectedLabel: string): Buffer {
  const clean = (pem || '').trim();
  const regex = new RegExp(
    `-----BEGIN ${expectedLabel}-----([\\s\\S]+?)-----END ${expectedLabel}-----`
  );
  const match = clean.match(regex);
  if (!match) {
    throw new Error(`Invalid PEM format: expected ${expectedLabel}`);
  }
  const b64 = match[1].replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function computeSpkiKeyIdentifier(spkiDer: Buffer): Buffer {
  const spkiElem = readAsn1Element(spkiDer, 0);
  const children = readAsn1SequenceChildren(spkiElem.value);
  // Second element of SubjectPublicKeyInfo is subjectPublicKey BIT STRING
  const bitString = children[1];
  const pubKeyBytes =
    bitString && bitString.tag === 0x03 && bitString.value.length > 1
      ? bitString.value.subarray(1)
      : spkiDer;
  return crypto.createHash('sha1').update(pubKeyBytes).digest();
}

export function generateRootCaKeyPairAndCert(commonName = 'InfraLab Agent Root CA'): AgentCaBundle {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] &= 0x7f;
  if (serialBytes[0] === 0) serialBytes[0] = 0x01;

  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000); // 10 years CA

  const caNameDer = derName([
    { oid: OID_ORGANIZATION, value: 'InfraLab' },
    { oid: OID_COMMON_NAME, value: commonName },
  ]);

  const sigAlgDer = derSequence([derOid(OID_ECDSA_WITH_SHA256)]);
  const keyId = computeSpkiKeyIdentifier(spkiDer);

  // KeyUsage: keyCertSign (bit 5 = 0x04) | cRLSign (bit 6 = 0x02) -> 0x06, 1 unused bit
  const keyUsageVal = derBitString(Buffer.from([0x06]), 1);
  // BasicConstraints: CA:TRUE, pathlen:0
  const basicConstraintsVal = derSequence([derBoolean(true), derIntegerFromNumber(0)]);
  const skiVal = derOctetString(keyId);

  const extensionsSeq = derSequence([
    derExtension(OID_EXT_BASIC_CONSTRAINTS, true, basicConstraintsVal),
    derExtension(OID_EXT_KEY_USAGE, true, keyUsageVal),
    derExtension(OID_EXT_SUBJECT_KEY_ID, false, skiVal),
  ]);

  const tbsCertDer = derSequence([
    derExplicit(0, derIntegerFromNumber(2)), // v3
    derInteger(serialBytes),
    sigAlgDer,
    caNameDer,
    derSequence([derUtcOrGeneralizedTime(notBefore), derUtcOrGeneralizedTime(notAfter)]),
    caNameDer,
    spkiDer,
    derExplicit(3, extensionsSeq),
  ]);

  const signature = crypto.sign('sha256', tbsCertDer, privateKey);
  const certDer = derSequence([tbsCertDer, sigAlgDer, derBitString(signature, 0)]);

  const caCertPem = derToPem(certDer, 'CERTIFICATE');
  const caKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;

  return {
    caCertPem,
    caKeyPem,
    caCert: new crypto.X509Certificate(certDer),
    caPrivateKey: privateKey,
  };
}

export function parseAndVerifyCsrPem(csrPem: string): {
  publicKey: crypto.KeyObject;
  spkiDer: Buffer;
} {
  let csrDer: Buffer;
  try {
    csrDer = pemToDer(csrPem, 'CERTIFICATE REQUEST');
  } catch {
    csrDer = pemToDer(csrPem, 'NEW CERTIFICATE REQUEST');
  }

  const root = readAsn1Element(csrDer, 0);
  if (root.tag !== 0x30) {
    throw new Error('Invalid CSR: root is not a SEQUENCE');
  }
  const topChildren = readAsn1SequenceChildren(root.value);
  if (topChildren.length < 3) {
    throw new Error('Invalid CSR: missing CertificationRequest fields');
  }

  const reqInfoElem = topChildren[0];
  const sigAlgElem = topChildren[1];
  const sigBitStringElem = topChildren[2];

  if (reqInfoElem.tag !== 0x30 || sigAlgElem.tag !== 0x30 || sigBitStringElem.tag !== 0x03) {
    throw new Error('Invalid CSR structure');
  }

  const reqInfoChildren = readAsn1SequenceChildren(reqInfoElem.value);
  if (reqInfoChildren.length < 3) {
    throw new Error('Invalid CSR: missing CertificationRequestInfo fields');
  }

  const spkiElem = reqInfoChildren[2];
  if (spkiElem.tag !== 0x30) {
    throw new Error('Invalid CSR: missing SubjectPublicKeyInfo');
  }

  const publicKey = crypto.createPublicKey({
    key: spkiElem.raw,
    format: 'der',
    type: 'spki',
  });

  const sigAlgChildren = readAsn1SequenceChildren(sigAlgElem.value);
  if (sigAlgChildren.length < 1 || sigAlgChildren[0].tag !== 0x06) {
    throw new Error('Invalid CSR signature algorithm');
  }
  const sigOid = decodeOid(sigAlgChildren[0].value);

  if (sigBitStringElem.value.length < 2 || sigBitStringElem.value[0] !== 0) {
    throw new Error('Invalid CSR signature bit string');
  }
  const signatureBytes = sigBitStringElem.value.subarray(1);

  let verified = false;
  if (sigOid === OID_ECDSA_WITH_SHA256 || sigOid === OID_SHA256_WITH_RSA) {
    verified = crypto.verify('sha256', reqInfoElem.raw, publicKey, signatureBytes);
  } else if (sigOid === OID_ED25519) {
    verified = crypto.verify(null, reqInfoElem.raw, publicKey, signatureBytes);
  } else {
    throw new Error(`Unsupported CSR signature algorithm OID: ${sigOid}`);
  }

  if (!verified) {
    throw new Error('CSR signature verification failed');
  }

  return {
    publicKey,
    spkiDer: spkiElem.raw,
  };
}

export function generateAgentKeyPairAndCsrPem(commonName = 'infralab-agent'): {
  privateKeyPem: string;
  csrPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const subjectDer = derName([
    { oid: OID_ORGANIZATION, value: 'InfraLab Agent' },
    { oid: OID_COMMON_NAME, value: commonName },
  ]);

  // CertificationRequestInfo ::= SEQUENCE { version INTEGER(0), subject Name, subjectPKInfo, attributes [0] IMPLICIT }
  const reqInfoDer = derSequence([
    derIntegerFromNumber(0),
    subjectDer,
    spkiDer,
    derTlv(0xa0, Buffer.alloc(0)),
  ]);

  const sigAlgDer = derSequence([derOid(OID_ECDSA_WITH_SHA256)]);
  const signature = crypto.sign('sha256', reqInfoDer, privateKey);
  const csrDer = derSequence([reqInfoDer, sigAlgDer, derBitString(signature, 0)]);

  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    csrPem: derToPem(csrDer, 'CERTIFICATE REQUEST'),
  };
}

let cachedCaBundle: AgentCaBundle | null = null;

function resolveDefaultPkiDir(): string {
  const configuredDir = process.env.AGENT_PKI_DIR?.trim();
  if (configuredDir) return configuredDir;

  const varLibDir = '/var/lib/infralab/pki';
  try {
    fs.mkdirSync(varLibDir, { recursive: true, mode: 0o700 });
    return varLibDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), 'infralab-pki');
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    return tmpDir;
  }
}

export function getOrInitInfraLabCa(): AgentCaBundle {
  if (cachedCaBundle) {
    return cachedCaBundle;
  }

  const envCertPem = process.env.AGENT_CA_CERT_PEM?.trim();
  const envKeyPem = process.env.AGENT_CA_KEY_PEM?.trim();
  if (envCertPem && envKeyPem) {
    cachedCaBundle = {
      caCertPem: envCertPem,
      caKeyPem: envKeyPem,
      caCert: new crypto.X509Certificate(envCertPem),
      caPrivateKey: crypto.createPrivateKey(envKeyPem),
    };
    return cachedCaBundle;
  }

  const pkiDir = resolveDefaultPkiDir();
  const certPath = process.env.AGENT_CA_CERT_PATH?.trim() || path.join(pkiDir, 'ca.crt');
  const keyPath = process.env.AGENT_CA_KEY_PATH?.trim() || path.join(pkiDir, 'ca.key');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const caCertPem = fs.readFileSync(certPath, 'utf8');
    const caKeyPem = fs.readFileSync(keyPath, 'utf8');
    cachedCaBundle = {
      caCertPem,
      caKeyPem,
      caCert: new crypto.X509Certificate(caCertPem),
      caPrivateKey: crypto.createPrivateKey(caKeyPem),
    };
    return cachedCaBundle;
  }

  const generated = generateRootCaKeyPairAndCert('InfraLab Agent Root CA');
  try {
    fs.mkdirSync(path.dirname(certPath), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, generated.caKeyPem, { mode: 0o600 });
    fs.chmodSync(keyPath, 0o600);
    fs.writeFileSync(certPath, generated.caCertPem, { mode: 0o644 });
  } catch {
    // Keep in-memory CA if filesystem is read-only
  }

  cachedCaBundle = generated;
  return cachedCaBundle;
}

export function signAgentCsr(params: {
  csrPem: string;
  agentId: string;
  ttlHours?: number;
  caBundle?: AgentCaBundle;
}): SignedAgentCertificate {
  const cleanAgentId = (params.agentId || '').trim();
  if (!cleanAgentId || !/^agt_[a-zA-Z0-9_-]+$/.test(cleanAgentId)) {
    throw new Error('Invalid agent_id format for certificate signing');
  }

  const { spkiDer } = parseAndVerifyCsrPem(params.csrPem);
  const ca = params.caBundle || getOrInitInfraLabCa();

  const ttlHours =
    typeof params.ttlHours === 'number' && params.ttlHours > 0
      ? params.ttlHours
      : getConfiguredAgentCertTtlHours();

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 1000); // 1m clock skew tolerance
  const notAfter = new Date(now.getTime() + ttlHours * 3600 * 1000);

  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] &= 0x7f;
  if (serialBytes[0] === 0) serialBytes[0] = 0x01;
  const serialHex = serialBytes.toString('hex').toUpperCase();

  const sanUri = buildAgentSpiffeUri(cleanAgentId);

  // Extract issuer Name directly from CA certificate TBS so it matches byte-for-byte
  const caDer = ca.caCert.raw;
  const caRoot = readAsn1Element(caDer, 0);
  const caTbs = readAsn1SequenceChildren(caRoot.value)[0];
  const caTbsChildren = readAsn1SequenceChildren(caTbs.value);
  // In X.509v3 TBSCertificate: [0]=version, [1]=serial, [2]=sigAlg, [3]=issuer, [4]=validity, [5]=subject, [6]=spki
  const caSubjectDer = caTbsChildren[5].raw;
  const caSpkiDer = caTbsChildren[6].raw;

  const subjectDer = derName([
    { oid: OID_ORGANIZATION, value: 'InfraLab Agent' },
    { oid: OID_COMMON_NAME, value: cleanAgentId },
  ]);

  const sigAlgDer = derSequence([derOid(OID_ECDSA_WITH_SHA256)]);

  // BasicConstraints: CA:FALSE (empty sequence)
  const basicConstraintsVal = derSequence([]);
  // KeyUsage: digitalSignature (bit 0 = 0x80, 7 unused bits)
  const keyUsageVal = derBitString(Buffer.from([0x80]), 7);
  // ExtKeyUsage: clientAuth
  const extKeyUsageVal = derSequence([derOid(OID_KP_CLIENT_AUTH)]);
  // SubjectAltName: uniformResourceIdentifier [6] IMPLICIT IA5String (0x86)
  const sanVal = derSequence([derTlv(0x86, Buffer.from(sanUri, 'ascii'))]);

  const subjectKeyId = computeSpkiKeyIdentifier(spkiDer);
  const authorityKeyId = computeSpkiKeyIdentifier(caSpkiDer);
  const skiVal = derOctetString(subjectKeyId);
  // AuthorityKeyIdentifier ::= SEQUENCE { [0] IMPLICIT KeyIdentifier }
  const akiVal = derSequence([derTlv(0x80, authorityKeyId)]);

  const extensionsSeq = derSequence([
    derExtension(OID_EXT_BASIC_CONSTRAINTS, true, basicConstraintsVal),
    derExtension(OID_EXT_KEY_USAGE, true, keyUsageVal),
    derExtension(OID_EXT_EXT_KEY_USAGE, false, extKeyUsageVal),
    derExtension(OID_EXT_SAN, false, sanVal),
    derExtension(OID_EXT_SUBJECT_KEY_ID, false, skiVal),
    derExtension(OID_EXT_AUTHORITY_KEY_ID, false, akiVal),
  ]);

  const tbsCertDer = derSequence([
    derExplicit(0, derIntegerFromNumber(2)), // v3
    derInteger(serialBytes),
    sigAlgDer,
    caSubjectDer,
    derSequence([derUtcOrGeneralizedTime(notBefore), derUtcOrGeneralizedTime(notAfter)]),
    subjectDer,
    spkiDer,
    derExplicit(3, extensionsSeq),
  ]);

  const signature = crypto.sign('sha256', tbsCertDer, ca.caPrivateKey);
  const certDer = derSequence([tbsCertDer, sigAlgDer, derBitString(signature, 0)]);
  const clientCertPem = derToPem(certDer, 'CERTIFICATE');

  const x509 = new crypto.X509Certificate(certDer);
  const fingerprintSha256 = crypto
    .createHash('sha256')
    .update(x509.raw)
    .digest('hex')
    .toLowerCase();

  return {
    agentId: cleanAgentId,
    clientCertPem,
    caCertPem: ca.caCertPem,
    serialHex: x509.serialNumber.toUpperCase(),
    fingerprintSha256,
    subject: x509.subject.replace(/\n/g, ', '),
    sanUri,
    notBefore: new Date(x509.validFrom),
    notAfter: new Date(x509.validTo),
  };
}

export function verifyClientCertAgainstCa(
  clientCertPemOrDer: string | Buffer,
  caBundle?: AgentCaBundle,
  now: Date = new Date()
): VerifiedClientCertificate {
  const ca = caBundle || getOrInitInfraLabCa();
  const cert = new crypto.X509Certificate(clientCertPemOrDer);

  // 1. Must not be a CA certificate
  if (cert.ca) {
    throw new Error('Client certificate must not be a CA certificate');
  }

  // 2. Cryptographic signature verification against InfraLab Root CA
  if (!cert.checkIssued(ca.caCert) || !cert.verify(ca.caCert.publicKey)) {
    throw new Error('Client certificate was not issued by InfraLab Root CA');
  }

  // 3. Validity window check
  const notBefore = new Date(cert.validFrom);
  const notAfter = new Date(cert.validTo);
  if (now.getTime() < notBefore.getTime()) {
    throw new Error('Client certificate is not valid yet');
  }
  if (now.getTime() > notAfter.getTime()) {
    throw new Error('Client certificate has expired');
  }

  // 4. Enforce Extended Key Usage = TLS Web Client Authentication (1.3.6.1.5.5.7.3.2)
  const extKeyUsages = cert.keyUsage || [];
  if (!Array.isArray(extKeyUsages) || !extKeyUsages.includes(OID_KP_CLIENT_AUTH)) {
    throw new Error('Client certificate is missing required ExtendedKeyUsage clientAuth');
  }

  // 5. Extract SPIFFE URI from Subject Alternative Name
  const sanRaw = cert.subjectAltName || '';
  const sanEntries = sanRaw.split(',').map((s) => s.trim());
  const spiffeEntry = sanEntries.find((s) =>
    s.startsWith(`URI:spiffe://${SPIFFE_TRUST_DOMAIN}/agent/`)
  );
  if (!spiffeEntry) {
    throw new Error('Client certificate is missing required SPIFFE agent SAN URI');
  }

  const sanUri = spiffeEntry.slice('URI:'.length).trim();
  const prefix = `spiffe://${SPIFFE_TRUST_DOMAIN}/agent/`;
  const agentId = sanUri.slice(prefix.length).trim();
  if (!agentId || !/^agt_[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error('Client certificate contains invalid SPIFFE agent_id');
  }

  // 6. Verify Subject CommonName (CN) matches the SPIFFE agent_id
  const cnMatch = (cert.subject || '').match(/(?:^|\n|,\s*)CN=([^\n,]+)/);
  if (cnMatch && cnMatch[1].trim() !== agentId) {
    throw new Error('Client certificate Subject CN does not match SPIFFE agent_id');
  }

  const fingerprintSha256 = crypto
    .createHash('sha256')
    .update(cert.raw)
    .digest('hex')
    .toLowerCase();

  return {
    agentId,
    serialHex: cert.serialNumber.toUpperCase(),
    fingerprintSha256,
    subject: cert.subject.replace(/\n/g, ', '),
    sanUri,
    notBefore,
    notAfter,
  };
}

export function generateServerTlsKeyPairAndCert(params?: {
  commonName?: string;
  dnsNames?: string[];
  ipAddresses?: string[];
  ttlHours?: number;
  caBundle?: AgentCaBundle;
}): {
  serverKeyPem: string;
  serverCertPem: string;
  caCertPem: string;
} {
  const ca = params?.caBundle || getOrInitInfraLabCa();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] &= 0x7f;
  if (serialBytes[0] === 0) serialBytes[0] = 0x01;

  const ttlHours = params?.ttlHours && params.ttlHours > 0 ? params.ttlHours : 720;
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 1000);
  const notAfter = new Date(now.getTime() + ttlHours * 3600 * 1000);

  const caDer = ca.caCert.raw;
  const caRoot = readAsn1Element(caDer, 0);
  const caTbs = readAsn1SequenceChildren(caRoot.value)[0];
  const caTbsChildren = readAsn1SequenceChildren(caTbs.value);
  const caSubjectDer = caTbsChildren[5].raw;
  const caSpkiDer = caTbsChildren[6].raw;

  const cn = (params?.commonName || 'localhost').trim();
  const subjectDer = derName([
    { oid: OID_ORGANIZATION, value: 'InfraLab Server' },
    { oid: OID_COMMON_NAME, value: cn },
  ]);

  const dnsList = params?.dnsNames?.length ? params.dnsNames : ['localhost'];
  const ipList = params?.ipAddresses?.length ? params.ipAddresses : ['127.0.0.1'];

  const sanItems: Buffer[] = [];
  for (const dns of dnsList) {
    // dNSName [2] IMPLICIT IA5String (0x82)
    sanItems.push(derTlv(0x82, Buffer.from(dns, 'ascii')));
  }
  for (const ip of ipList) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      // iPAddress [7] IMPLICIT OCTET STRING (0x87)
      sanItems.push(derTlv(0x87, Buffer.from(parts)));
    }
  }

  const sigAlgDer = derSequence([derOid(OID_ECDSA_WITH_SHA256)]);
  const basicConstraintsVal = derSequence([]);
  const keyUsageVal = derBitString(Buffer.from([0x80]), 7); // digitalSignature
  const extKeyUsageVal = derSequence([derOid(OID_KP_SERVER_AUTH)]);
  const sanVal = derSequence(sanItems);
  const skiVal = derOctetString(computeSpkiKeyIdentifier(spkiDer));
  const akiVal = derSequence([derTlv(0x80, computeSpkiKeyIdentifier(caSpkiDer))]);

  const extensionsSeq = derSequence([
    derExtension(OID_EXT_BASIC_CONSTRAINTS, true, basicConstraintsVal),
    derExtension(OID_EXT_KEY_USAGE, true, keyUsageVal),
    derExtension(OID_EXT_EXT_KEY_USAGE, false, extKeyUsageVal),
    derExtension(OID_EXT_SAN, false, sanVal),
    derExtension(OID_EXT_SUBJECT_KEY_ID, false, skiVal),
    derExtension(OID_EXT_AUTHORITY_KEY_ID, false, akiVal),
  ]);

  const tbsCertDer = derSequence([
    derExplicit(0, derIntegerFromNumber(2)),
    derInteger(serialBytes),
    sigAlgDer,
    caSubjectDer,
    derSequence([derUtcOrGeneralizedTime(notBefore), derUtcOrGeneralizedTime(notAfter)]),
    subjectDer,
    spkiDer,
    derExplicit(3, extensionsSeq),
  ]);

  const signature = crypto.sign('sha256', tbsCertDer, ca.caPrivateKey);
  const certDer = derSequence([tbsCertDer, sigAlgDer, derBitString(signature, 0)]);

  return {
    serverKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    serverCertPem: derToPem(certDer, 'CERTIFICATE'),
    caCertPem: ca.caCertPem,
  };
}
