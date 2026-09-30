package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/infralab/infralab/backend/internal/servers"
)

type memoryRepo struct {
	nextID int64
	items  map[int64]servers.Server
}

func newMemoryRepo() *memoryRepo {
	return &memoryRepo{
		nextID: 1,
		items:  make(map[int64]servers.Server),
	}
}

func (m *memoryRepo) List(_ context.Context) ([]servers.Server, error) {
	out := make([]servers.Server, 0, len(m.items))
	for _, item := range m.items {
		out = append(out, item)
	}
	return out, nil
}

func (m *memoryRepo) GetByID(_ context.Context, id int64) (*servers.Server, error) {
	item, ok := m.items[id]
	if !ok {
		return nil, servers.ErrNotFound
	}
	return &item, nil
}

func (m *memoryRepo) Create(_ context.Context, in servers.CreateServerInput) (*servers.Server, error) {
	now := time.Now().UTC()
	srv := servers.Server{
		ID:          m.nextID,
		Name:        in.Name,
		Hostname:    in.Hostname,
		IPAddress:   in.IPAddress,
		SSHPort:     in.SSHPort,
		Username:    in.Username,
		Description: in.Description,
		Status:      servers.StatusUnknown,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	m.items[srv.ID] = srv
	m.nextID++
	return &srv, nil
}

func (m *memoryRepo) Delete(_ context.Context, id int64) error {
	if _, ok := m.items[id]; !ok {
		return servers.ErrNotFound
	}
	delete(m.items, id)
	return nil
}

func TestAPIEndpoints(t *testing.T) {
	repo := newMemoryRepo()
	svc := servers.NewService(repo)
	handler := servers.NewHandler(svc)
	router := NewRouter(handler)

	// 1. Health endpoint
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /api/health, got %d", rec.Code)
	}

	// 2. Create server (POST /api/servers)
	body := []byte(`{"name":"web-01","hostname":"web-01","ip_address":"10.10.10.11","ssh_port":22,"username":"admin","description":"Web server"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/servers", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d (%s)", rec.Code, rec.Body.String())
	}

	var created servers.Server
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created server: %v", err)
	}
	if created.Status != servers.StatusUnknown {
		t.Fatalf("expected status unknown, got %s", created.Status)
	}

	// 3. List servers (GET /api/servers)
	req = httptest.NewRequest(http.MethodGet, "/api/servers", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on list, got %d", rec.Code)
	}

	// 4. Get server by ID (GET /api/servers/1)
	req = httptest.NewRequest(http.MethodGet, "/api/servers/1", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on get by id, got %d", rec.Code)
	}

	// 5. Delete server (DELETE /api/servers/1)
	req = httptest.NewRequest(http.MethodDelete, "/api/servers/1", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 NoContent on delete, got %d", rec.Code)
	}

	// 6. Verify 404 after delete
	req = httptest.NewRequest(http.MethodGet, "/api/servers/1", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 NotFound after delete, got %d", rec.Code)
	}
}
