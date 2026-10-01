package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultIdentityPath   = "/etc/infralab-agent/credentials.json"
	DefaultClientKeyName  = "agent.key"
	DefaultClientCertName = "agent.crt"
	DefaultCACertName     = "ca.crt"
	CredentialFilePerm    = os.FileMode(0600)
	PublicCertFilePerm    = os.FileMode(0644)
)

// Identity stores the enrolled agent's permanent authentication material and X.509 certificate metadata.
// Note: Private keys and credentials must never be printed in logs via String() or GoString().
type Identity struct {
	ServerURL             string `json:"server_url"`
	AgentID               string `json:"agent_id"`
	AuthMode              string `json:"auth_mode,omitempty"`
	Credential            string `json:"credential,omitempty"`
	ClientCertPath        string `json:"client_cert_path,omitempty"`
	ClientKeyPath         string `json:"client_key_path,omitempty"`
	CACertPath            string `json:"ca_cert_path,omitempty"`
	CertSerial            string `json:"cert_serial,omitempty"`
	CertFingerprintSHA256 string `json:"cert_fingerprint_sha256,omitempty"`
	CertSANURI            string `json:"cert_san_uri,omitempty"`
	CertNotBefore         string `json:"cert_not_before,omitempty"`
	CertNotAfter          string `json:"cert_not_after,omitempty"`
}

// String redacts secret material so accidental logging never leaks credentials or keys.
func (id Identity) String() string {
	mode := id.AuthMode
	if mode == "" {
		if id.HasMTLS() {
			mode = "mtls"
		} else {
			mode = "bearer"
		}
	}
	return fmt.Sprintf(
		"Identity{ServerURL:%q, AgentID:%q, AuthMode:%q, CertSerial:%q, Credential:[REDACTED]}",
		id.ServerURL,
		id.AgentID,
		mode,
		id.CertSerial,
	)
}

// GoString implements fmt.GoStringer to prevent %#v from leaking secrets.
func (id Identity) GoString() string {
	return id.String()
}

// HasMTLS returns true if the identity is configured with mTLS client certificate and private key paths.
func (id *Identity) HasMTLS() bool {
	if id == nil {
		return false
	}
	return strings.TrimSpace(id.ClientCertPath) != "" &&
		strings.TrimSpace(id.ClientKeyPath) != "" &&
		strings.TrimSpace(id.CACertPath) != ""
}

// Validate checks that required fields are present for either mTLS or transitional Bearer mode.
func (id *Identity) Validate() error {
	if id == nil {
		return errors.New("identity is nil")
	}
	id.ServerURL = strings.TrimRight(strings.TrimSpace(id.ServerURL), "/")
	id.AgentID = strings.TrimSpace(id.AgentID)
	id.AuthMode = strings.TrimSpace(id.AuthMode)
	id.Credential = strings.TrimSpace(id.Credential)
	id.ClientCertPath = strings.TrimSpace(id.ClientCertPath)
	id.ClientKeyPath = strings.TrimSpace(id.ClientKeyPath)
	id.CACertPath = strings.TrimSpace(id.CACertPath)

	if id.ServerURL == "" {
		return errors.New("identity server_url is required")
	}
	if id.AgentID == "" {
		return errors.New("identity agent_id is required")
	}
	if !id.HasMTLS() && id.Credential == "" {
		return errors.New("identity requires either mTLS certificate paths or a credential")
	}
	if id.HasMTLS() && id.AuthMode == "" {
		id.AuthMode = "mtls"
	} else if id.AuthMode == "" {
		id.AuthMode = "bearer"
	}
	return nil
}

// GenerateKeyAndCSR generates a fresh ECDSA P-256 private key locally and creates a PKCS#10 CSR.
// The private key never leaves the agent host.
func GenerateKeyAndCSR(commonName string) (privateKeyPEM string, csrPEM string, err error) {
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate ECDSA P-256 key: %w", err)
	}

	cn := strings.TrimSpace(commonName)
	if cn == "" {
		cn = "infralab-agent"
	}

	csrTemplate := &x509.CertificateRequest{
		Subject: pkix.Name{
			Organization: []string{"InfraLab Agent"},
			CommonName:   cn,
		},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}

	csrDER, err := x509.CreateCertificateRequest(rand.Reader, csrTemplate, privKey)
	if err != nil {
		return "", "", fmt.Errorf("create certificate signing request: %w", err)
	}

	pkcs8Bytes, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		return "", "", fmt.Errorf("marshal PKCS#8 private key: %w", err)
	}

	keyBlock := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: pkcs8Bytes,
	}
	csrBlock := &pem.Block{
		Type:  "CERTIFICATE REQUEST",
		Bytes: csrDER,
	}

	return string(pem.EncodeToMemory(keyBlock)), string(pem.EncodeToMemory(csrBlock)), nil
}

