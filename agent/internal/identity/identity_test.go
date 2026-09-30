package identity

import (
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

	loaded, err := Load(credPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if loaded.AgentID != "agt_123456" || loaded.Credential != "ila_cred_super_secret_value" {
		t.Fatalf("unexpected loaded identity: %+v", loaded)
	}
}
