package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/infralab/infralab/agent/internal/client"
	"github.com/infralab/infralab/agent/internal/config"
	"github.com/infralab/infralab/agent/internal/identity"
	"github.com/infralab/infralab/agent/internal/logstream"
	"github.com/infralab/infralab/agent/internal/metrics"
	"github.com/infralab/infralab/agent/internal/system"
)

const Version = "0.2.0"

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := runCLI(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "infralab-agent error: %v\n", err)
		os.Exit(1)
	}
}

func runCLI(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		printUsage(stderr)
		return errors.New("subcommand required (enroll | run | version)")
	}

	switch args[0] {
	case "version", "--version", "-v":
		fmt.Fprintf(stdout, "infralab-agent v%s\n", Version)
		return nil

	case "enroll":
		return runEnrollCmd(ctx, args[1:], stdout, stderr)

	case "run":
		return runDaemonCmd(ctx, args[1:], stdout, stderr)

	case "help", "--help", "-h":
		printUsage(stdout)
		return nil

	default:
		printUsage(stderr)
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  infralab-agent enroll --server https://infralab.example --token <TOKEN> [--ca-cert /path/to/ca.crt]")
	fmt.Fprintln(w, "  infralab-agent run [--listen-addr :9101]")
	fmt.Fprintln(w, "  infralab-agent version")
}

func buildBootstrapClient(serverURL, caCertPath string) (*client.Client, error) {
	if strings.TrimSpace(caCertPath) == "" {
		return client.New(serverURL), nil
	}
	caBytes, err := os.ReadFile(caCertPath)
	if err != nil {
		return nil, fmt.Errorf("read bootstrap CA cert %s: %w", caCertPath, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, fmt.Errorf("invalid bootstrap CA PEM in %s", caCertPath)
	}
	return client.NewWithTLS(serverURL, &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    pool,
	}), nil
}

