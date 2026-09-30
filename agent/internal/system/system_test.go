package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCollectorReadsLinuxFilesWithoutShell(t *testing.T) {
	tmpDir := t.TempDir()

	osRelease := filepath.Join(tmpDir, "os-release")
	kernelFile := filepath.Join(tmpDir, "osrelease")
	meminfoFile := filepath.Join(tmpDir, "meminfo")
	uptimeFile := filepath.Join(tmpDir, "uptime")
	statFile := filepath.Join(tmpDir, "stat")
	netDevFile := filepath.Join(tmpDir, "net_dev")

	_ = os.WriteFile(osRelease, []byte("NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.4 LTS\"\n"), 0644)
	_ = os.WriteFile(kernelFile, []byte("6.8.0-45-generic\n"), 0644)
	_ = os.WriteFile(meminfoFile, []byte("MemTotal:        8000000 kB\nMemAvailable:    4000000 kB\n"), 0644)
	_ = os.WriteFile(uptimeFile, []byte("172895.42 340112.10\n"), 0644)
	_ = os.WriteFile(statFile, []byte("cpu  2500 0 1500 6000 0 0 0 0 0 0\n"), 0644)
	_ = os.WriteFile(netDevFile, []byte("Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo: 100000      100    0    0    0     0          0         0   100000      100    0    0    0     0       0          0\n  eth0: 52428800   1200    0    0    0     0          0         0 26214400     950    0    0    0     0       0          0\n"), 0644)

	collector := &Collector{
		OSReleasePath:   osRelease,
		ProcKernelPath:  kernelFile,
		ProcMeminfoPath: meminfoFile,
		ProcUptimePath:  uptimeFile,
		ProcStatPath:    statFile,
		ProcNetDevPath:  netDevFile,
		HostnameProvider: func() (string, error) {
			return "prod-node-01", nil
		},
		DiskStatProvider: func(path string) (uint64, uint64, error) {
			return 100 * 1024 * 1024 * 1024, 35 * 1024 * 1024 * 1024, nil
		},
	}

	info := collector.Collect()

	if info.Hostname != "prod-node-01" {
		t.Errorf("expected hostname prod-node-01, got %q", info.Hostname)
	}
	if info.OSDistribution != "Ubuntu 24.04.4 LTS" {
		t.Errorf("expected Ubuntu 24.04.4 LTS, got %q", info.OSDistribution)
	}
	if info.Kernel != "6.8.0-45-generic" {
		t.Errorf("expected kernel 6.8.0-45-generic, got %q", info.Kernel)
	}
	if info.RAMTotalBytes != 8000000*1024 {
		t.Errorf("expected RAM total %d, got %d", 8000000*1024, info.RAMTotalBytes)
	}
	if info.RAMUsagePercent != 50 {
		t.Errorf("expected RAM usage 50%%, got %.2f", info.RAMUsagePercent)
	}
	if info.CPUUsagePercent != 40 {
		t.Errorf("expected CPU usage 40%%, got %.2f", info.CPUUsagePercent)
	}
	if info.DiskUsagePercent != 35 {
		t.Errorf("expected Disk usage 35%%, got %.2f", info.DiskUsagePercent)
	}
	if info.NetworkReceiveBytesTotal != 52428800 {
		t.Errorf("expected RX bytes 52428800, got %d", info.NetworkReceiveBytesTotal)
	}
	if info.NetworkTransmitBytesTotal != 26214400 {
		t.Errorf("expected TX bytes 26214400, got %d", info.NetworkTransmitBytesTotal)
	}
	if info.UptimeSeconds != 172895 {
		t.Errorf("expected uptime 172895, got %d", info.UptimeSeconds)
	}
}
