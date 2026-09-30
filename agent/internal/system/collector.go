package system

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
)

// Info contains the host system metadata collected natively via Go and Linux /proc & /etc filesystems.
type Info struct {
	Hostname         string
	OS               string
	Distribution     string
	Kernel           string
	Architecture     string
	CPUCount         int
	MemoryTotalBytes uint64
	UptimeSeconds    uint64
}

// Collector defines an interface for gathering host system information so it can be mocked in unit tests.
type Collector interface {
	Collect() (*Info, error)
}

// LinuxCollector reads host metrics directly from Go runtime APIs and Linux virtual filesystems (/proc, /etc)
// without spawning external shell commands.
type LinuxCollector struct {
	OSReleasePath     string
	ProcVersionPath   string
	ProcMeminfoPath   string
	ProcUptimePath    string
	HostnameProvider  func() (string, error)
}

// NewLinuxCollector returns a Collector configured for a standard Linux host.
func NewLinuxCollector() *LinuxCollector {
	return &LinuxCollector{
		OSReleasePath:   "/etc/os-release",
		ProcVersionPath: "/proc/sys/kernel/osrelease",
		ProcMeminfoPath: "/proc/meminfo",
		ProcUptimePath:  "/proc/uptime",
		HostnameProvider: os.Hostname,
	}
}

func (c *LinuxCollector) Collect() (*Info, error) {
	hostname := "linux-host"
	if c.HostnameProvider != nil {
		if h, err := c.HostnameProvider(); err == nil && strings.TrimSpace(h) != "" {
			hostname = strings.TrimSpace(h)
		}
	}

	distro := parseOSRelease(c.OSReleasePath)
	kernel := parseKernelRelease(c.ProcVersionPath)
	memTotal := parseMemTotalBytes(c.ProcMeminfoPath)
	uptimeSec := parseUptimeSeconds(c.ProcUptimePath)

	return &Info{
		Hostname:         hostname,
		OS:               runtime.GOOS,
		Distribution:     distro,
		Kernel:           kernel,
		Architecture:     runtime.GOARCH,
		CPUCount:         runtime.NumCPU(),
		MemoryTotalBytes: memTotal,
		UptimeSeconds:    uptimeSec,
	}, nil
}

func parseOSRelease(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return "Linux"
	}
	defer f.Close()

	var prettyName, name, version string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			prettyName = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"'`)
		} else if strings.HasPrefix(line, "NAME=") {
			name = strings.Trim(strings.TrimPrefix(line, "NAME="), `"'`)
		} else if strings.HasPrefix(line, "VERSION_ID=") {
			version = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), `"'`)
		}
	}

	if prettyName != "" {
		return prettyName
	}
	if name != "" {
		if version != "" {
			return name + " " + version
		}
		return name
	}
	return "Linux"
}

func parseKernelRelease(path string) string {
	data, err := os.ReadFile(path)
	if err == nil {
		if v := strings.TrimSpace(string(data)); v != "" {
			return v
		}
	}
	return "linux"
}

func parseMemTotalBytes(path string) uint64 {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if kb, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					return kb * 1024
				}
			}
		}
	}
	return 0
}

func parseUptimeSeconds(path string) uint64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	if val, err := strconv.ParseFloat(fields[0], 64); err == nil && val >= 0 {
		return uint64(val)
	}
	return 0
}