// SaveMTLSFiles atomically writes the agent private key (0600), client certificate (0600), and CA certificate (0644).
func SaveMTLSFiles(dir, privateKeyPEM, clientCertPEM, caCertPEM string) (keyPath, certPath, caPath string, err error) {
	if strings.TrimSpace(dir) == "" {
		dir = filepath.Dir(DefaultIdentityPath)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", "", "", fmt.Errorf("create mTLS directory %s: %w", dir, err)
	}

	keyPath = filepath.Join(dir, DefaultClientKeyName)
	certPath = filepath.Join(dir, DefaultClientCertName)
	caPath = filepath.Join(dir, DefaultCACertName)

	if err := writeAtomicWithPerm(keyPath, []byte(privateKeyPEM), CredentialFilePerm); err != nil {
		return "", "", "", fmt.Errorf("save private key: %w", err)
	}
	if err := writeAtomicWithPerm(certPath, []byte(clientCertPEM), CredentialFilePerm); err != nil {
		return "", "", "", fmt.Errorf("save client certificate: %w", err)
	}
	if err := writeAtomicWithPerm(caPath, []byte(caCertPEM), PublicCertFilePerm); err != nil {
		return "", "", "", fmt.Errorf("save CA certificate: %w", err)
	}

	return keyPath, certPath, caPath, nil
}

// LoadTLSConfig loads and verifies the agent's client certificate, private key (checking 0600 permissions), and Root CA pool.
func (id *Identity) LoadTLSConfig() (*tls.Config, error) {
	if !id.HasMTLS() {
		return nil, errors.New("identity is not configured for mTLS")
	}

	// Enforce 0600 permissions on private key
	keyInfo, err := os.Stat(id.ClientKeyPath)
	if err != nil {
		return nil, fmt.Errorf("stat private key %s: %w", id.ClientKeyPath, err)
	}
	if keyInfo.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf(
			"private key file %s has insecure permissions %#o (expected 0600)",
			id.ClientKeyPath,
			keyInfo.Mode().Perm(),
		)
	}

	clientCert, err := tls.LoadX509KeyPair(id.ClientCertPath, id.ClientKeyPath)
	if err != nil {
		return nil, fmt.Errorf("load client keypair: %w", err)
	}

	caBytes, err := os.ReadFile(id.CACertPath)
	if err != nil {
		return nil, fmt.Errorf("read CA certificate %s: %w", id.CACertPath, err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caBytes) {
		return nil, errors.New("failed to parse CA certificate PEM")
	}

	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		RootCAs:      caPool,
		Certificates: []tls.Certificate{clientCert},
	}, nil
}

// NeedsRenewal returns true if the client certificate is approaching expiration.
func (id *Identity) NeedsRenewal(now time.Time, threshold time.Duration) bool {
	if id == nil || !id.HasMTLS() {
		return false
	}
	if threshold <= 0 {
		threshold = 12 * time.Hour
	}

	if id.CertNotAfter != "" {
		if exp, err := time.Parse(time.RFC3339, id.CertNotAfter); err == nil {
			if id.CertNotBefore != "" {
				if start, startErr := time.Parse(time.RFC3339, id.CertNotBefore); startErr == nil {
					total := exp.Sub(start)
					if total > 0 && total/3 > threshold {
						threshold = total / 3
					}
				}
			}
			return !now.Add(threshold).Before(exp)
		}
	}

	// Fallback: parse certificate file directly
	certPEM, err := os.ReadFile(id.ClientCertPath)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	total := cert.NotAfter.Sub(cert.NotBefore)
	if total > 0 && total/3 > threshold {
		threshold = total / 3
	}
	return !now.Add(threshold).Before(cert.NotAfter)
}

func writeAtomicWithPerm(path string, payload []byte, perm os.FileMode) error {
	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	if _, err := f.Write(payload); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := f.Chmod(perm); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return os.Chmod(path, perm)
}

// Save writes the identity file with strict 0600 permissions.
func Save(path string, id *Identity) error {
	if strings.TrimSpace(path) == "" {
		path = DefaultIdentityPath
	}
	if err := id.Validate(); err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create identity directory %s: %w", dir, err)
	}

	payload, err := json.MarshalIndent(id, "", "  ")
	if err != nil {
		return fmt.Errorf("encode identity: %w", err)
	}
	payload = append(payload, '\n')

	if err := writeAtomicWithPerm(path, payload, CredentialFilePerm); err != nil {
		return fmt.Errorf("write credential file %s: %w", path, err)
	}
	return nil
}

// Load reads the identity file and verifies that its permissions (and private key permissions) are no wider than 0600.
func Load(path string) (*Identity, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultIdentityPath
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat credential file %s: %w", path, err)
	}
	if info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("credential file %s has insecure permissions %#o (expected 0600)", path, info.Mode().Perm())
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read credential file %s: %w", path, err)
	}
	var id Identity
	if err := json.Unmarshal(raw, &id); err != nil {
		return nil, fmt.Errorf("decode credential file %s: %w", path, err)
	}
	if err := id.Validate(); err != nil {
		return nil, err
	}
	if id.HasMTLS() {
		keyInfo, err := os.Stat(id.ClientKeyPath)
		if err != nil {
			return nil, fmt.Errorf("stat private key file %s: %w", id.ClientKeyPath, err)
		}
		if keyInfo.Mode().Perm()&0077 != 0 {
			return nil, fmt.Errorf("private key file %s has insecure permissions %#o (expected 0600)", id.ClientKeyPath, keyInfo.Mode().Perm())
		}
	}
	return &id, nil
}
