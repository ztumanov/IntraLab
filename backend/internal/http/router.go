package http

import (
	"net/http"

	"github.com/infralab/infralab/backend/internal/health"
	"github.com/infralab/infralab/backend/internal/servers"
)

func NewRouter(serverHandler *servers.Handler) http.Handler {
	return NewRouterWithReadiness(serverHandler, nil)
}

func NewRouterWithReadiness(serverHandler *servers.Handler, readiness *health.ReadinessChecker) http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandlerWithReadiness(readiness)

	mux.Handle("/api/health", healthHandler)
	mux.HandleFunc("/api/ready", healthHandler.ServeReady)
	mux.HandleFunc("/api/servers", serverHandler.HandleCollection)
	mux.HandleFunc("/api/servers/", serverHandler.HandleItem)

	return mux
}
