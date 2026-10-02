package logstream

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/infralab/infralab/agent/internal/identity"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// ControlMessage represents a command sent from InfraLab Backend to the Agent over the mTLS WebSocket.
type ControlMessage struct {
	Type          string `json:"type"` // "start_stream" | "stop_stream" | "change_source" | "disconnect_stream" | "ping"
	StreamID      string `json:"stream_id,omitempty"`
	Source        string `json:"source,omitempty"`
	Unit          string `json:"unit,omitempty"`
	Priority      string `json:"priority,omitempty"`
	Since         string `json:"since,omitempty"`
	ContainerID   string `json:"container_id,omitempty"`
	ContainerName string `json:"container_name,omitempty"`
	Tail          int    `json:"tail,omitempty"`
}

// OutgoingFrame represents a message sent from the Agent to the InfraLab Backend over the mTLS WebSocket.
type OutgoingFrame struct {
	Type     string    `json:"type"` // "log_event" | "stream_status" | "pong" | "hello"
	StreamID string    `json:"stream_id,omitempty"`
	Status   string    `json:"status,omitempty"`
	Message  string    `json:"message,omitempty"`
	AgentID  string    `json:"agent_id,omitempty"`
	Event    *LogEvent `json:"event,omitempty"`
}

type activeStream struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// AgentStreamSession manages the persistent mTLS WebSocket connection and active log streams.
type AgentStreamSession struct {
	ServerURL    string
	Identity     *identity.Identity
	Runner       *Runner
	Logger       *log.Logger
	ExtraHeaders map[string]string
	TLSConfig    *tls.Config

	mu      sync.Mutex
	streams map[string]*activeStream
}

// NewAgentStreamSession creates a new persistent log stream session manager for the Agent.
func NewAgentStreamSession(serverURL string, id *identity.Identity, runner *Runner, logger *log.Logger) *AgentStreamSession {
	if runner == nil {
		agentID := ""
		if id != nil {
			agentID = id.AgentID
		}
		runner = NewRunner(agentID)
	}
	return &AgentStreamSession{
		ServerURL: strings.TrimRight(strings.TrimSpace(serverURL), "/"),
		Identity:  id,
		Runner:    runner,
		Logger:    logger,
		streams:   make(map[string]*activeStream),
	}
}

