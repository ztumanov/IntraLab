package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
	"github.com/infralab/infralab/agent/internal/system"
)

// BackoffSchedule defines the required retry delays on connection failure:
// 1s → 2s → 4s → 8s → 16s → 30s → 60s.
var BackoffSchedule = []time.Duration{
	1 * time.Second,
	2 * time.Second,
	4 * time.Second,
	8 * time.Second,
	16 * time.Second,
	30 * time.Second,
	60 * time.Second,
}

// BackoffDelay returns the retry delay for a given consecutive failure count (0-indexed).
func BackoffDelay(attempt int) time.Duration {
	if attempt <= 0 {
		return BackoffSchedule[0]
	}
	if attempt >= len(BackoffSchedule) {
		return BackoffSchedule[len(BackoffSchedule)-1]
	}
	return BackoffSchedule[attempt]
}

// ErrUnauthorized indicates that the agent credential was rejected by InfraLab (HTTP 401).
var ErrUnauthorized = errors.New("agent authentication rejected (HTTP 401)")

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(serverURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(serverURL), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type EnrollRequest struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
}

type EnrollResponse struct {
	AgentID    string `json:"agent_id"`
	Credential string `json:"credential"`
	ServerID   int64  `json:"server_id"`
}

type HeartbeatRequest struct {
	AgentID  string `json:"agent_id"`
	Version  string `json:"version"`
	Hostname string `json:"hostname,omitempty"`
}

type SystemInfoPayload struct {
	AgentID        string `json:"agent_id"`
	Version        string `json:"version"`
	Hostname       string `json:"hostname"`
	OSDistribution string `json:"os_distribution"`
	Kernel         string `json:"kernel"`
	Architecture   string `json:"architecture"`
	CPUCount       int    `json:"cpu_count"`
	RAMTotalBytes  uint64 `json:"ram_total_bytes"`
	UptimeSeconds  uint64 `json:"uptime_seconds"`
}

// Enroll exchanges a one-time enrollment token for a permanent agent ID and credential.
func (c *Client) Enroll(ctx context.Context, token, hostname, version string) (*EnrollResponse, error) {
	reqBody := EnrollRequest{
		Token:    strings.TrimSpace(token),
		Hostname: strings.TrimSpace(hostname),
		Version:  strings.TrimSpace(version),
	}
	var out EnrollResponse
	if err := c.postJSON(ctx, "/api/agents/enroll", nil, reqBody, &out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.AgentID) == "" || strings.TrimSpace(out.Credential) == "" {
		return nil, errors.New("enrollment response missing agent_id or credential")
	}
	return &out, nil
}

// SendHeartbeat sends an authenticated heartbeat to update last_seen_at.
func (c *Client) SendHeartbeat(ctx context.Context, id *identity.Identity, version, hostname string) error {
	payload := HeartbeatRequest{
		AgentID:  id.AgentID,
		Version:  version,
		Hostname: hostname,
	}
	return c.postJSON(ctx, "/api/agents/heartbeat", id, payload, nil)
}

// SendSystemInfo sends authenticated host hardware and OS details to InfraLab.
func (c *Client) SendSystemInfo(ctx context.Context, id *identity.Identity, version string, info system.Info) error {
	payload := SystemInfoPayload{
		AgentID:        id.AgentID,
		Version:        version,
		Hostname:       info.Hostname,
		OSDistribution: info.OSDistribution,
		Kernel:         info.Kernel,
		Architecture:   info.Architecture,
		CPUCount:       info.CPUCount,
		RAMTotalBytes:  info.RAMTotalBytes,
		UptimeSeconds:  info.UptimeSeconds,
	}
	return c.postJSON(ctx, "/api/agents/system-info", id, payload, nil)
}

func (c *Client) postJSON(
	ctx context.Context,
	endpoint string,
	id *identity.Identity,
	payload any,
	dest any,
) error {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode request body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build request %s: %w", endpoint, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	if id != nil {
		req.Header.Set("X-Agent-ID", id.AgentID)
		req.Header.Set("Authorization", "Bearer "+id.Credential)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request %s failed: %w", endpoint, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	if resp.StatusCode == http.StatusUnauthorized {
		return ErrUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected HTTP %d from %s: %s", resp.StatusCode, endpoint, strings.TrimSpace(string(respBody)))
	}

	if dest != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, dest); err != nil {
			return fmt.Errorf("decode response from %s: %w", endpoint, err)
		}
	}
	return nil
}
