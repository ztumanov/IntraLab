package system

import (
	"bufio"
	"bytes"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Info represents Linux host hardware, OS metadata, and live resource metrics collected without shell commands.
type Info struct {
	Hostname                  string  `json:"hostname"`
	OSDistribution            string  `json:"os_distribution"`
	Kernel                    string  `json:"kernel"`
	Architecture              string  `json:"architecture"`
	CPUCount                  int     `json:"cpu_count"`
	CPUUsagePercent           float64 `json:"cpu_usage_percent"`
	RAMTotalBytes             uint64  `json:"ram_total_bytes"`
	RAMUsedBytes              uint64  `json:"ram_used_bytes"`
	RAMUsagePercent           float64 `json:"ram_usage_percent"`
	DiskTotalBytes            uint64  `json:"disk_total_bytes"`
	DiskUsedBytes             uint64  `json:"disk_used_bytes"`
	DiskUsagePercent          float64 `json:"disk_usage_percent"`
	NetworkReceiveBytesTotal  uint64  `json:"network_receive_bytes_total"`
	NetworkTransmitBytesTotal uint64  `json:"network_transmit_bytes_total"`
	NetworkRxBytesPerSec      float64 `json:"network_rx_bytes_per_sec"`
	NetworkTxBytesPerSec      float64 `json:"network_tx_bytes_per_sec"`
	UptimeSeconds             uint64  `json:"uptime_seconds"`
}

type cpuSample struct {
	idle  uint64
	total uint64
}

type netSample struct {
	rxBytes uint64
	txBytes uint64
	at      time.Time
}

// Collector reads Linux procfs/etc files from configurable paths (facilitating unit tests).
type Collector struct {
	OSReleasePath    string
	ProcKernelPath   string
	ProcMeminfoPath  string
	ProcUptimePath   string
	ProcStatPath     string
	ProcNetDevPath   string
	RootMountPath    string
	HostnameProvider func() (string, error)
	DiskStatProvider func(path string) (totalBytes, usedBytes uint64, err error)

	mu      sync.Mutex
	prevCPU *cpuSample
	prevNet *netSample
}

// NewCollector returns a Linux system collector pointed at standard /etc and /proc paths.
func NewCollector() *Collector {
	return &Collector{
		OSReleasePath:    "/etc/os-release",
		ProcKernelPath:   "/proc/sys/kernel/osrelease",
		ProcMeminfoPath:  "/proc/meminfo",
		ProcUptimePath:   "/proc/uptime",
		ProcStatPath:     "/proc/stat",
		ProcNetDevPath:   "/proc/net/dev",
		RootMountPath:    "/",
		HostnameProvider: os.Hostname,
		DiskStatProvider: defaultDiskStat,
	}
}

func defaultDiskStat(path string) (uint64, uint64, error) {
	if strings.TrimSpace(path) == "" {
		path = "/"
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	bsize := uint64(stat.Bsize)
	total := stat.Blocks * bsize
	free := stat.Bavail * bsize
	if free > total {
		free = stat.Bfree * bsize
	}
	var used uint64
	if total >= free {
		used = total - free
	}
	return total, used, nil
}

// Collect gathers host system information and resource metrics using native Go APIs and Linux procfs files.
func (c *Collector) Collect() Info {
	hostname := "localhost"
	if c.HostnameProvider != nil {
		if h, err := c.HostnameProvider(); err == nil && strings.TrimSpace(h) != "" {
			hostname = strings.TrimSpace(h)
		}
	}

	osDistro := runtime.GOOS
	if data, err := os.ReadFile(c.OSReleasePath); err == nil {
		if parsed := ParseOSRelease(data); parsed != "" {
			osDistro = parsed
		}
	}

	kernel := "unknown"
	if data, err := os.ReadFile(c.ProcKernelPath); err == nil {
		if k := strings.TrimSpace(string(data)); k != "" {
			kernel = k
		}
	}

	var ramTotalBytes, ramUsedBytes uint64
	var ramUsagePercent float64
	if data, err := os.ReadFile(c.ProcMeminfoPath); err == nil {
		ramTotalBytes, ramUsedBytes, ramUsagePercent = ParseMemInfo(data)
	}

	var uptimeSec uint64
	if data, err := os.ReadFile(c.ProcUptimePath); err == nil {
		uptimeSec = ParseUptimeSeconds(data)
	}

	cpuCount := runtime.NumCPU()
	if cpuCount < 1 {
		cpuCount = 1
	}

	cpuUsagePct := c.collectCPUUsage()
	diskTotalBytes, diskUsedBytes, diskUsagePct := c.collectDiskUsage()
	rxTotal, txTotal, rxRate, txRate := c.collectNetworkUsage()

	return Info{
		Hostname:                  hostname,
		OSDistribution:            osDistro,
		Kernel:                    kernel,
		Architecture:              runtime.GOARCH,
		CPUCount:                  cpuCount,
		CPUUsagePercent:           cpuUsagePct,
		RAMTotalBytes:             ramTotalBytes,
		RAMUsedBytes:              ramUsedBytes,
		RAMUsagePercent:           ramUsagePercent,
		DiskTotalBytes:            diskTotalBytes,
		DiskUsedBytes:             diskUsedBytes,
		DiskUsagePercent:          diskUsagePct,
		NetworkReceiveBytesTotal:  rxTotal,
		NetworkTransmitBytesTotal: txTotal,
		NetworkRxBytesPerSec:      rxRate,
		NetworkTxBytesPerSec:      txRate,
		UptimeSeconds:             uptimeSec,
	}
}

func (c *Collector) collectCPUUsage() float64 {
	if c.ProcStatPath == "" {
		return 0
	}
	data, err := os.ReadFile(c.ProcStatPath)
	if err != nil {
		return 0
	}
	idle, total, ok := ParseProcStatCPU(data)
	if !ok || total == 0 {
		return 0
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	current := &cpuSample{idle: idle, total: total}
	if c.prevCPU == nil || total <= c.prevCPU.total {
		c.prevCPU = current
		active := total - idle
		return clampPercent((float64(active) / float64(total)) * 100)
	}

	deltaTotal := total - c.prevCPU.total
	deltaIdle := idle - c.prevCPU.idle
	c.prevCPU = current
	if deltaTotal == 0 || deltaIdle > deltaTotal {
		return 0
	}
	activeDelta := deltaTotal - deltaIdle
	return clampPercent((float64(activeDelta) / float64(deltaTotal)) * 100)
}

func (c *Collector) collectDiskUsage() (uint64, uint64, float64) {
	provider := c.DiskStatProvider
	if provider == nil {
		provider = defaultDiskStat
	}
	mount := c.RootMountPath
	if mount == "" {
		mount = "/"
	}
	total, used, err := provider(mount)
	if err != nil || total == 0 {
		return 0, 0, 0
	}
	pct := clampPercent((float64(used) / float64(total)) * 100)
	return total, used, pct
}

func (c *Collector) collectNetworkUsage() (uint64, uint64, float64, float64) {
	if c.ProcNetDevPath == "" {
		return 0, 0, 0, 0
	}
	data, err := os.ReadFile(c.ProcNetDevPath)
	if err != nil {
		return 0, 0, 0, 0
	}
	rxTotal, txTotal := ParseProcNetDev(data)
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()

	var rxRate, txRate float64
	if c.prevNet != nil {
		elapsed := now.Sub(c.prevNet.at).Seconds()
		if elapsed > 0 {
			if rxTotal >= c.prevNet.rxBytes {
				rxRate = float64(rxTotal-c.prevNet.rxBytes) / elapsed
			}
			if txTotal >= c.prevNet.txBytes {
				txRate = float64(txTotal-c.prevNet.txBytes) / elapsed
			}
		}
	}
	c.prevNet = &netSample{
		rxBytes: rxTotal,
		txBytes: txTotal,
		at:      now,
	}
	return rxTotal, txTotal, rxRate, txRate
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// ParseOSRelease extracts PRETTY_NAME (or NAME + VERSION_ID) from /etc/os-release content.
func ParseOSRelease(content []byte) string {
	var prettyName, name, versionID string
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		switch strings.TrimSpace(k) {
		case "PRETTY_NAME":
			prettyName = v
		case "NAME":
			name = v
		case "VERSION_ID":
			versionID = v
		}
	}
	if prettyName != "" {
		return prettyName
	}
	if name != "" && versionID != "" {
		return name + " " + versionID
	}
	return name
}

// ParseMemTotalBytes extracts MemTotal from /proc/meminfo and converts kB to bytes.
func ParseMemTotalBytes(content []byte) uint64 {
	total, _, _ := ParseMemInfo(content)
	return total
}

// ParseMemInfo extracts total bytes, used bytes, and usage percentage from /proc/meminfo.
func ParseMemInfo(content []byte) (totalBytes, usedBytes uint64, usagePercent float64) {
	var memTotalKB, memAvailableKB, memFreeKB, buffersKB, cachedKB uint64
	var hasAvailable bool

	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			memTotalKB = val
		case "MemAvailable":
			memAvailableKB = val
			hasAvailable = true
		case "MemFree":
			memFreeKB = val
		case "Buffers":
			buffersKB = val
		case "Cached":
			cachedKB = val
		}
	}

	if memTotalKB == 0 {
		return 0, 0, 0
	}

	availKB := memAvailableKB
	if !hasAvailable {
		availKB = memFreeKB + buffersKB + cachedKB
	}
	var usedKB uint64
	if memTotalKB > availKB {
		usedKB = memTotalKB - availKB
	}

	totalBytes = memTotalKB * 1024
	usedBytes = usedKB * 1024
	usagePercent = clampPercent((float64(usedBytes) / float64(totalBytes)) * 100)
	return totalBytes, usedBytes, usagePercent
}

// ParseProcStatCPU parses the aggregate "cpu " line from /proc/stat.
func ParseProcStatCPU(content []byte) (idle, total uint64, ok bool) {
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return 0, 0, false
		}
		var sum uint64
		var idleVal uint64
		for i := 1; i < len(fields); i++ {
			v, err := strconv.ParseUint(fields[i], 10, 64)
			if err != nil {
				continue
			}
			sum += v
			// columns 4 (idle) and 5 (iowait) represent idle time
			if i == 4 || i == 5 {
				idleVal += v
			}
		}
		return idleVal, sum, sum > 0
	}
	return 0, 0, false
}

// ParseProcNetDev sums receive and transmit bytes across all non-loopback interfaces in /proc/net/dev.
func ParseProcNetDev(content []byte) (rxBytes, txBytes uint64) {
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		iface, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		iface = strings.TrimSpace(iface)
		if iface == "" || iface == "lo" {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 9 {
			continue
		}
		if rx, err := strconv.ParseUint(fields[0], 10, 64); err == nil {
			rxBytes += rx
		}
		if tx, err := strconv.ParseUint(fields[8], 10, 64); err == nil {
			txBytes += tx
		}
	}
	return rxBytes, txBytes
}

// ParseUptimeSeconds extracts the first float field from /proc/uptime in whole seconds.
func ParseUptimeSeconds(content []byte) uint64 {
	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0
	}
	val, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || val < 0 {
		return 0
	}
	return uint64(val)
}
