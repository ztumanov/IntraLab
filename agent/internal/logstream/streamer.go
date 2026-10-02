package logstream

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const MaxLogMessageBytes = 16384

var (
	validContainerIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	validUnitNamePattern    = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}$`)
	validSincePattern       = regexp.MustCompile(`^[a-zA-Z0-9:._\-\s+]{1,64}$`)
	validPriorities         = map[string]string{
		"0": "0", "emerg": "emerg",
		"1": "1", "alert": "alert",
		"2": "2", "crit": "crit",
		"3": "3", "err": "err", "error": "err",
		"4": "4", "warning": "warning", "warn": "warning",
		"5": "5", "notice": "notice",
		"6": "6", "info": "info",
		"7": "7", "debug": "debug",
	}
)

// ErrInvalidContainerID is returned when a container ID or name fails validation.
var ErrInvalidContainerID = errors.New("invalid container ID or name")

// ErrInvalidUnitName is returned when a systemd unit name fails validation.
var ErrInvalidUnitName = errors.New("invalid systemd unit name")

// ErrInvalidPriority is returned when a journal priority filter fails validation.
var ErrInvalidPriority = errors.New("invalid journal priority filter")

// ErrInvalidSince is returned when a since timestamp filter fails validation.
var ErrInvalidSince = errors.New("invalid since filter")

// ErrInvalidSource is returned when an unsupported log source is requested.
var ErrInvalidSource = errors.New("unsupported log source")

// LogEvent represents a unified real-time log event emitted by infralab-agent.
type LogEvent struct {
	Timestamp     string `json:"timestamp"`
	ServerID      int64  `json:"server_id,omitempty"`
	AgentID       string `json:"agent_id"`
	Source        string `json:"source"` // "journal" | "docker"
	ContainerID   string `json:"container_id,omitempty"`
	ContainerName string `json:"container_name,omitempty"`
	Unit          string `json:"unit,omitempty"`
	Stream        string `json:"stream,omitempty"` // "stdout" | "stderr"
	Level         string `json:"level,omitempty"`  // "info" | "warn" | "error"
	Message       string `json:"message"`
}

// StreamRequest describes the parameters for starting or changing a log stream.
type StreamRequest struct {
	StreamID      string `json:"stream_id"`
	Source        string `json:"source"` // "journal" | "journald" | "auth" | "kernel" | "docker"
	Unit          string `json:"unit,omitempty"`
	Priority      string `json:"priority,omitempty"`
	Since         string `json:"since,omitempty"`
	ContainerID   string `json:"container_id,omitempty"`
	ContainerName string `json:"container_name,omitempty"`
	Tail          int    `json:"tail,omitempty"`
}

// ValidateContainerID strictly validates a Docker container ID or name to prevent flag or command injection.
func ValidateContainerID(containerID string) error {
	clean := strings.TrimSpace(containerID)
	if clean == "" || strings.HasPrefix(clean, "-") || strings.Contains(clean, "..") {
		return ErrInvalidContainerID
	}
	if !validContainerIDPattern.MatchString(clean) {
		return ErrInvalidContainerID
	}
	return nil
}

// ValidateUnitName strictly validates a systemd unit name to prevent flag or command injection.
func ValidateUnitName(unit string) error {
	clean := strings.TrimSpace(unit)
	if clean == "" {
		return nil
	}
	if strings.HasPrefix(clean, "-") || strings.Contains(clean, "..") || !validUnitNamePattern.MatchString(clean) {
		return ErrInvalidUnitName
	}
	return nil
}

// ValidatePriority validates a journalctl priority value.
func ValidatePriority(priority string) (string, error) {
	clean := strings.ToLower(strings.TrimSpace(priority))
	if clean == "" || clean == "all" {
		return "", nil
	}
	mapped, ok := validPriorities[clean]
	if !ok {
		return "", ErrInvalidPriority
	}
	return mapped, nil
}

// ValidateSince validates a timestamp or relative time string for journalctl --since / docker logs --since.
func ValidateSince(since string) error {
	clean := strings.TrimSpace(since)
	if clean == "" {
		return nil
	}
	if strings.HasPrefix(clean, "-") || !validSincePattern.MatchString(clean) {
		return ErrInvalidSince
	}
	return nil
}

// TruncateMessage bounds a log line to MaxLogMessageBytes to prevent memory exhaustion on huge lines.
func TruncateMessage(msg string) string {
	if len(msg) <= MaxLogMessageBytes {
		return msg
	}
	excess := len(msg) - MaxLogMessageBytes
	return fmt.Sprintf("%s... [truncated %d bytes]", msg[:MaxLogMessageBytes], excess)
}

// ClassifyLevel infers severity level ("error", "warn", "info") from a log message.
func ClassifyLevel(msg, stream string) string {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "error") ||
		strings.Contains(lower, "failed") ||
		strings.Contains(lower, "fatal") ||
		strings.Contains(lower, "panic") ||
		strings.Contains(lower, "crit") ||
		strings.Contains(lower, "denied") ||
		strings.Contains(lower, "invalid user") {
		return "error"
	}
	if strings.Contains(lower, "warn") ||
		strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "retry") ||
		strings.Contains(lower, "deprecated") {
		return "warn"
	}
	if stream == "stderr" && strings.TrimSpace(msg) != "" {
		if strings.Contains(lower, "err") {
			return "error"
		}
	}
	return "info"
}

// ParseJournalLine extracts timestamp, unit, and message from a journalctl short-iso line.
func ParseJournalLine(raw string, defaultUnit string) (timestamp, unit, message string) {
	trimmed := strings.TrimRight(raw, "\r\n")
	if trimmed == "" {
		return time.Now().UTC().Format(time.RFC3339), defaultUnit, ""
	}

	// Format: 2026-10-01T12:00:00+0000 hostname unit[pid]: message
	fields := strings.Fields(trimmed)
	if len(fields) >= 4 {
		first := fields[0]
		if len(first) >= 19 && (first[4] == '-' && first[7] == '-') {
			ts := first
			if parsed, err := time.Parse("2006-01-02T15:04:05-0700", first); err == nil {
				ts = parsed.UTC().Format(time.RFC3339)
			} else if parsed, err := time.Parse(time.RFC3339, first); err == nil {
				ts = parsed.UTC().Format(time.RFC3339)
			}
			restAfterHost := strings.TrimSpace(trimmed[len(fields[0]):])
			hostToken := fields[1]
			if strings.HasPrefix(restAfterHost, hostToken) {
				afterHost := strings.TrimSpace(restAfterHost[len(hostToken):])
				if colonIdx := strings.Index(afterHost, ":"); colonIdx > 0 && colonIdx < 80 {
					rawUnit := strings.TrimSpace(afterHost[:colonIdx])
					if bracketIdx := strings.Index(rawUnit, "["); bracketIdx > 0 {
						rawUnit = rawUnit[:bracketIdx]
					}
					msg := strings.TrimSpace(afterHost[colonIdx+1:])
					if msg == "" {
						msg = trimmed
					}
					return ts, rawUnit, TruncateMessage(msg)
				}
			}
		}
	}

	return time.Now().UTC().Format(time.RFC3339), defaultUnit, TruncateMessage(trimmed)
}

// ParseDockerLine extracts optional RFC3339 timestamp prefix from `docker logs --timestamps`.
func ParseDockerLine(raw string) (timestamp, message string) {
	trimmed := strings.TrimRight(raw, "\r\n")
	if trimmed == "" {
		return time.Now().UTC().Format(time.RFC3339), ""
	}
	if spaceIdx := strings.IndexByte(trimmed, ' '); spaceIdx > 0 && spaceIdx <= 35 {
		candidate := trimmed[:spaceIdx]
		if parsed, err := time.Parse(time.RFC3339Nano, candidate); err == nil {
			return parsed.UTC().Format(time.RFC3339Nano), TruncateMessage(strings.TrimSpace(trimmed[spaceIdx+1:]))
		}
		if parsed, err := time.Parse(time.RFC3339, candidate); err == nil {
			return parsed.UTC().Format(time.RFC3339), TruncateMessage(strings.TrimSpace(trimmed[spaceIdx+1:]))
		}
	}
	return time.Now().UTC().Format(time.RFC3339), TruncateMessage(trimmed)
}

// CommandFactory constructs an *exec.Cmd without a shell. Can be overridden in tests.
type CommandFactory func(ctx context.Context, name string, args ...string) *exec.Cmd

// DefaultCommandFactory creates a standard exec.CommandContext without shell interpolation.
func DefaultCommandFactory(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// BuildCommandArgs builds the binary name and discrete argument list for a StreamRequest.
// It never uses a shell and strictly validates all user-supplied fields.
func BuildCommandArgs(req StreamRequest) (bin string, args []string, normalizedSource string, unitLabel string, err error) {
	tail := req.Tail
	if tail <= 0 {
		tail = 50
	}
	if tail > 500 {
		tail = 500
	}
	tailStr := strconv.Itoa(tail)

	normPriority, err := ValidatePriority(req.Priority)
	if err != nil {
		return "", nil, "", "", err
	}
	if err := ValidateSince(req.Since); err != nil {
		return "", nil, "", "", err
	}
	cleanSince := strings.TrimSpace(req.Since)

	source := strings.ToLower(strings.TrimSpace(req.Source))
	switch source {
	case "docker":
		if strings.TrimSpace(req.ContainerID) != "" {
			if err := ValidateContainerID(req.ContainerID); err != nil {
				return "", nil, "", "", err
			}
			cleanID := strings.TrimSpace(req.ContainerID)
			dArgs := []string{"logs", "--follow", "--timestamps", "--tail", tailStr}
			if cleanSince != "" {
				dArgs = append(dArgs, "--since", cleanSince)
			}
			dArgs = append(dArgs, cleanID)
			return "docker", dArgs, "docker", "", nil
		}
		jArgs := []string{
			"-u", "docker",
			"-u", "docker.service",
			"-n", tailStr,
			"-f",
			"--no-pager",
			"-o", "short-iso",
		}
		if normPriority != "" {
			jArgs = append(jArgs, "-p", normPriority)
		}
		if cleanSince != "" {
			jArgs = append(jArgs, "--since", cleanSince)
		}
		return "journalctl", jArgs, "journal", "docker.service", nil

	case "journal", "journald", "":
		if err := ValidateUnitName(req.Unit); err != nil {
			return "", nil, "", "", err
		}
		cleanUnit := strings.TrimSpace(req.Unit)
		jArgs := []string{"-n", tailStr, "-f", "--no-pager", "-o", "short-iso"}
		if cleanUnit != "" {
			jArgs = append([]string{"-u", cleanUnit}, jArgs...)
		}
		if normPriority != "" {
			jArgs = append(jArgs, "-p", normPriority)
		}
		if cleanSince != "" {
			jArgs = append(jArgs, "--since", cleanSince)
		}
		return "journalctl", jArgs, "journal", cleanUnit, nil

	case "auth":
		jArgs := []string{
			"-u", "ssh",
			"-u", "sshd",
			"-n", tailStr,
			"-f",
			"--no-pager",
			"-o", "short-iso",
		}
		if normPriority != "" {
			jArgs = append(jArgs, "-p", normPriority)
		}
		if cleanSince != "" {
			jArgs = append(jArgs, "--since", cleanSince)
		}
		return "journalctl", jArgs, "journal", "sshd", nil

	case "kernel":
		jArgs := []string{
			"-k",
			"-n", tailStr,
			"-f",
			"--no-pager",
			"-o", "short-iso",
		}
		if normPriority != "" {
			jArgs = append(jArgs, "-p", normPriority)
		}
		if cleanSince != "" {
			jArgs = append(jArgs, "--since", cleanSince)
		}
		return "journalctl", jArgs, "journal", "kernel", nil

	default:
		return "", nil, "", "", fmt.Errorf("%w: %s", ErrInvalidSource, req.Source)
	}
}

// readBoundedLine reads a full line from br, capping stored bytes at MaxLogMessageBytes*2
// while discarding any remaining bytes until newline so oversized lines never abort the stream.
func readBoundedLine(br *bufio.Reader) (string, error) {
	var buf []byte
	var discarded int
	for {
		chunk, isPrefix, err := br.ReadLine()
		if len(chunk) > 0 {
			if len(buf) < MaxLogMessageBytes*2 {
				remaining := MaxLogMessageBytes*2 - len(buf)
				if len(chunk) > remaining {
					buf = append(buf, chunk[:remaining]...)
					discarded += len(chunk) - remaining
				} else {
					buf = append(buf, chunk...)
				}
			} else {
				discarded += len(chunk)
			}
		}
		if !isPrefix {
			if err != nil && len(buf) == 0 {
				return "", err
			}
			line := string(buf)
			if discarded > 0 {
				line = TruncateMessage(line)
			}
			return line, nil
		}
		if err != nil {
			if len(buf) > 0 {
				return TruncateMessage(string(buf)), nil
			}
			return "", err
		}
	}
}

// Runner executes and manages real-time log streaming subprocesses safely.
type Runner struct {
	AgentID    string
	CmdFactory CommandFactory
}

// NewRunner creates a new log stream Runner for the given AgentID.
func NewRunner(agentID string) *Runner {
	return &Runner{
		AgentID:    agentID,
		CmdFactory: DefaultCommandFactory,
	}
}

// Stream runs the underlying journalctl or docker logs command until ctx is canceled or the process exits,
// invoking onEvent for each parsed log line.
func (r *Runner) Stream(ctx context.Context, req StreamRequest, onEvent func(LogEvent)) error {
	bin, args, normSource, defaultUnit, err := BuildCommandArgs(req)
	if err != nil {
		return err
	}

	factory := r.CmdFactory
	if factory == nil {
		factory = DefaultCommandFactory
	}

	cmd := factory(ctx, bin, args...)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		_ = stdoutPipe.Close()
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = stdoutPipe.Close()
		_ = stderrPipe.Close()
		return fmt.Errorf("start %s: %w", bin, err)
	}

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				_ = cmd.Process.Signal(syscall.SIGTERM)
				select {
				case <-done:
				case <-time.After(500 * time.Millisecond):
					_ = cmd.Process.Kill()
				}
			}
		case <-done:
		}
	}()

	var wg sync.WaitGroup
	wg.Add(2)

	readPipe := func(pipe io.ReadCloser, streamName string) {
		defer wg.Done()
		br := bufio.NewReaderSize(pipe, 64*1024)

		for {
			rawLine, readErr := readBoundedLine(br)
			if strings.TrimSpace(rawLine) != "" {
				var ev LogEvent
				ev.AgentID = r.AgentID
				ev.Source = normSource
				ev.Stream = streamName

				if normSource == "docker" {
					ts, msg := ParseDockerLine(rawLine)
					ev.Timestamp = ts
					ev.Message = msg
					ev.ContainerID = strings.TrimSpace(req.ContainerID)
					ev.ContainerName = strings.TrimSpace(req.ContainerName)
					if ev.ContainerName == "" {
						ev.ContainerName = ev.ContainerID
					}
					ev.Level = ClassifyLevel(msg, streamName)
				} else {
					ts, unit, msg := ParseJournalLine(rawLine, defaultUnit)
					ev.Timestamp = ts
					ev.Unit = unit
					ev.Message = msg
					ev.Level = ClassifyLevel(msg, streamName)
				}

				select {
				case <-ctx.Done():
					return
				default:
					onEvent(ev)
				}
			}
			if readErr != nil {
				return
			}
		}
	}

	go readPipe(stdoutPipe, "stdout")
	go readPipe(stderrPipe, "stderr")

	wg.Wait()
	_ = stdoutPipe.Close()
	_ = stderrPipe.Close()
	waitErr := cmd.Wait()
	close(done)

	if ctx.Err() != nil {
		return nil
	}
	return waitErr
}
