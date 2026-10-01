package client

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
	"github.com/infralab/infralab/agent/internal/system"
)

func TestBackoffScheduleMatchesSpecification(t *testing.T) {
	expected := []time.Duration{
		1 * time.Second,
		2 * time.Second,
		4 * time.Second,
		8 * time.Second,
		16 * time.Second,
		30 * time.Second,
		60 * time.Second,
		60 * time.Second, // clamped at 60s
	}

	for i, want := range expected {
		got := BackoffDelay(i)
		if got != want {
			t.Errorf("attempt %d: expected backoff %v, got %v", i, want, got)
		}
	}
}

func TestEnrollHeartbeatAndSystemInfoFlow(t *testing.T) {
	var enrolled bool
	var heartbeatReceived bool
	var sysInfoReceived bool

	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/enroll", func(w http.ResponseWriter, r *http.Request) {
		var req EnrollRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Token != "ila_enroll_valid" {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		enrolled = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent_id":"agt_test1","credential":"ila_cred_secret1","server_id":7,"auth_mode":"bearer"}`))
	})

	mux.HandleFunc("/api/agents/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Agent-ID") != "agt_test1" || r.Header.Get("Authorization") != "Bearer ila_cred_secret1" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		heartbeatReceived = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("/api/agents/system-info", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Agent-ID") != "agt_test1" || r.Header.Get("Authorization") != "Bearer ila_cred_secret1" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		sysInfoReceived = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New(srv.URL)
	ctx := context.Background()

	res, err := c.Enroll(ctx, "ila_enroll_valid", "node-01", "0.2.0")
	if err != nil {
		t.Fatalf("Enroll failed: %v", err)
	}
	if !enrolled || res.AgentID != "agt_test1" || res.Credential != "ila_cred_secret1" {
		t.Fatalf("unexpected enroll result: %+v", res)
	}

	id := &identity.Identity{
		ServerURL:  srv.URL,
		AgentID:    res.AgentID,
		Credential: res.Credential,
	}

	if err := c.SendHeartbeat(ctx, id, "0.2.0", "node-01"); err != nil {
		t.Fatalf("SendHeartbeat failed: %v", err)
	}
	if !heartbeatReceived {
		t.Fatal("expected heartbeat to be recorded")
	}

	if err := c.SendSystemInfo(ctx, id, "0.2.0", system.Info{
		Hostname:       "node-01",
		OSDistribution: "Ubuntu 24.04 LTS",
		Kernel:         "6.8.0",
		Architecture:   "amd64",
		CPUCount:       4,
		RAMTotalBytes:  8589934592,
		UptimeSeconds:  3600,
	}); err != nil {
		t.Fatalf("SendSystemInfo failed: %v", err)
	}
	if !sysInfoReceived {
		t.Fatal("expected system info to be recorded")
	}
}

func TestMTLSRejectsMissingOrRevokedCertificate(t *testing.T) {
	// Create internal Root CA
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	now := time.Now().UTC()
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(10),
		Subject:               pkix.Name{CommonName: "InfraLab Root CA"},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	caPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}))
	caPool := x509.NewCertPool()
	caPool.AddCert(caCert)

	// Server TLS certificate
	srvKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	srvTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(11),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    now.Add(-5 * time.Minute),
		NotAfter:     now.Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	srvDER, _ := x509.CreateCertificate(rand.Reader, srvTmpl, caCert, &srvKey.PublicKey, caKey)
	srvKeyDER, _ := x509.MarshalPKCS8PrivateKey(srvKey)
	srvCert, _ := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srvDER}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: srvKeyDER}),
	)

	revoked := false
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 || revoked {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	srv.TLS = &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{srvCert},
		ClientCAs:    caPool,
		ClientAuth:   tls.VerifyClientCertIfGiven,
	}
	srv.StartTLS()
	defer srv.Close()

	// Generate client key & CSR and sign with CA
	privPEM, csrPEM, err := identity.GenerateKeyAndCSR("agt_mtls_1")
	if err != nil {
		t.Fatalf("GenerateKeyAndCSR: %v", err)
	}
	csrBlock, _ := pem.Decode([]byte(csrPEM))
	csr, _ := x509.ParseCertificateRequest(csrBlock.Bytes)
	spiffe := &url.URL{Scheme: "spiffe", Host: "infralab", Path: "/agent/agt_mtls_1"}
	clientTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(100),
		Subject:      pkix.Name{CommonName: "agt_mtls_1"},
		URIs:         []*url.URL{spiffe},
		NotBefore:    now.Add(-1 * time.Minute),
		NotAfter:     now.Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientDER, _ := x509.CreateCertificate(rand.Reader, clientTmpl, caCert, csr.PublicKey, caKey)
	clientPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: clientDER}))

	tmpDir := t.TempDir()
	keyPath, certPath, caPath, err := identity.SaveMTLSFiles(tmpDir, privPEM, clientPEM, caPEM)
	if err != nil {
		t.Fatalf("SaveMTLSFiles: %v", err)
	}

	id := &identity.Identity{
		ServerURL:      srv.URL,
		AgentID:        "agt_mtls_1",
		AuthMode:       "mtls",
		ClientKeyPath:  keyPath,
		ClientCertPath: certPath,
		CACertPath:     caPath,
		CertSerial:     "64",
	}
	credFile := filepath.Join(tmpDir, "credentials.json")
	if err := identity.Save(credFile, id); err != nil {
		t.Fatalf("identity.Save: %v", err)
	}

	c := New(srv.URL)
	if err := c.SendHeartbeat(context.Background(), id, "0.2.0", "node-mtls"); err != nil {
		t.Fatalf("expected valid mTLS heartbeat to succeed, got: %v", err)
	}

	// Revoke certificate and verify 401 ErrUnauthorized
	revoked = true
	err = c.SendHeartbeat(context.Background(), id, "0.2.0", "node-mtls")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized after revocation, got: %v", err)
	}
}
