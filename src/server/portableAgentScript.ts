export const PORTABLE_AGENT_SCRIPT = `#!/usr/bin/env python3
"""
InfraLab Linux Telemetry & Prometheus Exporter Agent (v0.2.0)
Compatible with CLI subcommands:
  infralab-agent enroll --server <URL> --token <TOKEN>
  infralab-agent run [--listen-addr :9101]
  infralab-agent version
"""
import argparse
import json
import os
import platform
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

VERSION = "0.2.0"
DEFAULT_CONFIG_PATH = "/etc/infralab-agent/config.json"
DEFAULT_CRED_PATH = "/var/lib/infralab-agent/credentials.json"
DEFAULT_LISTEN_ADDR = ":9101"


def write_atomic(path, content, mode=0o600):
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, mode=0o700, exist_ok=True)
    tmp_path = f"{path}.tmp"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        data = content.encode("utf-8") if isinstance(content, str) else content
        os.write(fd, data)
        os.fchmod(fd, mode)
    finally:
        os.close(fd)
    os.replace(tmp_path, path)
    os.chmod(path, mode)


def generate_local_key_and_csr(common_name="infralab-agent"):
    with tempfile.TemporaryDirectory() as tmpdir:
        key_file = os.path.join(tmpdir, "agent.key")
        csr_file = os.path.join(tmpdir, "agent.csr")
        subprocess.run(
            ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", key_file],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            ["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", key_file, "-out", key_file + ".pkcs8"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.replace(key_file + ".pkcs8", key_file)
        os.chmod(key_file, 0o600)
        subj = f"/O=InfraLab Agent/CN={common_name}"
        subprocess.run(
            ["openssl", "req", "-new", "-sha256", "-key", key_file, "-subj", subj, "-out", csr_file],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with open(key_file, "r", encoding="utf-8") as kf:
            priv_pem = kf.read()
        with open(csr_file, "r", encoding="utf-8") as cf:
            csr_pem = cf.read()
        return priv_pem, csr_pem


def collect_system_info():
    hostname = socket.gethostname() or "linux-host"
    os_distro = "Linux"
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_distro = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        pass

    kernel = platform.release() or "Linux"
    arch = platform.machine() or "x86_64"
    cpu_count = os.cpu_count() or 1

    ram_total_bytes = 0
    ram_avail_bytes = 0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    if parts[0] == "MemTotal:":
                        ram_total_bytes = int(parts[1]) * 1024
                    elif parts[0] == "MemAvailable:":
                        ram_avail_bytes = int(parts[1]) * 1024
    except Exception:
        pass

    uptime_seconds = 0
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as f:
            uptime_seconds = int(float(f.read().split()[0]))
    except Exception:
        pass

    load1, load5, load15 = (0.0, 0.0, 0.0)
    try:
        load1, load5, load15 = os.getloadavg()
    except Exception:
        pass

    disk_total = 0
    disk_avail = 0
    try:
        usage = shutil.disk_usage("/")
        disk_total = usage.total
        disk_avail = usage.free
    except Exception:
        pass

    rx_bytes = 0
    tx_bytes = 0
    try:
        with open("/proc/net/dev", "r", encoding="utf-8") as f:
            for line in f.readlines()[2:]:
                if ":" not in line:
                    continue
                iface, data = line.split(":", 1)
                iface = iface.strip()
                if iface == "lo":
                    continue
                fields = data.split()
                if len(fields) >= 9:
                    rx_bytes += int(fields[0])
                    tx_bytes += int(fields[8])
    except Exception:
        pass

    cpu_ratio = min(1.0, max(0.01, (load1 / max(1, cpu_count))))

    return {
        "hostname": hostname,
        "os_distribution": os_distro,
        "kernel": kernel,
        "architecture": arch,
        "cpu_count": cpu_count,
        "ram_total_bytes": ram_total_bytes,
        "ram_avail_bytes": ram_avail_bytes,
        "uptime_seconds": uptime_seconds,
        "load1": load1,
        "load5": load5,
        "load15": load15,
        "disk_total": disk_total,
        "disk_avail": disk_avail,
        "rx_bytes": rx_bytes,
        "tx_bytes": tx_bytes,
        "cpu_ratio": cpu_ratio,
    }


def render_prometheus_metrics(agent_id="local"):
    info = collect_system_info()
    h = info["hostname"]
    lines = [
        "# HELP infralab_agent_info InfraLab agent build metadata",
        "# TYPE infralab_agent_info gauge",
        f'infralab_agent_info{{agent_id="{agent_id}",version="{VERSION}",hostname="{h}"}} 1',
        "# HELP infralab_cpu_usage_ratio Host CPU usage ratio (0.0 to 1.0)",
        "# TYPE infralab_cpu_usage_ratio gauge",
        f'infralab_cpu_usage_ratio{{hostname="{h}"}} {info["cpu_ratio"]:.4f}',
        "# HELP infralab_memory_total_bytes Total physical memory in bytes",
        "# TYPE infralab_memory_total_bytes gauge",
        f'infralab_memory_total_bytes{{hostname="{h}"}} {info["ram_total_bytes"]}',
        "# HELP infralab_memory_available_bytes Available memory in bytes",
        "# TYPE infralab_memory_available_bytes gauge",
        f'infralab_memory_available_bytes{{hostname="{h}"}} {info["ram_avail_bytes"]}',
        "# HELP infralab_filesystem_size_bytes Root filesystem size in bytes",
        "# TYPE infralab_filesystem_size_bytes gauge",
        f'infralab_filesystem_size_bytes{{mountpoint="/",hostname="{h}"}} {info["disk_total"]}',
        "# HELP infralab_filesystem_avail_bytes Root filesystem available bytes",
        "# TYPE infralab_filesystem_avail_bytes gauge",
        f'infralab_filesystem_avail_bytes{{mountpoint="/",hostname="{h}"}} {info["disk_avail"]}',
        "# HELP infralab_network_receive_bytes_total Total received bytes across non-loopback interfaces",
        "# TYPE infralab_network_receive_bytes_total counter",
        f'infralab_network_receive_bytes_total{{device="eth0",hostname="{h}"}} {info["rx_bytes"]}',
        "# HELP infralab_network_transmit_bytes_total Total transmitted bytes across non-loopback interfaces",
        "# TYPE infralab_network_transmit_bytes_total counter",
        f'infralab_network_transmit_bytes_total{{device="eth0",hostname="{h}"}} {info["tx_bytes"]}',
        "# HELP infralab_load1 1-minute system load average",
        "# TYPE infralab_load1 gauge",
        f'infralab_load1{{hostname="{h}"}} {info["load1"]:.2f}',
        "# HELP infralab_load5 5-minute system load average",
        "# TYPE infralab_load5 gauge",
        f'infralab_load5{{hostname="{h}"}} {info["load5"]:.2f}',
        "# HELP infralab_load15 15-minute system load average",
        "# TYPE infralab_load15 gauge",
        f'infralab_load15{{hostname="{h}"}} {info["load15"]:.2f}',
        "# HELP infralab_uptime_seconds System uptime in seconds",
        "# TYPE infralab_uptime_seconds gauge",
        f'infralab_uptime_seconds{{hostname="{h}"}} {info["uptime_seconds"]}',
        "",
    ]
    return "\\n".join(lines)


def build_ssl_context(ca_cert_path="", client_cert_path="", client_key_path=""):
    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    if ca_cert_path and os.path.exists(ca_cert_path):
        ctx.load_verify_locations(cafile=ca_cert_path)
    if client_cert_path and client_key_path and os.path.exists(client_cert_path) and os.path.exists(client_key_path):
        key_mode = os.stat(client_key_path).st_mode & 0o077
        if key_mode != 0:
            raise PermissionError(f"private key {client_key_path} has insecure permissions")
        ctx.load_cert_chain(certfile=client_cert_path, keyfile=client_key_path)
    return ctx


def post_json(url, payload, headers=None, ssl_ctx=None):
    req_headers = {"Content-Type": "application/json", "User-Agent": f"infralab-agent/{VERSION}"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    ctx = ssl_ctx if ssl_ctx is not None else build_ssl_context()
    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        if raw.strip().startswith("<"):
            raise RuntimeError(
                "Server returned HTML login page instead of JSON API (AI Studio preview URLs require SSH agent installation or public deployment)"
            )
        return json.loads(raw)


def cmd_enroll(args):
    server_url = args.server.rstrip("/")
    token = args.token.strip()
    info = collect_system_info()
    priv_pem, csr_pem = generate_local_key_and_csr(info["hostname"])
    ssl_ctx = build_ssl_context(ca_cert_path=getattr(args, "ca_cert", ""))
    try:
        resp = post_json(
            f"{server_url}/api/agents/enroll",
            {
                "token": token,
                "hostname": info["hostname"],
                "version": VERSION,
                "csr_pem": csr_pem,
            },
            ssl_ctx=ssl_ctx,
        )
        agent_id = resp["agent_id"]
    except Exception as exc:
        print(f"infralab-agent error: enrollment failed: {exc}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(args.config) or "/etc/infralab-agent", exist_ok=True)
    with open(args.config, "w", encoding="utf-8") as f:
        json.dump(
            {
                "server_url": server_url,
                "heartbeat_interval_sec": 15,
                "metrics_listen_addr": args.listen_addr,
            },
            f,
            indent=2,
        )

    cred_dir = os.path.dirname(args.credentials) or "/var/lib/infralab-agent"
    os.makedirs(cred_dir, mode=0o700, exist_ok=True)
    os.chmod(cred_dir, 0o700)

    client_cert_pem = resp.get("client_cert_pem", "")
    ca_cert_pem = resp.get("ca_cert_pem", "")
    cred_payload = {
        "server_url": server_url,
        "agent_id": agent_id,
        "auth_mode": resp.get("auth_mode", "mtls" if client_cert_pem else "bearer"),
    }

    if client_cert_pem and ca_cert_pem:
        key_path = os.path.join(cred_dir, "agent.key")
        cert_path = os.path.join(cred_dir, "agent.crt")
        ca_path = os.path.join(cred_dir, "ca.crt")
        write_atomic(key_path, priv_pem, 0o600)
        write_atomic(cert_path, client_cert_pem, 0o600)
        write_atomic(ca_path, ca_cert_pem, 0o644)
        cred_payload.update(
            {
                "auth_mode": "mtls",
                "client_key_path": key_path,
                "client_cert_path": cert_path,
                "ca_cert_path": ca_path,
                "cert_serial": resp.get("cert_serial", ""),
                "cert_fingerprint_sha256": resp.get("cert_fingerprint_sha256", ""),
                "cert_san_uri": resp.get("cert_san_uri", ""),
                "cert_not_before": resp.get("cert_not_before", ""),
                "cert_not_after": resp.get("cert_not_after", ""),
            }
        )
    elif resp.get("credential"):
        cred_payload["credential"] = resp["credential"]

    write_atomic(args.credentials, json.dumps(cred_payload, indent=2) + "\\n", 0o600)
    print(
        f"Successfully enrolled agent {agent_id} with {server_url} (mode={cred_payload['auth_mode']}, credentials stored at {args.credentials} with mode 0600)"
    )


def cmd_run(args):
    try:
        with open(args.config, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cred_mode = os.stat(args.credentials).st_mode & 0o077
        if cred_mode != 0:
            raise PermissionError(f"credentials file {args.credentials} has insecure permissions")
        with open(args.credentials, "r", encoding="utf-8") as f:
            cred = json.load(f)
    except Exception as exc:
        print(f"infralab-agent error: failed to load config/credentials: {exc}", file=sys.stderr)
        sys.exit(1)

    listen_addr = args.listen_addr or cfg.get("metrics_listen_addr", DEFAULT_LISTEN_ADDR)
    if ":" in listen_addr:
        host, port_str = listen_addr.rsplit(":", 1)
        host = host or "0.0.0.0"
        port = int(port_str)
    else:
        host, port = "0.0.0.0", int(listen_addr)

    agent_id = cred.get("agent_id", "local")
    server_url = cfg.get("server_url", "").rstrip("/")
    credential = cred.get("credential", "")
    client_cert_path = cred.get("client_cert_path", "")
    client_key_path = cred.get("client_key_path", "")
    ca_cert_path = cred.get("ca_cert_path", "")
    has_mtls = bool(client_cert_path and client_key_path and ca_cert_path)

    class MetricsHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/metrics"):
                body = render_prometheus_metrics(agent_id).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"infralab-agent exporter ok\\n")

        def log_message(self, format, *args):
            return

    def heartbeat_worker():
        headers = {"X-Agent-ID": agent_id}
        if not has_mtls and credential:
            headers["Authorization"] = f"Bearer {credential}"
        while True:
            try:
                ssl_ctx = build_ssl_context(ca_cert_path, client_cert_path, client_key_path) if has_mtls else None
                info = collect_system_info()
                post_json(
                    f"{server_url}/api/agents/heartbeat",
                    {"agent_id": agent_id, "version": VERSION, "hostname": info["hostname"]},
                    headers=headers,
                    ssl_ctx=ssl_ctx,
                )
                post_json(
                    f"{server_url}/api/agents/system-info",
                    {
                        "agent_id": agent_id,
                        "version": VERSION,
                        "hostname": info["hostname"],
                        "os_distribution": info["os_distribution"],
                        "kernel": info["kernel"],
                        "architecture": info["architecture"],
                        "cpu_count": info["cpu_count"],
                        "ram_total_bytes": info["ram_total_bytes"],
                        "uptime_seconds": info["uptime_seconds"],
                    },
                    headers=headers,
                    ssl_ctx=ssl_ctx,
                )
            except Exception:
                pass
            time.sleep(15)

    t = threading.Thread(target=heartbeat_worker, daemon=True)
    t.start()

    httpd = HTTPServer((host, port), MetricsHandler)
    print(f"[infralab-agent] serving Prometheus /metrics on http://{host}:{port}/metrics", flush=True)
    httpd.serve_forever()


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print("Usage:")
        print("  infralab-agent enroll --server https://infralab.example --token <TOKEN> [--ca-cert /path/to/ca.crt]")
        print("  infralab-agent run [--listen-addr :9101]")
        print("  infralab-agent version")
        sys.exit(0)

    sub = sys.argv[1]
    if sub in ("version", "--version", "-v"):
        print(f"infralab-agent v{VERSION}")
        return

    if sub == "enroll":
        p = argparse.ArgumentParser(prog="infralab-agent enroll")
        p.add_argument("--server", required=True)
        p.add_argument("--token", required=True)
        p.add_argument("--listen-addr", default=DEFAULT_LISTEN_ADDR)
        p.add_argument("--config", default=DEFAULT_CONFIG_PATH)
        p.add_argument("--credentials", default=DEFAULT_CRED_PATH)
        p.add_argument("--ca-cert", default="")
        cmd_enroll(p.parse_args(sys.argv[2:]))
        return

    if sub == "run":
        p = argparse.ArgumentParser(prog="infralab-agent run")
        p.add_argument("--listen-addr", default="")
        p.add_argument("--config", default=DEFAULT_CONFIG_PATH)
        p.add_argument("--credentials", default=DEFAULT_CRED_PATH)
        cmd_run(p.parse_args(sys.argv[2:]))
        return

    print(f"Unknown subcommand: {sub}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
`;
