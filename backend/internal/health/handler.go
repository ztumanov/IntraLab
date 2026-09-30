package health

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

type ReadinessChecks struct {
	Database   string `json:"database"`
	Prometheus string `json:"prometheus"`
}

type ReadinessResponse struct {
	Status string          `json:"status"`
	Checks ReadinessChecks `json:"checks"`
}

type ReadinessChecker struct {
	CheckDatabase   func(ctx context.Context) error
	CheckPrometheus func(ctx context.Context) error
}

type Handler struct {
	readiness *ReadinessChecker
}

func NewHandler() *Handler {
	return &Handler{}
}

func NewHandlerWithReadiness(rc *ReadinessChecker) *Handler {
	return &Handler{readiness: rc}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(Response{
		Status:    "ok",
		Service:   "infralab-api",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) ServeReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	checks := ReadinessChecks{
		Database:   "ok",
		Prometheus: "ok",
	}

	if h.readiness != nil && h.readiness.CheckDatabase != nil {
		if err := h.readiness.CheckDatabase(ctx); err != nil {
			checks.Database = "error"
		}
	}

	if h.readiness != nil && h.readiness.CheckPrometheus != nil {
		if err := h.readiness.CheckPrometheus(ctx); err != nil {
			checks.Prometheus = "error"
		}
	} else if promURL := strings.TrimSpace(os.Getenv("PROMETHEUS_URL")); promURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(promURL, "/")+"/-/ready", nil)
		if err != nil {
			checks.Prometheus = "error"
		} else {
			client := &http.Client{Timeout: 2 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				checks.Prometheus = "error"
			} else {
				_ = resp.Body.Close()
				if resp.StatusCode >= 400 {
					checks.Prometheus = "error"
				}
			}
		}
	}

	overall := "ok"
	httpCode := http.StatusOK
	if checks.Database != "ok" || checks.Prometheus != "ok" {
		overall = "error"
		httpCode = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpCode)
	_ = json.NewEncoder(w).Encode(ReadinessResponse{
		Status: overall,
		Checks: checks,
	})
}
