package config

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSaveAndLoadConfig(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.json")

	cfg := &Config{
		ServerURL: "https://infralab.example/",
	}
	if err := Save(cfgPath, cfg); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	loaded, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if loaded.ServerURL != "https://infralab.example" {
		t.Errorf("expected trailing slash trimmed, got %q", loaded.ServerURL)
	}
	if loaded.HeartbeatInterval() != 15*time.Second {
		t.Errorf("expected 15s default heartbeat interval, got %v", loaded.HeartbeatInterval())
	}
}

func TestValidateRejectsInvalidURL(t *testing.T) {
	invalid := &Config{ServerURL: "ftp://bad.example"}
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected error for unsupported scheme")
	}
}
