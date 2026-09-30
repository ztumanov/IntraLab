package metrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/infralab/infralab/agent/internal/system"
)

func TestExporterServesPrometheusMetrics(t *testing.T) {
	tmpDir := t.TempDir()

	osRelease := filepath.Join(tmpDir, "os-release")
	kernelFile := filepath.Join(tmpDir, "osrelease")
	meminfoFile := filepath.Join(tmpDir, "meminfo")
	uptimeFile := filepath.Join(tmpDir, "uptime")
	statFile := filepath.Join(tmpDir, "stat")
	netDevFile := filepath.Join(tmpDir, "net_dev")

	_ = os.WriteFile(osRelease, []byte("PRETTY_NAME=\"Ubuntu 24.04 LTS\"\n"), 0644)
	_ = os.WriteFile(kernelFile, []byte("6.8.0-45-generic\n"), 0644)
	_ = os.WriteFile(meminfoFile, []byte("MemTotal: 16000000 kB\nMemAvailable: 12000000 kB\n"), 0644)
	_ = os.WriteFile(uptimeFile, []byte("86400.00 172000.00\n"), 0644)
	_ = os.WriteFile(statFile, []byte("cpu  1500 0 500 8000 0 0 0 0 0 0\n"), 0644)
	_ = os.WriteFile(netDevFile, []byte("Inter-|\n face |bytes\n  eth0: 104857600 100 0 0 0 0 0 0 52428800 90 0 0 0 0 0 0\n"), 0644)

	collector := &system.Collector{
		OSReleasePath:   osRelease,
		ProcKernelPath:  kernelFile,
		ProcMeminfoPath: meminfoFile,
		ProcUptimePath:  uptimeFile,
		ProcStatPath:    statFile,
		ProcNetDevPath:  netDevFile,
		HostnameProvider: func() (string, error) {
			return "node-prom-01", nil
		},
		DiskStatProvider: func(path string) (uint64, uint64, error) {
			return 200 * 1024 * 1024 * 1024, 50 * 1024 * 1024 * 1024, nil
		},
	}

	exporter := NewExporter(collector, "agt_prom_01", "0.2.0")
	srv := httptest.NewServer(exporter.Handler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatalf("GET /metrics failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("unexpected Content-Type: %s", resp.Header.Get("Content-Type"))
	}

	bodyBytes, _ := io.ReadAll(resp.Body)
	body := string(bodyBytes)

	requiredSeries := []string{
		"infralab_cpu_usage_percent",
		"infralab_memory_usage_percent",
		"infralab_disk_usage_percent",
		"infralab_network_receive_bytes_total",
		"infralab_network_transmit_bytes_total",
		"infralab_uptime_seconds",
	}
	for _, metricName := range requiredSeries {
		if !strings.Contains(body, metricName) {
			t.Errorf("expected /metrics output to contain %q, got:\n%s", metricName, body)
		}
	}
}