func runEnrollCmd(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("enroll", flag.ContinueOnError)
	fs.SetOutput(stderr)

	serverURL := fs.String("server", "", "InfraLab server URL (e.g. https://infralab.example)")
	token := fs.String("token", "", "One-time agent enrollment token")
	listenAddr := fs.String("listen-addr", config.DefaultMetricsListenAddr, "Prometheus /metrics HTTP listen address")
	configPath := fs.String("config", config.DefaultConfigPath, "Path to agent config file")
	identityPath := fs.String("credentials", identity.DefaultIdentityPath, "Path to agent credentials file (0600)")
	caCertFlag := fs.String("ca-cert", "", "Optional bootstrap Root CA certificate path for HTTPS enrollment")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if strings.TrimSpace(*serverURL) == "" {
		return errors.New("--server is required")
	}
	if strings.TrimSpace(*token) == "" {
		return errors.New("--token is required")
	}

	cfg := &config.Config{
		ServerURL:            strings.TrimSpace(*serverURL),
		HeartbeatIntervalSec: int(config.DefaultHeartbeatInterval / time.Second),
		MetricsListenAddr:    strings.TrimSpace(*listenAddr),
	}
	if err := cfg.Validate(); err != nil {
		return err
	}

	collector := system.NewCollector()
	sysInfo := collector.Collect()

	// Generate private key and CSR locally on the Agent; private key never leaves the Agent.
	privKeyPEM, csrPEM, err := identity.GenerateKeyAndCSR(sysInfo.Hostname)
	if err != nil {
		return fmt.Errorf("generate agent keypair and CSR: %w", err)
	}

	apiClient, err := buildBootstrapClient(cfg.ServerURL, *caCertFlag)
	if err != nil {
		return err
	}

	enrollResp, err := apiClient.EnrollWithCSR(ctx, *token, sysInfo.Hostname, Version, csrPEM)
	if err != nil {
		return fmt.Errorf("enrollment failed: %w", err)
	}

	if err := config.Save(*configPath, cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	id := &identity.Identity{
		ServerURL:  cfg.ServerURL,
		AgentID:    enrollResp.AgentID,
		AuthMode:   enrollResp.AuthMode,
		Credential: enrollResp.Credential,
	}

	if strings.TrimSpace(enrollResp.ClientCertPEM) != "" && strings.TrimSpace(enrollResp.CACertPEM) != "" {
		pkiDir := filepath.Dir(*identityPath)
		keyPath, certPath, caPath, saveErr := identity.SaveMTLSFiles(
			pkiDir,
			privKeyPEM,
			enrollResp.ClientCertPEM,
			enrollResp.CACertPEM,
		)
		if saveErr != nil {
			return fmt.Errorf("save mTLS certificates: %w", saveErr)
		}
		id.AuthMode = "mtls"
		id.ClientKeyPath = keyPath
		id.ClientCertPath = certPath
		id.CACertPath = caPath
		id.CertSerial = enrollResp.CertSerial
		id.CertFingerprintSHA256 = enrollResp.CertFingerprintSHA256
		id.CertSANURI = enrollResp.CertSANURI
		id.CertNotBefore = enrollResp.CertNotBefore
		id.CertNotAfter = enrollResp.CertNotAfter
	}

	if err := identity.Save(*identityPath, id); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	// Never log or print the private key, credential, or enrollment token.
	fmt.Fprintf(
		stdout,
		"Successfully enrolled agent %s with %s (mode=%s, credentials stored at %s with mode 0600)\n",
		id.AgentID,
		cfg.ServerURL,
		id.AuthMode,
		*identityPath,
	)
	return nil
}

func runDaemonCmd(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	fs.SetOutput(stderr)

	configPath := fs.String("config", config.DefaultConfigPath, "Path to agent config file")
	identityPath := fs.String("credentials", identity.DefaultIdentityPath, "Path to agent credentials file")
	listenAddrFlag := fs.String("listen-addr", "", "Override Prometheus /metrics HTTP listen address (default :9101)")

	if err := fs.Parse(args); err != nil {
		return err
	}

	logger := log.New(stdout, "[infralab-agent] ", log.LstdFlags|log.LUTC)

	// 1. Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// 2. Load identity
	id, err := identity.Load(*identityPath)
	if err != nil {
		return fmt.Errorf("load identity: %w", err)
	}

	listenAddr := cfg.ListenAddr()
	if strings.TrimSpace(*listenAddrFlag) != "" {
		listenAddr = strings.TrimSpace(*listenAddrFlag)
	}

	apiClient := client.New(cfg.ServerURL)
	if id.HasMTLS() {
		if err := apiClient.ConfigureMTLS(id); err != nil {
			return fmt.Errorf("configure mTLS transport: %w", err)
		}
	}
	collector := system.NewCollector()

	// Start Prometheus /metrics HTTP exporter server
	exporter := metrics.NewExporter(collector, id.AgentID, Version)
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("listen prometheus metrics on %s: %w", listenAddr, err)
	}
	metricsSrv := &http.Server{
		Handler:           exporter.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	go func() {
		logger.Printf("serving Prometheus /metrics on http://%s/metrics", ln.Addr().String())
		if serveErr := metricsSrv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			logger.Printf("prometheus metrics server error: %v", serveErr)
		}
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = metricsSrv.Shutdown(shutdownCtx)
	}()

	// Start persistent mTLS log streaming control & event session
	streamSession := logstream.NewAgentStreamSession(cfg.ServerURL, id, nil, logger)
	go streamSession.RunLoop(ctx)

	logger.Printf("starting daemon v%s for agent_id=%s auth_mode=%s server=%s", Version, id.AgentID, id.AuthMode, cfg.ServerURL)
	return runAgentLoop(ctx, logger, apiClient, collector, id, *identityPath, cfg.HeartbeatInterval())
}

