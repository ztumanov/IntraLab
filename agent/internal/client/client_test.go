package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		_, _ = w.Write([]byte(`{"agent_id":"agt_test1","credential":"ila_cred_secret1","server_id":7}`))
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

	res, err := c.Enroll(ctx, "ila_enroll_valid", "node-01", "0.1.0")
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

	if err := c.SendHeartbeat(ctx, id, "0.1.0", "node-01"); err != nil {
		t.Fatalf("SendHeartbeat failed: %v", err)
	}
	if !heartbeatReceived {
		t.Fatal("expected heartbeat to be recorded")
	}

	if err := c.SendSystemInfo(ctx, id, "0.1.0", system.Info{
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
