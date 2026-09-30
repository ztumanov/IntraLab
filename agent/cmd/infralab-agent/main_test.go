package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
)

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

func TestEnrollAndRunEndToEnd(t *testing.T) {
	var enrolled atomic.Bool
	var heartbeats atomic.Int32
	var sysInfoReceived atomic.Int32

	const issuedAgentID = "agt_e2e_999"
	const issuedSecret = "ila_secret_super_confidential_value"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agents/enroll":
			var req map[string]string
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req["token"] != "one-time-token-xyz" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			enrolled.Store(true)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"agent_id":   issuedAgentID,
				"credential": issuedSecret,
				"server_id":  1,
			})

		case "/api/agents/heartbeat":
			if r.Header.Get("X-Agent-ID") != issuedAgentID ||
				r.Header.Get("Authorization") != "Bearer "+issuedSecret {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			heartbeats.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))

		case "/api/agents/system-info":
			if r.Header.Get("X-Agent-ID") != issuedAgentID ||
				r.Header.Get("Authorization") != "Bearer "+issuedSecret {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			sysInfoReceived.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.json")
	credPath := filepath.Join(tmpDir, "credentials.json")

	var enrollOut, enrollErr bytes.Buffer
	err := runCLI(
		context.Background(),
		[]string{
			"enroll",
			"--server", srv.URL,
			"--token", "one-time-token-xyz",
			"--config", cfgPath,
			"--credentials", credPath,
		},
		&enrollOut,
		&enrollErr,
	)
	if err != nil {
		t.Fatalf("enroll command failed: %v (stderr: %s)", err, enrollErr.String())
	}
	if !enrolled.Load() {
		t.Fatal("expected enrollment endpoint to be called")
	}

	// Ensure secret credential never leaked to stdout/stderr
	if strings.Contains(enrollOut.String(), issuedSecret) || strings.Contains(enrollErr.String(), issuedSecret) {
		t.Fatal("credential leaked into CLI output")
	}

	// Verify 0600 file mode on credentials.json
	stat, err := os.Stat(credPath)
	if err != nil {
		t.Fatalf("stat credentials: %v", err)
	}
	if stat.Mode().Perm() != identity.CredentialFilePerm {
		t.Fatalf("expected credentials mode 0600, got %#o", stat.Mode().Perm())
	}

	// Run daemon briefly and verify initial heartbeat + system-info + graceful shutdown
	runCtx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
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

	if heartbeats.Load() < 1 {
		t.Fatalf("expected at least 1 heartbeat, got %d", heartbeats.Load())
	}
	if sysInfoReceived.Load() < 1 {
		t.Fatalf("expected at least 1 system-info report, got %d", sysInfoReceived.Load())
	}
	if strings.Contains(runOut.String(), issuedSecret) {
		t.Fatal("credential leaked into daemon logs")
	}
}