func maybeRenewCertificate(
	ctx context.Context,
	logger *log.Logger,
	apiClient *client.Client,
	id *identity.Identity,
	identityPath string,
) {
	if id == nil || !id.HasMTLS() {
		return
	}
	if !id.NeedsRenewal(time.Now().UTC(), 12*time.Hour) {
		return
	}

	privKeyPEM, csrPEM, err := identity.GenerateKeyAndCSR(id.AgentID)
	if err != nil {
		logger.Printf("certificate renewal CSR generation failed: %v", err)
		return
	}

	renewed, err := apiClient.RenewCertificate(ctx, id, csrPEM)
	if err != nil {
		logger.Printf("certificate renewal request failed: %v", err)
		return
	}

	caPEM := renewed.CACertPEM
	if strings.TrimSpace(caPEM) == "" && id.CACertPath != "" {
		if existingCA, readErr := os.ReadFile(id.CACertPath); readErr == nil {
			caPEM = string(existingCA)
		}
	}

	pkiDir := filepath.Dir(identityPath)
	keyPath, certPath, caPath, err := identity.SaveMTLSFiles(pkiDir, privKeyPEM, renewed.ClientCertPEM, caPEM)
	if err != nil {
		logger.Printf("failed to save renewed mTLS certificate files: %v", err)
		return
	}

	id.ClientKeyPath = keyPath
	id.ClientCertPath = certPath
	id.CACertPath = caPath
	id.CertSerial = renewed.CertSerial
	id.CertFingerprintSHA256 = renewed.CertFingerprintSHA256
	id.CertSANURI = renewed.CertSANURI
	id.CertNotBefore = renewed.CertNotBefore
	id.CertNotAfter = renewed.CertNotAfter

	if err := identity.Save(identityPath, id); err != nil {
		logger.Printf("failed to save updated identity metadata: %v", err)
		return
	}
	if err := apiClient.ConfigureMTLS(id); err != nil {
		logger.Printf("failed to reload mTLS client configuration: %v", err)
		return
	}
	logger.Printf("renewed mTLS client certificate for agent_id=%s serial=%s", id.AgentID, id.CertSerial)
}

func runAgentLoop(
	ctx context.Context,
	logger *log.Logger,
	apiClient *client.Client,
	collector *system.Collector,
	id *identity.Identity,
	identityPath string,
	heartbeatInterval time.Duration,
) error {
	if heartbeatInterval <= 0 {
		heartbeatInterval = config.DefaultHeartbeatInterval
	}

	failureCount := 0
	sentInitialSystemInfo := false

	syncOnce := func() error {
		maybeRenewCertificate(ctx, logger, apiClient, id, identityPath)

		info := collector.Collect()

		// Authenticate & send heartbeat
		if err := apiClient.SendHeartbeat(ctx, id, Version, info.Hostname); err != nil {
			return err
		}

		// Send system info on initial startup or immediately after reconnecting from an outage
		if !sentInitialSystemInfo || failureCount > 0 {
			if err := apiClient.SendSystemInfo(ctx, id, Version, info); err != nil {
				return err
			}
			sentInitialSystemInfo = true
		}
		return nil
	}

	// Initial connection & sync with exponential backoff on unavailability
	for {
		if ctx.Err() != nil {
			logger.Printf("shutting down gracefully (%v)", ctx.Err())
			return nil
		}

		err := syncOnce()
		if err == nil {
			if failureCount > 0 {
				logger.Printf("connection to InfraLab restored after %d attempt(s)", failureCount)
			} else {
				logger.Printf("authenticated with InfraLab; initial heartbeat and system-info sent")
			}
			failureCount = 0
			break
		}

		delay := client.BackoffDelay(failureCount)
		failureCount++
		logger.Printf("sync failed (attempt %d): %v — retrying in %s", failureCount, err, delay)

		select {
		case <-ctx.Done():
			logger.Printf("shutting down gracefully (%v)", ctx.Err())
			return nil
		case <-time.After(delay):
		}
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Printf("received termination signal, shutting down gracefully")
			return nil

		case <-ticker.C:
			err := syncOnce()
			if err == nil {
				if failureCount > 0 {
					logger.Printf("connection to InfraLab restored; resuming %s heartbeat schedule", heartbeatInterval)
					failureCount = 0
				}
				continue
			}

			// Enter exponential backoff recovery loop (1s → 2s → 4s → 8s → 16s → 30s → 60s)
			for err != nil {
				delay := client.BackoffDelay(failureCount)
				failureCount++
				logger.Printf("heartbeat failed (attempt %d): %v — backing off for %s", failureCount, err, delay)

				select {
				case <-ctx.Done():
					logger.Printf("received termination signal during backoff, shutting down gracefully")
					return nil
				case <-time.After(delay):
				}

				err = syncOnce()
			}

			logger.Printf("connection to InfraLab restored after %d attempt(s); resuming normal heartbeat", failureCount)
			failureCount = 0
		}
	}
}
