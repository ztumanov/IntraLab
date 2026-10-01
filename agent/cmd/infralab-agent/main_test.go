package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
)

type testPKI struct {
	caCert    *x509.Certificate
	caKey     *ecdsa.PrivateKey
	caCertPEM string
	caPool    *x509.CertPool
	srvCert   tls.Certificate
}

func newTestPKI(t *testing.T) *testPKI {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}
	now := time.Now().UTC()
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{Organization: []string{"InfraLab"}, CommonName: "InfraLab Test Root CA"},
		NotBefore:             now.Add(-10 * time.Minute),
		NotAfter:              now.Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create CA cert: %v", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatalf("parse CA cert: %v", err)
	}
	caPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}))
	pool := x509.NewCertPool()
	pool.AddCert(caCert)

	// Issue server certificate for 127.0.0.1 / localhost
	srvKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}
	srvTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
		NotBefore:    now.Add(-10 * time.Minute),
		NotAfter:     now.Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	srvDER, err := x509.CreateCertificate(rand.Reader, srvTmpl, caCert, &srvKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create server cert: %v", err)
	}
	srvKeyDER, _ := x509.MarshalPKCS8PrivateKey(srvKey)
	srvCert, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srvDER}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: srvKeyDER}),
	)
	if err != nil {
		t.Fatalf("load server keypair: %v", err)
	}

	return &testPKI{
		caCert:    caCert,
		caKey:     caKey,
		caCertPEM: caPEM,
		caPool:    pool,
		srvCert:   srvCert,
	}
}

func (p *testPKI) signCSR(t *testing.T, csrPEM string, agentID string, serial int64, ttl time.Duration) (certPEM, serialHex, fpHex, notBefore, notAfter string) {
	t.Helper()
	block, _ := pem.Decode([]byte(csrPEM))
	if block == nil {
		t.Fatal("failed to decode CSR PEM")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("parse CSR: %v", err)
	}
	if err := csr.CheckSignature(); err != nil {
		t.Fatalf("invalid CSR signature: %v", err)
	}

	now := time.Now().UTC()
	nb := now.Add(-1 * time.Minute)
	na := now.Add(ttl)
	spiffe := &url.URL{Scheme: "spiffe", Host: "infralab", Path: "/agent/" + agentID}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(serial),
		Subject:               pkix.Name{Organization: []string{"InfraLab Agent"}, CommonName: agentID},
		URIs:                  []*url.URL{spiffe},
		NotBefore:             nb,
		NotAfter:              na,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, p.caCert, csr.PublicKey, p.caKey)
	if err != nil {
		t.Fatalf("sign client cert: %v", err)
	}
	sum := sha256.Sum256(der)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		strings.ToUpper(big.NewInt(serial).Text(16)),
		hex.EncodeToString(sum[:]),
		nb.Format(time.RFC3339),
		na.Format(time.RFC3339)
}

func TestVersionCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := runCLI(context.Background(), []string{"version"}, &stdout, &stderr)
	if err != nil {
		t.Fatalf("version command failed: %v", err)
	}
	if !strings.Contains(stdout.String(), "infralab-agent v"+Version) {
		t.Fatalf("unexpected version output: %q", stdout.String())
	}
}

