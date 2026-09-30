package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/infralab/infralab/agent/internal/client"
	"github.com/infralab/infralab/agent/internal/config"
	"github.com/infralab/infralab/agent/internal/identity"
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
	fmt.Fprintln(w, "  infralab-agent enroll --server https://infralab.example --token <TOKEN>")
	fmt.Fprintln(w, "  infralab-agent run [--listen-addr :9101]")
	fmt.Fprintln(w, "  infralab-agent version")
}

func runEnrollCmd(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("enroll", flag.ContinueOnError)
	fs.SetOutput(stderr)

	serverURL := fs.String("server", "", "InfraLab server URL (e.g. https://infralab.example)")
	token := fs.String("token", "", "One-time agent enrollment token")
	listenAddr := fs.String("listen-addr", config.DefaultMetricsListenAddr, "Prometheus /metrics HTTP listen address")
	configPath := fs.String("config", config.DefaultConfigPath, "Path to agent config file")
	identityPath := fs.String("credentials", identity.DefaultIdentityPath, "Path to agent credentials file (0600)")

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

	apiClient := client.New(cfg.ServerURL)
	enrollResp, err := apiClient.Enroll(ctx, *token, sysInfo.Hostname, Version)
	if err != nil {
		return fmt.Errorf("enrollment failed: %w", err)
	}

	if err := config.Save(*configPath, cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	id := &identity.Identity{
		ServerURL:  cfg.ServerURL,
		AgentID:    enrollResp.AgentID,
		Credential: enrollResp.Credential,
	}
	if err := identity.Save(*identityPath, id); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	// Never log or print the credential or enrollment token.
	fmt.Fprintf(
		stdout,
		"Successfully enrolled agent %s with %s (credentials stored at %s with mode 0600)\n",
		id.AgentID,
		cfg.ServerURL,
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

	logger.Printf("starting daemon v%s for agent_id=%s server=%s", Version, id.AgentID, cfg.ServerURL)
	return runAgentLoop(ctx, logger, apiClient, collector, id, cfg.HeartbeatInterval())
}

func runAgentLoop(
	ctx context.Context,
	logger *log.Logger,
	apiClient *client.Client,
	collector *system.Collector,
	id *identity.Identity,
	heartbeatInterval time.Duration,
) error {
	if heartbeatInterval <= 0 {
		heartbeatInterval = config.DefaultHeartbeatInterval
	}

	failureCount := 0
	sentInitialSystemInfo := false

	syncOnce := func() error {
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
