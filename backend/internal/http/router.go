package http

import (
	"net/http"

	"github.com/infralab/infralab/backend/internal/health"
	"github.com/infralab/infralab/backend/internal/servers"
)

func NewRouter(serverHandler *servers.Handler) http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler()

	mux.Handle("/api/health", healthHandler)
	mux.HandleFunc("/api/servers", serverHandler.HandleCollection)
	mux.HandleFunc("/api/servers/", serverHandler.HandleItem)

	return mux
}
