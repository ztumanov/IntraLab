package metrics

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/infralab/infralab/agent/internal/system"
)

// Exporter serves Prometheus-compatible metrics on GET /metrics.
type Exporter struct {
	collector *system.Collector
	agentID   string
	version   string
}

func NewExporter(collector *system.Collector, agentID, version string) *Exporter {
	if collector == nil {
		collector = system.NewCollector()
	}
	return &Exporter{
		collector: collector,
		agentID:   strings.TrimSpace(agentID),
		version:   strings.TrimSpace(version),
	}
}

// Handler returns an http.Handler serving GET /metrics and GET /healthz.
func (e *Exporter) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", e.ServeHTTP)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}

func (e *Exporter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	info := e.collector.Collect()
	payload := FormatPrometheusMetrics(info, e.agentID, e.version)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write([]byte(payload))
	}
}

// FormatPrometheusMetrics renders Linux host metrics in Prometheus text exposition format 0.0.4.
func FormatPrometheusMetrics(info system.Info, agentID, version string) string {
	hostname := sanitizeLabelValue(info.Hostname)
	agentLabel := sanitizeLabelValue(agentID)
	verLabel := sanitizeLabelValue(version)
	labels := fmt.Sprintf(`hostname=%q,agent_id=%q`, hostname, agentLabel)

	var b strings.Builder

	// Agent build metadata
	b.WriteString("# HELP infralab_agent_info InfraLab Linux Agent build metadata.\n")
	b.WriteString("# TYPE infralab_agent_info gauge\n")
	fmt.Fprintf(
		&b,
		"infralab_agent_info{hostname=%q,agent_id=%q,version=%q,os=%q,kernel=%q,arch=%q} 1\n",
		hostname,
		agentLabel,
		verLabel,
		sanitizeLabelValue(info.OSDistribution),
		sanitizeLabelValue(info.Kernel),
		sanitizeLabelValue(info.Architecture),
	)

	// CPU usage
	b.WriteString("# HELP infralab_cpu_usage_percent Current host CPU utilization percentage (0-100).\n")
	b.WriteString("# TYPE infralab_cpu_usage_percent gauge\n")
	fmt.Fprintf(&b, "infralab_cpu_usage_percent{%s} %.2f\n", labels, info.CPUUsagePercent)

	b.WriteString("# HELP infralab_cpu_cores Number of logical CPU cores.\n")
	b.WriteString("# TYPE infralab_cpu_cores gauge\n")
	fmt.Fprintf(&b, "infralab_cpu_cores{%s} %d\n", labels, info.CPUCount)

	// Memory usage
	b.WriteString("# HELP infralab_memory_usage_percent Current host RAM utilization percentage (0-100).\n")
	b.WriteString("# TYPE infralab_memory_usage_percent gauge\n")
	fmt.Fprintf(&b, "infralab_memory_usage_percent{%s} %.2f\n", labels, info.RAMUsagePercent)

	b.WriteString("# HELP infralab_memory_total_bytes Total physical memory in bytes.\n")
	b.WriteString("# TYPE infralab_memory_total_bytes gauge\n")
	fmt.Fprintf(&b, "infralab_memory_total_bytes{%s} %d\n", labels, info.RAMTotalBytes)

	b.WriteString("# HELP infralab_memory_used_bytes Used physical memory in bytes.\n")
	b.WriteString("# TYPE infralab_memory_used_bytes gauge\n")
	fmt.Fprintf(&b, "infralab_memory_used_bytes{%s} %d\n", labels, info.RAMUsedBytes)

	// Disk usage
	b.WriteString("# HELP infralab_disk_usage_percent Root filesystem utilization percentage (0-100).\n")
	b.WriteString("# TYPE infralab_disk_usage_percent gauge\n")
	fmt.Fprintf(&b, "infralab_disk_usage_percent{%s} %.2f\n", labels, info.DiskUsagePercent)

	b.WriteString("# HELP infralab_disk_total_bytes Root filesystem total capacity in bytes.\n")
	b.WriteString("# TYPE infralab_disk_total_bytes gauge\n")
	fmt.Fprintf(&b, "infralab_disk_total_bytes{%s} %d\n", labels, info.DiskTotalBytes)

	b.WriteString("# HELP infralab_disk_used_bytes Root filesystem used space in bytes.\n")
	b.WriteString("# TYPE infralab_disk_used_bytes gauge\n")
	fmt.Fprintf(&b, "infralab_disk_used_bytes{%s} %d\n", labels, info.DiskUsedBytes)

	// Network RX / TX
	b.WriteString("# HELP infralab_network_receive_bytes_total Total bytes received across non-loopback network interfaces.\n")
	b.WriteString("# TYPE infralab_network_receive_bytes_total counter\n")
	fmt.Fprintf(&b, "infralab_network_receive_bytes_total{%s} %d\n", labels, info.NetworkReceiveBytesTotal)

	b.WriteString("# HELP infralab_network_transmit_bytes_total Total bytes transmitted across non-loopback network interfaces.\n")
	b.WriteString("# TYPE infralab_network_transmit_bytes_total counter\n")
	fmt.Fprintf(&b, "infralab_network_transmit_bytes_total{%s} %d\n", labels, info.NetworkTransmitBytesTotal)

	b.WriteString("# HELP infralab_network_rx_bytes_per_sec Current network receive throughput in bytes per second.\n")
	b.WriteString("# TYPE infralab_network_rx_bytes_per_sec gauge\n")
	fmt.Fprintf(&b, "infralab_network_rx_bytes_per_sec{%s} %.2f\n", labels, info.NetworkRxBytesPerSec)

	b.WriteString("# HELP infralab_network_tx_bytes_per_sec Current network transmit throughput in bytes per second.\n")
	b.WriteString("# TYPE infralab_network_tx_bytes_per_sec gauge\n")
	fmt.Fprintf(&b, "infralab_network_tx_bytes_per_sec{%s} %.2f\n", labels, info.NetworkTxBytesPerSec)

	// Uptime
	b.WriteString("# HELP infralab_uptime_seconds System uptime in seconds.\n")
	b.WriteString("# TYPE infralab_uptime_seconds gauge\n")
	fmt.Fprintf(&b, "infralab_uptime_seconds{%s} %d\n", labels, info.UptimeSeconds)

	return b.String()
}

func sanitizeLabelValue(v string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	return r.Replace(strings.TrimSpace(v))
}
