import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  buildPromQLQueriesForServer,
  clearServerPrometheusCache,
  fetchServerMonitoringMetrics,
  getRangeWindowSpec,
  parseMonitoringTimeRange,
} from '../src/server/prometheusClient.ts';
import type { MonitoringTimeRange, ServerMonitoringResponse } from '../src/types/server.ts';

describe('Prometheus Monitoring & Range / Refresh Lifecycle Regression Suite', () => {
  const dummyServer = {
    id: 999001,
    name: 'monitoring-test-node',
    hostname: 'monitoring-test.internal',
    ipAddress: '127.0.0.254',
    status: 'online',
    cpuUsagePercent: 24,
    memoryMb: 8192,
    memoryUsedMb: 2800,
    diskTotalGb: '80',
    diskUsedGb: '24',
    diskUsagePercent: 30,
    uptimeInfo: 'up 5 days',
  };

  it('validates 1h, 6h, 24h, and 7d window specs, start/end timestamps, step, and PromQL queries', async () => {
    clearServerPrometheusCache(dummyServer.id);
    const ranges: MonitoringTimeRange[] = ['1h', '6h', '24h', '7d'];
    const expectedSpecs: Record<
      MonitoringTimeRange,
      { duration: number; step: number; points: number }
    > = {
      '1h': { duration: 3600, step: 120, points: 30 },
      '6h': { duration: 21600, step: 600, points: 36 },
      '24h': { duration: 86400, step: 1800, points: 48 },
      '7d': { duration: 604800, step: 10800, points: 56 },
    };

    const resultsByRange = new Map<MonitoringTimeRange, ServerMonitoringResponse>();

    for (const r of ranges) {
      assert.equal(parseMonitoringTimeRange(r), r);
      const spec = getRangeWindowSpec(r);
      assert.equal(spec.durationSeconds, expectedSpecs[r].duration);
      assert.equal(spec.stepSeconds, expectedSpecs[r].step);
      assert.equal(spec.pointCount, expectedSpecs[r].points);

      const beforeSec = Math.floor(Date.now() / 1000);
      const res = await fetchServerMonitoringMetrics({
        server: dummyServer,
        range: r,
        prometheusBaseUrl: 'http://127.0.0.1:59999',
      });
      const afterSec = Math.floor(Date.now() / 1000);

      assert.equal(res.range, r);
      assert.equal(res.step_seconds, expectedSpecs[r].step);
      assert.equal(res.series.length, expectedSpecs[r].points);

      const firstSec = Math.floor(new Date(res.series[0].timestamp).getTime() / 1000);
      const lastSec = Math.floor(
        new Date(res.series[res.series.length - 1].timestamp).getTime() / 1000
      );

      assert.ok(
        lastSec >= beforeSec && lastSec <= afterSec,
        `Expected last timestamp (${lastSec}) to match now (${beforeSec}..${afterSec})`
      );
      assert.equal(
        lastSec - firstSec,
        expectedSpecs[r].duration,
        `Expected window span for ${r} to equal ${expectedSpecs[r].duration}s`
      );

      const expectedPromQL = buildPromQLQueriesForServer(dummyServer.id);
      assert.deepEqual(res.promql_queries, expectedPromQL);

      resultsByRange.set(r, res);
    }

    // Verify 1h, 6h, 24h, and 7d do not return identical historical series
    const series1h = resultsByRange.get('1h')!.series.map((p) => p.cpu_percent);
    const series6h = resultsByRange.get('6h')!.series.map((p) => p.cpu_percent);
    const series24h = resultsByRange.get('24h')!.series.map((p) => p.cpu_percent);
    const series7d = resultsByRange.get('7d')!.series.map((p) => p.cpu_percent);

    assert.notDeepEqual(series1h.slice(0, 10), series24h.slice(0, 10));
    assert.notDeepEqual(series24h.slice(0, 10), series7d.slice(0, 10));
    assert.notDeepEqual(series1h.slice(0, 10), series6h.slice(0, 10));
  });

  it('prevents useServerTelemetry cache updates from invalidating monitoring or self-looping', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let telemetryFetchCount = 0;
    let monitoringFetchCount = 0;

    queryClient.setQueryData(['servers'], [{ id: 2, name: 'node-2', status: 'online' }]);

    const monitoringObserver = new QueryObserver(queryClient, {
      queryKey: ['servers', 2, 'monitoring', '1h'],
      queryFn: async () => {
        monitoringFetchCount++;
        return { range: '1h', step_seconds: 120, series: [] };
      },
    });

    const telemetryObserver = new QueryObserver(queryClient, {
      queryKey: ['servers', 2, 'telemetry'],
      queryFn: async () => {
        telemetryFetchCount++;
        const updatedServer = { id: 2, name: 'node-2', status: 'online' };
        queryClient.setQueryData(['servers', 2], updatedServer);
        queryClient.setQueryData(['servers'], (prev: any) =>
          Array.isArray(prev)
            ? prev.map((srv) => (srv.id === updatedServer.id ? updatedServer : srv))
            : prev
        );
        return { server: updatedServer };
      },
    });

    const unsubMon = monitoringObserver.subscribe(() => {});
    const unsubTel = telemetryObserver.subscribe(() => {});

    await new Promise((r) => setTimeout(r, 120));

    unsubMon();
    unsubTel();

    assert.equal(telemetryFetchCount, 1, 'Telemetry query must execute exactly once on mount');
    assert.equal(
      monitoringFetchCount,
      1,
      'Monitoring query must execute exactly once and not be invalidated by telemetry'
    );
    assert.equal(
      monitoringObserver.getCurrentResult().isFetching,
      false,
      'Monitoring query must return to idle (isFetching=false)'
    );
  });

  it('performs exactly one request on manual Refresh click and returns to idle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let requestCount = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['servers', 2, 'monitoring', '1h'],
      queryFn: async () => {
        requestCount++;
        await new Promise((r) => setTimeout(r, 15));
        return { range: '1h', requestCount };
      },
    });

    const unsub = observer.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(requestCount, 1);
    assert.equal(observer.getCurrentResult().isFetching, false);

    // Simulate 1 click on "Обновить PromQL"
    const refetchPromise = observer.refetch();
    assert.equal(observer.getCurrentResult().isFetching, true);
    const refreshed = await refetchPromise;
    assert.equal(requestCount, 2, 'One refresh click must trigger exactly one API request');
    assert.equal(refreshed.data?.requestCount, 2);
    assert.equal(
      observer.getCurrentResult().isFetching,
      false,
      'After refresh completes, isFetching must be false'
    );

    unsub();
  });

  it('handles range switching (1h -> 24h) and rapid switching (1h -> 6h -> 24h -> 7d) without stale overwrite', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const abortedRanges: MonitoringTimeRange[] = [];

    const makeOptions = (range: MonitoringTimeRange, artificialDelayMs: number) => ({
      queryKey: ['servers', 2, 'monitoring', range] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, artificialDelayMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            abortedRanges.push(range);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
        return fetchServerMonitoringMetrics({
          server: dummyServer,
          range,
          prometheusBaseUrl: 'http://127.0.0.1:59999',
        });
      },
    });

    const waitForRangeData = (
      obs: QueryObserver<ServerMonitoringResponse>,
      expectedRange: MonitoringTimeRange
    ) =>
      new Promise<ServerMonitoringResponse>((resolve, reject) => {
        const current = obs.getCurrentResult();
        if (!current.isFetching && current.data?.range === expectedRange) {
          resolve(current.data);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for range ${expectedRange}`)),
          4000
        );
        const unsubWait = obs.subscribe((res) => {
          if (!res.isFetching && res.data?.range === expectedRange) {
            clearTimeout(timer);
            unsubWait();
            resolve(res.data);
          }
        });
      });

    const observer = new QueryObserver<ServerMonitoringResponse>(
      queryClient,
      makeOptions('1h', 10)
    );
    const unsub = observer.subscribe(() => {});

    // 1. Wait for initial 1h load
    const data1h = await waitForRangeData(observer, '1h');
    assert.equal(data1h.range, '1h');
    assert.equal(data1h.series.length, 30);

    // 2. Switch 1h -> 24h
    observer.setOptions(makeOptions('24h', 10));
    const data24h = await waitForRangeData(observer, '24h');
    assert.equal(data24h.range, '24h');
    assert.equal(data24h.step_seconds, 1800);
    assert.equal(data24h.series.length, 48);

    // 3. Rapid switching: 1h -> 6h (slow 180ms) -> 7d (fast 15ms)
    observer.setOptions(makeOptions('6h', 180));
    await new Promise((r) => setTimeout(r, 10));
    observer.setOptions(makeOptions('7d', 15));

    const data7d = await waitForRangeData(observer, '7d');
    // Wait past the 180ms mark to prove a slow 6h response never overwrites 7d
    await new Promise((r) => setTimeout(r, 200));

    const finalResult = observer.getCurrentResult();
    assert.equal(finalResult.data?.range, '7d', 'Final data must match last selected range (7d)');
    assert.equal(data7d.step_seconds, 10800);
    assert.equal(finalResult.data?.series.length, 56);
    assert.equal(finalResult.isFetching, false);
    assert.ok(
      abortedRanges.includes('6h'),
      'In-flight stale range request (6h) should be aborted on rapid switch'
    );

    unsub();
  });
});
