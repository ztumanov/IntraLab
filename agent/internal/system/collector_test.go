package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinuxCollectorParsesProcAndOSReleaseWithoutShell(t *testing.T) {
	tmp := t.TempDir()

	osRelease := filepath.Join(tmp, "os-release")
	_ = os.WriteFile(osRelease, []byte("NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.4 LTS\"\n"), 0644)

	kernelRel := filepath.Join(tmp, "osrelease")
	_ = os.WriteFile(kernelRel, []byte("6.8.0-45-generic\n"), 0644)

	meminfo := filepath.Join(tmp, "meminfo")
	_ = os.WriteFile(meminfo, []byte("MemTotal:       16777216 kB\nMemFree:         8388608 kB\n"), 0644)

	uptime := filepath.Join(tmp, "uptime")
	_ = os.WriteFile(uptime, []byte("123456.78 234567.89\n"), 0644)

	collector := &LinuxCollector{
		OSReleasePath:   osRelease,
		ProcVersionPath: kernelRel,
		ProcMeminfoPath: meminfo,
		ProcUptimePath:  uptime,
		HostnameProvider: func() (string, error) {
			return "web-01", nil
		},
	}

	info, err := collector.Collect()
	if err != nil {
		t.Fatalf("Collect returned error: %v", err)
	}

	if info.Hostname != "web-01" {
		t.Errorf("expected Hostname web-01, got %q", info.Hostname)
	}
	if info.Distribution != "Ubuntu 24.04.4 LTS" {
		t.Errorf("expected Distribution Ubuntu 24.04.4 LTS, got %q", info.Distribution)
	}
	if info.Kernel != "6.8.0-45-generic" {
		t.Errorf("expected Kernel 6.8.0-45-generic, got %q", info.Kernel)
	}
	if info.MemoryTotalBytes != 17179869184 {
		t.Errorf("expected MemoryTotalBytes 17179869184, got %d", info.MemoryTotalBytes)
	}
	if info.UptimeSeconds != 123456 {
		t.Errorf("expected UptimeSeconds 123456, got %d", info.UptimeSeconds)
	}
	if info.CPUCount < 1 {
		t.Errorf("expected CPUCount >= 1, got %d", info.CPUCount)
	}
}