func TestMTLSEnrollRenewAndRunEndToEnd(t *testing.T) {
	pki := newTestPKI(t)

	var enrolled atomic.Bool
	var renewed atomic.Bool
	var heartbeats atomic.Int32
	var sysInfoReceived atomic.Int32
	var activeSerial atomic.Value

	const issuedAgentID = "agt_mtls_e2e_01"
	const expectedSPIFFE = "spiffe://infralab/agent/" + issuedAgentID

	verifyClient := func(r *http.Request) bool {
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			return false
		}
		leaf := r.TLS.PeerCertificates[0]
		if _, err := leaf.Verify(x509.VerifyOptions{
			Roots:     pki.caPool,
			KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		}); err != nil {
			return false
		}
		if len(leaf.URIs) == 0 || leaf.URIs[0].String() != expectedSPIFFE {
			return false
		}
		curSerial, _ := activeSerial.Load().(string)
		return strings.ToUpper(leaf.SerialNumber.Text(16)) == curSerial
	}

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agents/enroll":
			var req map[string]string
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req["token"] != "one-time-mtls-token" || strings.TrimSpace(req["csr_pem"]) == "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			// Ensure private key was NEVER sent in enrollment request
			if strings.Contains(req["csr_pem"], "PRIVATE KEY") {
				t.Error("private key must never be sent to backend")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			// Issue initial certificate with short TTL (2h) so renewal triggers immediately (< 12h threshold)
			certPEM, serialHex, fpHex, nb, na := pki.signCSR(t, req["csr_pem"], issuedAgentID, 1001, 2*time.Hour)
			activeSerial.Store(serialHex)
			enrolled.Store(true)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"agent_id":                issuedAgentID,
				"server_id":               1,
				"auth_mode":               "mtls",
				"client_cert_pem":         certPEM,
				"ca_cert_pem":             pki.caCertPEM,
				"cert_serial":             serialHex,
				"cert_fingerprint_sha256": fpHex,
				"cert_san_uri":            expectedSPIFFE,
				"cert_not_before":         nb,
				"cert_not_after":          na,
			})

		case "/api/agents/renew":
			if !verifyClient(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			var req map[string]string
			_ = json.NewDecoder(r.Body).Decode(&req)
			certPEM, serialHex, fpHex, nb, na := pki.signCSR(t, req["csr_pem"], issuedAgentID, 1002, 72*time.Hour)
			activeSerial.Store(serialHex)
			renewed.Store(true)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"agent_id":                issuedAgentID,
				"server_id":               1,
				"auth_mode":               "mtls",
				"client_cert_pem":         certPEM,
				"ca_cert_pem":             pki.caCertPEM,
				"cert_serial":             serialHex,
				"cert_fingerprint_sha256": fpHex,
				"cert_san_uri":            expectedSPIFFE,
				"cert_not_before":         nb,
				"cert_not_after":          na,
			})

		case "/api/agents/heartbeat":
			if !verifyClient(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			heartbeats.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","auth_mode":"mtls"}`))

		case "/api/agents/system-info":
			if !verifyClient(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			sysInfoReceived.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","auth_mode":"mtls"}`))

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	srv.TLS = &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{pki.srvCert},
		ClientCAs:    pki.caPool,
		ClientAuth:   tls.VerifyClientCertIfGiven,
	}
	srv.StartTLS()
	defer srv.Close()

	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.json")
	credPath := filepath.Join(tmpDir, "credentials.json")
	bootstrapCAPath := filepath.Join(tmpDir, "bootstrap-ca.crt")
	if err := os.WriteFile(bootstrapCAPath, []byte(pki.caCertPEM), 0644); err != nil {
		t.Fatalf("write bootstrap CA: %v", err)
	}

	var enrollOut, enrollErr bytes.Buffer
	err := runCLI(
		context.Background(),
		[]string{
			"enroll",
			"--server", srv.URL,
			"--token", "one-time-mtls-token",
			"--config", cfgPath,
			"--credentials", credPath,
			"--ca-cert", bootstrapCAPath,
		},
		&enrollOut,
		&enrollErr,
	)
	if err != nil {
		t.Fatalf("mTLS enroll command failed: %v (stderr: %s)", err, enrollErr.String())
	}
	if !enrolled.Load() {
		t.Fatal("expected enrollment endpoint to be called")
	}

	// Verify 0600 permissions on both credentials.json and agent.key
	for _, secretFile := range []string{credPath, filepath.Join(tmpDir, identity.DefaultClientKeyName)} {
		stat, statErr := os.Stat(secretFile)
		if statErr != nil {
			t.Fatalf("stat %s: %v", secretFile, statErr)
		}
		if stat.Mode().Perm() != identity.CredentialFilePerm {
			t.Fatalf("expected %s mode 0600, got %#o", secretFile, stat.Mode().Perm())
		}
	}

	// Ensure private key and token never leaked into CLI output
	if strings.Contains(enrollOut.String(), "PRIVATE KEY") || strings.Contains(enrollOut.String(), "one-time-mtls-token") {
		t.Fatal("secret material leaked into CLI output")
	}

	// Run daemon briefly: it should auto-renew the short-lived cert, then send mTLS heartbeat and system-info
	runCtx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	var runOut, runErr bytes.Buffer
	if err := runCLI(
		runCtx,
		[]string{"run", "--config", cfgPath, "--credentials", credPath, "--listen-addr", "127.0.0.1:0"},
		&runOut,
		&runErr,
	); err != nil {
		t.Fatalf("run command returned error on context cancel: %v", err)
	}

	if !renewed.Load() {
		t.Fatal("expected short-lived client certificate to be automatically renewed via /api/agents/renew")
	}
	if heartbeats.Load() < 1 {
		t.Fatalf("expected at least 1 mTLS heartbeat, got %d", heartbeats.Load())
	}
	if sysInfoReceived.Load() < 1 {
		t.Fatalf("expected at least 1 mTLS system-info report, got %d", sysInfoReceived.Load())
	}
	if strings.Contains(runOut.String(), "PRIVATE KEY") {
		t.Fatal("private key leaked into daemon logs")
	}
}
