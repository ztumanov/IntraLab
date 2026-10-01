package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
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

// ErrUnauthorized indicates that the agent authentication was rejected by InfraLab (HTTP 401/403).
var ErrUnauthorized = errors.New("agent authentication rejected (HTTP 401)")

type Client struct {
	mu          sync.RWMutex
	baseURL     string
	httpClient  *http.Client
	activeSerial string
}

func New(serverURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(serverURL), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// NewWithTLS creates a Client preconfigured with a custom *tls.Config (e.g. bootstrap CA trust).
func NewWithTLS(serverURL string, tlsCfg *tls.Config) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(serverURL), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: tlsCfg,
			},
		},
	}
}

// ConfigureMTLS loads the client X.509 keypair and Root CA from Identity into the HTTP transport.
func (c *Client) ConfigureMTLS(id *identity.Identity) error {
	if id == nil || !id.HasMTLS() {
		return nil
	}
	tlsCfg, err := id.LoadTLSConfig()
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.httpClient = &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: tlsCfg,
		},
	}
	c.activeSerial = id.CertSerial
	return nil
}

type EnrollRequest struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
	CSRPEM   string `json:"csr_pem,omitempty"`
}

type EnrollResponse struct {
	AgentID               string `json:"agent_id"`
	Credential            string `json:"credential,omitempty"`
	ServerID              int64  `json:"server_id"`
	AuthMode              string `json:"auth_mode,omitempty"`
	ClientCertPEM         string `json:"client_cert_pem,omitempty"`
	CACertPEM             string `json:"ca_cert_pem,omitempty"`
	CertSerial            string `json:"cert_serial,omitempty"`
	CertFingerprintSHA256 string `json:"cert_fingerprint_sha256,omitempty"`
	CertSANURI            string `json:"cert_san_uri,omitempty"`
	CertNotBefore         string `json:"cert_not_before,omitempty"`
	CertNotAfter          string `json:"cert_not_after,omitempty"`
}

type RenewRequest struct {
	CSRPEM string `json:"csr_pem"`
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

// Enroll exchanges a one-time enrollment token for an agent identity (legacy Bearer or mTLS).
func (c *Client) Enroll(ctx context.Context, token, hostname, version string) (*EnrollResponse, error) {
	return c.EnrollWithCSR(ctx, token, hostname, version, "")
}

// EnrollWithCSR exchanges a one-time enrollment token and locally generated CSR for a signed X.509 client certificate.
func (c *Client) EnrollWithCSR(ctx context.Context, token, hostname, version, csrPEM string) (*EnrollResponse, error) {
	reqBody := EnrollRequest{
		Token:    strings.TrimSpace(token),
		Hostname: strings.TrimSpace(hostname),
		Version:  strings.TrimSpace(version),
		CSRPEM:   strings.TrimSpace(csrPEM),
	}
	var out EnrollResponse
	if err := c.postJSON(ctx, "/api/agents/enroll", nil, reqBody, &out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.AgentID) == "" {
		return nil, errors.New("enrollment response missing agent_id")
	}
	hasMTLS := strings.TrimSpace(out.ClientCertPEM) != "" && strings.TrimSpace(out.CACertPEM) != ""
	hasBearer := strings.TrimSpace(out.Credential) != ""
	if !hasMTLS && !hasBearer {
		return nil, errors.New("enrollment response missing client certificate or credential")
	}
	return &out, nil
}

// RenewCertificate submits a fresh CSR over an authenticated mTLS connection to rotate the client certificate before expiry.
func (c *Client) RenewCertificate(ctx context.Context, id *identity.Identity, csrPEM string) (*EnrollResponse, error) {
	reqBody := RenewRequest{
		CSRPEM: strings.TrimSpace(csrPEM),
	}
	var out EnrollResponse
	if err := c.postJSON(ctx, "/api/agents/renew", id, reqBody, &out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.ClientCertPEM) == "" {
		return nil, errors.New("renewal response missing client_cert_pem")
	}
	return &out, nil
}

// SendHeartbeat sends an mTLS-authenticated (or transitional Bearer) heartbeat to update last_seen_at.
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

func (c *Client) getHTTPClient(id *identity.Identity) (*http.Client, error) {
	if id != nil && id.HasMTLS() {
		c.mu.RLock()
		_, hasCustomTransport := c.httpClient.Transport.(*http.Transport)
		sameSerial := c.activeSerial == id.CertSerial && hasCustomTransport
		c.mu.RUnlock()

		if !sameSerial {
			if err := c.ConfigureMTLS(id); err != nil {
				return nil, err
			}
		}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.httpClient, nil
}

func (c *Client) postJSON(
	ctx context.Context,
	endpoint string,
	id *identity.Identity,
	payload any,
	dest any,
) error {
	httpClient, err := c.getHTTPClient(id)
	if err != nil {
		return fmt.Errorf("configure mTLS client: %w", err)
	}

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
		if !id.HasMTLS() && strings.TrimSpace(id.Credential) != "" {
			req.Header.Set("Authorization", "Bearer "+id.Credential)
		}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request %s failed: %w", endpoint, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
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
