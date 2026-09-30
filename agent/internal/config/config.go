package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultConfigPath        = "/etc/infralab-agent/config.json"
	DefaultHeartbeatInterval = 15 * time.Second
	DefaultMetricsListenAddr = ":9101"
)

// Config holds non-secret runtime settings for infralab-agent.
type Config struct {
	ServerURL            string `json:"server_url"`
	HeartbeatIntervalSec int    `json:"heartbeat_interval_sec,omitempty"`
	MetricsListenAddr    string `json:"metrics_listen_addr,omitempty"`
}

// ListenAddr returns the address for the Prometheus /metrics HTTP server, defaulting to :9101.
func (c *Config) ListenAddr() string {
	if c == nil || strings.TrimSpace(c.MetricsListenAddr) == "" {
		return DefaultMetricsListenAddr
	}
	return strings.TrimSpace(c.MetricsListenAddr)
}

// HeartbeatInterval returns the configured heartbeat duration, defaulting to 15s.
func (c *Config) HeartbeatInterval() time.Duration {
	if c == nil || c.HeartbeatIntervalSec <= 0 {
		return DefaultHeartbeatInterval
	}
	return time.Duration(c.HeartbeatIntervalSec) * time.Second
}

// Validate checks that ServerURL is a valid HTTP or HTTPS endpoint.
func (c *Config) Validate() error {
	if c == nil {
		return errors.New("config is nil")
	}
	raw := strings.TrimSpace(c.ServerURL)
	if raw == "" {
		return errors.New("server_url cannot be empty")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid server_url: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("server_url must start with https:// or http://")
	}
	if parsed.Host == "" {
		return errors.New("server_url host cannot be empty")
	}
	c.ServerURL = strings.TrimRight(raw, "/")
	if c.HeartbeatIntervalSec <= 0 {
		c.HeartbeatIntervalSec = int(DefaultHeartbeatInterval / time.Second)
	}
	return nil
}

// Load reads and validates the agent configuration from disk.
func Load(path string) (*Config, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultConfigPath
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("decode config %s: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Save writes the agent configuration atomically to disk with 0644 permissions.
func Save(path string, cfg *Config) error {
	if strings.TrimSpace(path) == "" {
		path = DefaultConfigPath
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create config directory %s: %w", dir, err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	data = append(data, '\n')
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("commit config %s: %w", path, err)
	}
	return nil
}
