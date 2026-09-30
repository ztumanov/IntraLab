package identity

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultIdentityPath = "/etc/infralab-agent/credentials.json"
	CredentialFilePerm  = os.FileMode(0600)
)

// Identity stores the enrolled agent's permanent authentication material.
// Note: Credential must never be printed in logs via String() or GoString().
type Identity struct {
	ServerURL  string `json:"server_url"`
	AgentID    string `json:"agent_id"`
	Credential string `json:"credential"`
}

// String redacts the secret credential so accidental logging never leaks it.
func (id Identity) String() string {
	return fmt.Sprintf("Identity{ServerURL:%q, AgentID:%q, Credential:[REDACTED]}", id.ServerURL, id.AgentID)
}

// Validate checks that required fields are present.
func (id *Identity) Validate() error {
	if id == nil {
		return errors.New("identity is nil")
	}
	id.ServerURL = strings.TrimRight(strings.TrimSpace(id.ServerURL), "/")
	id.AgentID = strings.TrimSpace(id.AgentID)
	id.Credential = strings.TrimSpace(id.Credential)

	if id.ServerURL == "" {
		return errors.New("identity server_url is required")
	}
	if id.AgentID == "" {
		return errors.New("identity agent_id is required")
	}
	if id.Credential == "" {
		return errors.New("identity credential is required")
	}
	return nil
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

	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, CredentialFilePerm)
	if err != nil {
		return fmt.Errorf("open temp credential file: %w", err)
	}
	if _, err := f.Write(payload); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write credential file: %w", err)
	}
	if err := f.Chmod(CredentialFilePerm); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("chmod 0600 credential file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close credential file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("commit credential file %s: %w", path, err)
	}
	if err := os.Chmod(path, CredentialFilePerm); err != nil {
		return fmt.Errorf("enforce 0600 on %s: %w", path, err)
	}
	return nil
}

// Load reads the identity file and verifies that its permissions are no wider than 0600.
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
	return &id, nil
}
