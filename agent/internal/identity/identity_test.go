package identity

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveEnforces0600AndRedactsString(t *testing.T) {
	tmpDir := t.TempDir()
	credPath := filepath.Join(tmpDir, "credentials.json")

	ident := &Identity{
		ServerURL:  "https://infralab.example",
		AgentID:    "agt_123456",
		Credential: "ila_cred_super_secret_value",
	}

	if err := Save(credPath, ident); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	stat, err := os.Stat(credPath)
	if err != nil {
		t.Fatalf("Stat failed: %v", err)
	}
	if stat.Mode().Perm() != 0600 {
		t.Fatalf("expected file mode 0600, got %#o", stat.Mode().Perm())
	}

	if strings.Contains(ident.String(), "ila_cred_super_secret_value") {
		t.Fatal("Identity.String() leaked secret credential")
	}
	if strings.Contains(ident.GoString(), "ila_cred_super_secret_value") {
		t.Fatal("Identity.GoString() leaked secret credential")
	}

	loaded, err := Load(credPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if loaded.AgentID != "agt_123456" || loaded.Credential != "ila_cred_super_secret_value" {
		t.Fatalf("unexpected loaded identity: %+v", loaded)
	}
}

func TestSaveMTLSFilesEnforcesPermissionsAndLeavesNoTempFiles(t *testing.T) {
	baseDir := t.TempDir()
	pkiDir := filepath.Join(baseDir, "infralab-pki")

	privPEM, csrPEM, err := GenerateKeyAndCSR("agt_audit_01")
	if err != nil {
		t.Fatalf("GenerateKeyAndCSR failed: %v", err)
	}
	if strings.Contains(csrPEM, "PRIVATE KEY") {
		t.Fatal("CSR must never contain private key")
	}

	keyPath, certPath, caPath, err := SaveMTLSFiles(pkiDir, privPEM, "-----BEGIN CERTIFICATE-----\ndummy\n-----END CERTIFICATE-----\n", "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n")
	if err != nil {
		t.Fatalf("SaveMTLSFiles failed: %v", err)
	}

	dirStat, err := os.Stat(pkiDir)
	if err != nil {
		t.Fatalf("Stat pkiDir: %v", err)
	}
	if dirStat.Mode().Perm() != 0700 {
		t.Fatalf("expected directory mode 0700, got %#o", dirStat.Mode().Perm())
	}

	keyStat, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("Stat keyPath: %v", err)
	}
	if keyStat.Mode().Perm() != 0600 {
		t.Fatalf("expected private key mode 0600, got %#o", keyStat.Mode().Perm())
	}

	certStat, err := os.Stat(certPath)
	if err != nil {
		t.Fatalf("Stat certPath: %v", err)
	}
	if certStat.Mode().Perm() != 0600 {
		t.Fatalf("expected client cert mode 0600, got %#o", certStat.Mode().Perm())
	}

	caStat, err := os.Stat(caPath)
	if err != nil {
		t.Fatalf("Stat caPath: %v", err)
	}
	if caStat.Mode().Perm() != 0644 {
		t.Fatalf("expected CA cert mode 0644, got %#o", caStat.Mode().Perm())
	}

	// Ensure no .tmp or backup files exist in pkiDir
	entries, err := os.ReadDir(pkiDir)
	if err != nil {
		t.Fatalf("ReadDir pkiDir: %v", err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") || strings.HasSuffix(entry.Name(), ".bak") {
			t.Fatalf("unexpected temporary/backup file left in PKI directory: %s", entry.Name())
		}
	}

	// Verify Load rejects insecure private key permissions (e.g. 0644)
	credPath := filepath.Join(pkiDir, "credentials.json")
	ident := &Identity{
		ServerURL:      "https://infralab.example",
		AgentID:        "agt_audit_01",
		AuthMode:       "mtls",
		ClientKeyPath:  keyPath,
		ClientCertPath: certPath,
		CACertPath:     caPath,
	}
	if err := Save(credPath, ident); err != nil {
		t.Fatalf("Save identity: %v", err)
	}
	if err := os.Chmod(keyPath, 0644); err != nil {
		t.Fatalf("Chmod 0644: %v", err)
	}
	if _, err := Load(credPath); err == nil {
		t.Fatal("expected Load to reject private key with 0644 permissions")
	}
	if _, err := ident.LoadTLSConfig(); err == nil {
		t.Fatal("expected LoadTLSConfig to reject private key with 0644 permissions")
	}
	_ = tls.VersionTLS12
}