// RunLoop maintains the persistent mTLS WebSocket connection with automatic reconnect backoff.
func (s *AgentStreamSession) RunLoop(ctx context.Context) {
	attempt := 0
	for {
		if ctx.Err() != nil {
			s.stopAllStreams()
			return
		}

		err := s.ConnectAndServe(ctx)
		s.stopAllStreams()

		if ctx.Err() != nil {
			return
		}

		delay := time.Duration(1<<minInt(attempt, 5)) * time.Second
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		attempt++
		if s.Logger != nil && attempt == 1 {
			s.Logger.Printf("log stream control channel disconnected (%v); reconnecting in %s", err, delay)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ConnectAndServe dials a single WebSocket session to /api/agents/logs/ws and processes control commands until closed.
func (s *AgentStreamSession) ConnectAndServe(ctx context.Context) error {
	conn, br, err := s.dialWebSocket(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	wsConn := &rfc6455ClientConn{
		conn: conn,
		br:   br,
	}

	// Send initial hello frame
	agentID := ""
	if s.Identity != nil {
		agentID = s.Identity.AgentID
	}
	_ = wsConn.WriteJSON(OutgoingFrame{
		Type:    "hello",
		AgentID: agentID,
		Status:  "ready",
	})

	// Close connection when context is canceled
	connDone := make(chan struct{})
	defer close(connDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-connDone:
		}
	}()

	for {
		opcode, payload, err := wsConn.ReadFrame()
		if err != nil {
			return err
		}
		if opcode == 0x8 { // Close frame
			return nil
		}
		if opcode == 0x9 { // Ping frame
			_ = wsConn.writeControlFrame(0xA, payload)
			continue
		}
		if opcode != 0x1 && opcode != 0x2 {
			continue
		}

		var ctrl ControlMessage
		if err := json.Unmarshal(payload, &ctrl); err != nil {
			continue
		}
		s.handleControlMessage(ctx, wsConn, ctrl)
	}
}

func (s *AgentStreamSession) handleControlMessage(ctx context.Context, wsConn *rfc6455ClientConn, ctrl ControlMessage) {
	switch ctrl.Type {
	case "ping":
		_ = wsConn.WriteJSON(OutgoingFrame{
			Type: "pong",
		})

	case "start_stream", "change_source":
		streamID := strings.TrimSpace(ctrl.StreamID)
		if streamID == "" {
			streamID = "default"
		}
		s.stopStream(streamID)

		req := StreamRequest{
			StreamID:      streamID,
			Source:        ctrl.Source,
			Unit:          ctrl.Unit,
			Priority:      ctrl.Priority,
			Since:         ctrl.Since,
			ContainerID:   ctrl.ContainerID,
			ContainerName: ctrl.ContainerName,
			Tail:          ctrl.Tail,
		}

		// Validate upfront before spawning goroutine
		if _, _, _, _, err := BuildCommandArgs(req); err != nil {
			_ = wsConn.WriteJSON(OutgoingFrame{
				Type:     "stream_status",
				StreamID: streamID,
				Status:   "error",
				Message:  err.Error(),
			})
			return
		}

		streamCtx, cancel := context.WithCancel(ctx)
		doneCh := make(chan struct{})
		active := &activeStream{
			cancel: cancel,
			done:   doneCh,
		}

		s.mu.Lock()
		s.streams[streamID] = active
		s.mu.Unlock()

		_ = wsConn.WriteJSON(OutgoingFrame{
			Type:     "stream_status",
			StreamID: streamID,
			Status:   "streaming",
			Message:  fmt.Sprintf("streaming source=%s", req.Source),
		})

		go func() {
			defer func() {
				cancel()
				close(doneCh)
				s.mu.Lock()
				if s.streams[streamID] == active {
					delete(s.streams, streamID)
				}
				s.mu.Unlock()
			}()
			err := s.Runner.Stream(streamCtx, req, func(ev LogEvent) {
				evCopy := ev
				_ = wsConn.WriteJSON(OutgoingFrame{
					Type:     "log_event",
					StreamID: streamID,
					Event:    &evCopy,
				})
			})
			if err != nil && streamCtx.Err() == nil {
				_ = wsConn.WriteJSON(OutgoingFrame{
					Type:     "stream_status",
					StreamID: streamID,
					Status:   "error",
					Message:  err.Error(),
				})
			} else {
				_ = wsConn.WriteJSON(OutgoingFrame{
					Type:     "stream_status",
					StreamID: streamID,
					Status:   "stopped",
				})
			}
		}()

	case "stop_stream", "disconnect_stream":
		streamID := strings.TrimSpace(ctrl.StreamID)
		if streamID == "" {
			s.stopAllStreams()
		} else {
			s.stopStream(streamID)
		}
		_ = wsConn.WriteJSON(OutgoingFrame{
			Type:     "stream_status",
			StreamID: streamID,
			Status:   "stopped",
		})
	}
}

func (s *AgentStreamSession) stopStream(streamID string) {
	s.mu.Lock()
	active, ok := s.streams[streamID]
	if ok {
		delete(s.streams, streamID)
	}
	s.mu.Unlock()

	if ok && active != nil {
		active.cancel()
		select {
		case <-active.done:
		case <-time.After(1500 * time.Millisecond):
		}
	}
}

func (s *AgentStreamSession) stopAllStreams() {
	s.mu.Lock()
	current := make([]*activeStream, 0, len(s.streams))
	for k, v := range s.streams {
		current = append(current, v)
		delete(s.streams, k)
	}
	s.mu.Unlock()

	for _, st := range current {
		if st != nil {
			st.cancel()
		}
	}
	for _, st := range current {
		if st != nil {
			select {
			case <-st.done:
			case <-time.After(1500 * time.Millisecond):
			}
		}
	}
}

func (s *AgentStreamSession) dialWebSocket(ctx context.Context) (net.Conn, *bufio.Reader, error) {
	u, err := url.Parse(s.ServerURL)
	if err != nil {
		return nil, nil, fmt.Errorf("parse server URL: %w", err)
	}

	isTLS := u.Scheme == "https" || u.Scheme == "wss"
	host := u.Host
	if !strings.Contains(host, ":") {
		if isTLS {
			host += ":443"
		} else {
			host += ":80"
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	if isTLS {
		tlsCfg := s.TLSConfig
		if tlsCfg == nil && s.Identity != nil && s.Identity.HasMTLS() {
			tlsCfg, err = s.Identity.LoadTLSConfig()
			if err != nil {
				return nil, nil, fmt.Errorf("load mTLS config for websocket: %w", err)
			}
		}
		if tlsCfg == nil {
			tlsCfg = &tls.Config{MinVersion: tls.VersionTLS12}
		} else {
			tlsCfg = tlsCfg.Clone()
		}
		if tlsCfg.ServerName == "" {
			h, _, splitErr := net.SplitHostPort(host)
			if splitErr == nil {
				tlsCfg.ServerName = h
			}
		}
		conn, err = tls.DialWithDialer(dialer, "tcp", host, tlsCfg)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", host)
	}
	if err != nil {
		return nil, nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	keyBytes := make([]byte, 16)
	_, _ = rand.Read(keyBytes)
	wsKey := base64.StdEncoding.EncodeToString(keyBytes)

	path := "/api/agents/logs/ws"
	var reqBuilder strings.Builder
	reqBuilder.WriteString(fmt.Sprintf("GET %s HTTP/1.1\r\n", path))
	reqBuilder.WriteString(fmt.Sprintf("Host: %s\r\n", u.Host))
	reqBuilder.WriteString("Upgrade: websocket\r\n")
	reqBuilder.WriteString("Connection: Upgrade\r\n")
	reqBuilder.WriteString(fmt.Sprintf("Sec-WebSocket-Key: %s\r\n", wsKey))
	reqBuilder.WriteString("Sec-WebSocket-Version: 13\r\n")

	if s.Identity != nil {
		reqBuilder.WriteString(fmt.Sprintf("X-Agent-ID: %s\r\n", s.Identity.AgentID))
		if !s.Identity.HasMTLS() && strings.TrimSpace(s.Identity.Credential) != "" {
			reqBuilder.WriteString(fmt.Sprintf("Authorization: Bearer %s\r\n", s.Identity.Credential))
		}
	}
	for k, v := range s.ExtraHeaders {
		reqBuilder.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	reqBuilder.WriteString("\r\n")

	if _, err := conn.Write([]byte(reqBuilder.String())); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}

	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, &http.Request{Method: http.MethodGet})
	if err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("read websocket handshake response: %w", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("websocket upgrade rejected with HTTP %d", resp.StatusCode)
	}

	expectedAccept := computeAcceptKey(wsKey)
	if resp.Header.Get("Sec-WebSocket-Accept") != expectedAccept {
		_ = conn.Close()
		return nil, nil, errors.New("invalid Sec-WebSocket-Accept header")
	}

	_ = conn.SetDeadline(time.Time{})
	return conn, br, nil
}

func computeAcceptKey(key string) string {
	h := sha1.New()
	_, _ = h.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

type rfc6455ClientConn struct {
	conn    net.Conn
	br      *bufio.Reader
	writeMu sync.Mutex
}

func (c *rfc6455ClientConn) WriteJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.writeFrame(0x1, data)
}

func (c *rfc6455ClientConn) writeControlFrame(opcode byte, payload []byte) error {
	return c.writeFrame(opcode, payload)
}

func (c *rfc6455ClientConn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	var header []byte
	header = append(header, 0x80|opcode) // FIN + opcode

	length := len(payload)
	if length <= 125 {
		header = append(header, 0x80|byte(length))
	} else if length <= 65535 {
		header = append(header, 0x80|126, byte(length>>8), byte(length))
	} else {
		header = append(header, 0x80|127)
		lenBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(lenBytes, uint64(length))
		header = append(header, lenBytes...)
	}

	maskKey := make([]byte, 4)
	_, _ = rand.Read(maskKey)
	header = append(header, maskKey...)

	masked := make([]byte, length)
	for i := 0; i < length; i++ {
		masked[i] = payload[i] ^ maskKey[i%4]
	}

	frame := append(header, masked...)
	_, err := c.conn.Write(frame)
	return err
}

func (c *rfc6455ClientConn) ReadFrame() (opcode byte, payload []byte, err error) {
	b0, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	b1, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, err
	}

	opcode = b0 & 0x0F
	masked := (b1 & 0x80) != 0
	length := uint64(b1 & 0x7F)

	if length == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(c.br, ext); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(ext))
	} else if length == 127 {
		ext := make([]byte, 8)
		if _, err := io.ReadFull(c.br, ext); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(ext)
	}

	if length > 4*1024*1024 {
		return 0, nil, errors.New("websocket frame exceeds 4MB limit")
	}

	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(c.br, maskKey); err != nil {
			return 0, nil, err
		}
	}

	payload = make([]byte, length)
	if _, err := io.ReadFull(c.br, payload); err != nil {
		return 0, nil, err
	}

	if masked {
		for i := uint64(0); i < length; i++ {
			payload[i] ^= maskKey[i%4]
		}
	}

	return opcode, payload, nil
}
