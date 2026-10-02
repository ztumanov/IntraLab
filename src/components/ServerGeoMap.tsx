import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Activity,
  Box,
  Compass,
  FileText,
  Globe,
  Maximize2,
  Navigation,
  RefreshCw,
  Server as ServerIcon,
  Terminal,
} from 'lucide-react';
import { ServerGeoLocation } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';
import { useCheckServerConnection } from '../hooks/useServers.ts';

const GOOGLE_MAPS_API_KEY =
  ((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string) || '';

export interface MapSelectionState {
  selectedServerId: number | null;
  hasInitialized: boolean;
}

export function createInitialMapSelectionState(
  filteredServerIds: number[],
  compact = false
): MapSelectionState {
  if (!compact && filteredServerIds.length > 0) {
    return {
      selectedServerId: filteredServerIds[0],
      hasInitialized: true,
    };
  }
  return {
    selectedServerId: null,
    hasInitialized: false,
  };
}

export function syncMapSelectionWithLocations(
  state: MapSelectionState,
  filteredServerIds: number[],
  compact = false
): MapSelectionState {
  if (!state.hasInitialized) {
    if (!compact && filteredServerIds.length > 0) {
      return {
        selectedServerId: filteredServerIds[0],
        hasInitialized: true,
      };
    }
    return state;
  }

  if (state.selectedServerId === null) {
    return state;
  }

  if (!filteredServerIds.includes(state.selectedServerId)) {
    return {
      selectedServerId: null,
      hasInitialized: true,
    };
  }

  return state;
}

export function selectMapServer(
  _state: MapSelectionState,
  serverId: number
): MapSelectionState {
  return {
    selectedServerId: serverId,
    hasInitialized: true,
  };
}

export function closeMapServerPopup(_state: MapSelectionState): MapSelectionState {
  return {
    selectedServerId: null,
    hasInitialized: true,
  };
}

interface CameraControllerProps {
  locations: ServerGeoLocation[];
  selectedServerId: number | null;
  fitTrigger: number;
}

const CameraController: React.FC<CameraControllerProps> = ({
  locations,
  selectedServerId,
  fitTrigger,
}) => {
  const map = useMap();
  const locationsRef = React.useRef(locations);
  locationsRef.current = locations;

  useEffect(() => {
    if (!map || selectedServerId === null) return;

    const target = locationsRef.current.find((item) => item.server.id === selectedServerId);
    if (target) {
      map.panTo({ lat: target.lat, lng: target.lng });
      const currentZoom = map.getZoom() ?? 4;
      if (currentZoom < 6) {
        map.setZoom(7);
      }
    }
  }, [map, selectedServerId]);

  useEffect(() => {
    if (!map || fitTrigger === 0 || locationsRef.current.length === 0) return;

    const currentLocations = locationsRef.current;
    if (currentLocations.length === 1) {
      map.panTo({ lat: currentLocations[0].lat, lng: currentLocations[0].lng });
      map.setZoom(6);
      return;
    }

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;

    for (const loc of currentLocations) {
      if (loc.lat < minLat) minLat = loc.lat;
      if (loc.lat > maxLat) maxLat = loc.lat;
      if (loc.lng < minLng) minLng = loc.lng;
      if (loc.lng > maxLng) maxLng = loc.lng;
    }

    const latSpan = Math.abs(maxLat - minLat);
    const lngSpan = Math.abs(maxLng - minLng);

    if (latSpan < 0.05 && lngSpan < 0.05) {
      map.panTo({ lat: currentLocations[0].lat, lng: currentLocations[0].lng });
      map.setZoom(8);
    } else {
      map.fitBounds(
        {
          north: maxLat + 2,
          south: minLat - 2,
          east: maxLng + 3,
          west: minLng - 3,
        },
        48
      );
    }
  }, [map, fitTrigger]);

  return null;
};

interface ServerMarkerItemProps {
  item: ServerGeoLocation;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onCloseInfoWindow: () => void;
}

const ServerMarkerItem: React.FC<ServerMarkerItemProps> = ({
  item,
  isSelected,
  onSelect,
  onCloseInfoWindow,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const { t } = useI18n();
  const { server } = item;

  const statusColor =
    server.status === 'online'
      ? 'border-emerald-400 bg-slate-900/95 text-emerald-300 shadow-emerald-950/60'
      : server.status === 'offline'
      ? 'border-rose-500 bg-slate-900/95 text-rose-300 shadow-rose-950/60'
      : 'border-amber-400 bg-slate-900/95 text-amber-300 shadow-amber-950/60';

  const dotColor =
    server.status === 'online'
      ? 'bg-emerald-400'
      : server.status === 'offline'
      ? 'bg-rose-500'
      : 'bg-amber-400';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: item.lat, lng: item.lng }}
        onClick={() => onSelect(server.id)}
        title={`${server.name} (${server.ip_address}) — ${item.city}, ${item.country}`}
        zIndex={isSelected ? 50 : server.status === 'online' ? 20 : 10}
      >
        <div
          className={`group relative flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-xs shadow-lg transition-transform duration-150 ${statusColor} ${
            isSelected ? 'scale-110 ring-2 ring-emerald-400/60' : 'hover:scale-105'
          }`}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {server.status === 'online' && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
          </span>
          <span className="max-w-[130px] truncate font-semibold text-slate-100">
            {server.name}
          </span>
          <span className="text-[10px] font-normal text-slate-400">{item.country_code}</span>
          {server.status === 'online' && server.latency_ms !== null && (
            <span className="border-l border-slate-700 pl-1.5 text-[10px] text-emerald-400 tabular-nums">
              {server.latency_ms}ms
            </span>
          )}
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={310} onCloseClick={onCloseInfoWindow}>
          <div className="min-w-[240px] space-y-2 p-1 text-slate-900">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{server.name}</p>
                <p className="truncate font-mono text-[11px] text-slate-600">
                  {server.username}@{server.ip_address}:{server.ssh_port}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                  server.status === 'online'
                    ? 'bg-emerald-100 text-emerald-800'
                    : server.status === 'offline'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {server.status}
              </span>
            </div>

            <div className="space-y-1 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t('Локация:', 'Location:')}</span>
                <span className="truncate font-medium text-slate-900">
                  {item.city}, {item.country_code}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t('Провайдер:', 'Provider:')}</span>
                <span className="max-w-[165px] truncate font-medium text-slate-900">
                  {item.isp}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t('Координаты:', 'Coords:')}</span>
                <span className="font-mono text-[11px] text-slate-800 tabular-nums">
                  {item.lat.toFixed(3)}, {item.lng.toFixed(3)}
                </span>
              </div>
              {server.status === 'online' && (
                <div className="flex items-center justify-between gap-2 pt-0.5 font-mono text-[11px]">
                  <span className="text-slate-600">
                    CPU: <strong>{server.cpu_usage_percent ?? 0}%</strong>
                  </span>
                  <span className="text-slate-600">
                    Disk: <strong>{server.disk_usage_percent ?? 0}%</strong>
                  </span>
                  <span className="text-emerald-700">
                    SSH: <strong>{server.latency_ms ?? 1}ms</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs font-semibold">
              <Link
                to={`/servers/${server.id}`}
                className="text-emerald-700 hover:text-emerald-900 hover:underline"
              >
                {t('SSH Консоль →', 'SSH Console →')}
              </Link>
              <Link
                to={`/metrics?serverId=${server.id}`}
                className="text-sky-700 hover:text-sky-900 hover:underline"
              >
                {t('Метрики', 'Metrics')}
              </Link>
              <Link
                to={`/containers?serverId=${server.id}`}
                className="text-indigo-700 hover:text-indigo-900 hover:underline"
              >
                Docker
              </Link>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface ServerGeoMapProps {
  locations: ServerGeoLocation[];
  isLoading?: boolean;
  compact?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const ServerGeoMap: React.FC<ServerGeoMapProps> = ({
  locations,
  isLoading = false,
  compact = false,
  onRefresh,
  isRefreshing = false,
}) => {
  const { t } = useI18n();
  const checkServerMutation = useCheckServerConnection();
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [fitTrigger, setFitTrigger] = useState(() => (compact ? 1 : 0));

  const filteredLocations = useMemo(() => {
    if (statusFilter === 'all') return locations;
    if (statusFilter === 'online') {
      return locations.filter((l) => l.server.status === 'online');
    }
    return locations.filter((l) => l.server.status !== 'online');
  }, [locations, statusFilter]);

  const filteredServerIds = useMemo(
    () => filteredLocations.map((l) => l.server.id),
    [filteredLocations]
  );

  const [selectionState, setSelectionState] = useState<MapSelectionState>(() =>
    createInitialMapSelectionState(
      locations.map((l) => l.server.id),
      compact
    )
  );

  useEffect(() => {
    setSelectionState((prev) => {
      const next = syncMapSelectionWithLocations(prev, filteredServerIds, compact);
      if (
        next.selectedServerId === prev.selectedServerId &&
        next.hasInitialized === prev.hasInitialized
      ) {
        return prev;
      }
      return next;
    });
  }, [filteredServerIds, compact]);

  const selectedServerId = selectionState.selectedServerId;

  const handleSelectServer = (serverId: number) => {
    setSelectionState((prev) => selectMapServer(prev, serverId));
  };

  const handleCloseInfoWindow = () => {
    setSelectionState((prev) => closeMapServerPopup(prev));
  };

  const selectedLocation = useMemo(
    () => locations.find((l) => l.server.id === selectedServerId) ?? null,
    [locations, selectedServerId]
  );

  const defaultCenter = useMemo(() => {
    if (locations.length > 0) {
      return { lat: locations[0].lat, lng: locations[0].lng };
    }
    return { lat: 50.1109, lng: 8.6821 }; // Frankfurt default
  }, [locations]);

  const handleFitAll = () => {
    setSelectionState((prev) => closeMapServerPopup(prev));
    setFitTrigger((prev) => prev + 1);
  };

  return (
    <div className="space-y-4">
      {/* Map Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#1E293B] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Globe className="h-4 w-4 text-emerald-400" />
            <span>
              {t('Геопозиция узлов (IP Geo-Topology)', 'Node Geolocation (IP Geo-Topology)')}
            </span>
          </div>

          <div className="flex items-center rounded-md border border-slate-700 bg-[#0F172A] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Все', 'All')} ({locations.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('online')}
              className={`rounded px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'online'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Online ({locations.filter((l) => l.server.status === 'online').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('offline')}
              className={`rounded px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'offline'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Offline / Unknown ({locations.filter((l) => l.server.status !== 'online').length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleFitAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap"
          >
            <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
            <span>{t('Показать все узлы', 'Fit All Nodes')}</span>
          </button>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>{t('Обновить геоданные', 'Refresh Geo')}</span>
            </button>
          )}

          {compact && (
            <Link
              to="/map"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
            >
              <Compass className="h-3.5 w-3.5" />
              <span>{t('Открыть карту →', 'Full Map →')}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Main Map + Node Sidebar Grid */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          compact ? 'lg:grid-cols-3' : 'lg:grid-cols-12'
        }`}
      >
        {/* Google Maps Viewport */}
        <div
          className={`relative overflow-hidden rounded-lg border border-slate-800 bg-[#0F172A] ${
            compact ? 'h-[380px] lg:col-span-2' : 'h-[540px] lg:col-span-8'
          }`}
        >
          {isLoading ? (
            <div className="flex h-full w-full items-center justify-center bg-[#0F172A] text-xs text-slate-400">
              {t('Определение геопозиции серверов по IP...', 'Resolving server IP geolocations...')}
            </div>
          ) : !GOOGLE_MAPS_API_KEY ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0F172A] p-6 text-center">
              <Globe className="h-8 w-8 text-slate-500" />
              <p className="text-sm font-medium text-slate-200">
                {t(
                  'Ключ Google Maps API не обнаружен в окружении',
                  'Google Maps API key is not configured in environment'
                )}
              </p>
              <p className="max-w-md text-xs text-slate-400">
                {t(
                  'Перезапустите страницу или проверьте переменную VITE_GOOGLE_MAPS_API_KEY.',
                  'Reload the page or verify VITE_GOOGLE_MAPS_API_KEY.'
                )}
              </p>
            </div>
          ) : (
            <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['marker']}>
              <Map
                mapId="DEMO_MAP_ID"
                defaultCenter={defaultCenter}
                defaultZoom={locations.length === 1 ? 6 : 4}
                gestureHandling="greedy"
                disableDefaultUI={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                className="h-full w-full"
              >
                <CameraController
                  locations={filteredLocations}
                  selectedServerId={selectedServerId}
                  fitTrigger={fitTrigger}
                />
                {filteredLocations.map((item) => (
                  <ServerMarkerItem
                    key={item.server.id}
                    item={item}
                    isSelected={selectedServerId === item.server.id}
                    onSelect={handleSelectServer}
                    onCloseInfoWindow={handleCloseInfoWindow}
                  />
                ))}
              </Map>
            </APIProvider>
          )}
        </div>

        {/* Geo Node Directory & Selected Server Inspector */}
        <div
          className={`flex flex-col justify-between rounded-lg border border-slate-800 bg-[#1E293B] p-4 ${
            compact ? 'h-[380px] lg:col-span-1' : 'h-[540px] lg:col-span-4'
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t('Серверы на карте', 'Mapped Nodes')} ({filteredLocations.length})
              </span>
              <span className="font-mono text-[11px] text-slate-500">IP → Lat/Lng</span>
            </div>

            {filteredLocations.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                {t('Нет серверов для отображения.', 'No servers match the current filter.')}
              </div>
            ) : (
              filteredLocations.map((loc) => {
                const active = selectedServerId === loc.server.id;
                return (
                  <button
                    key={loc.server.id}
                    type="button"
                    onClick={() => handleSelectServer(loc.server.id)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active
                        ? 'border-emerald-500/60 bg-[#0F172A] text-white'
                        : 'border-slate-800 bg-[#0F172A]/60 text-slate-300 hover:border-slate-700 hover:bg-[#0F172A]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            loc.server.status === 'online'
                              ? 'bg-emerald-400'
                              : loc.server.status === 'offline'
                              ? 'bg-rose-500'
                              : 'bg-amber-400'
                          }`}
                        />
                        <span className="truncate text-xs font-semibold text-slate-100">
                          {loc.server.name}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-emerald-400 tabular-nums">
                        {loc.country_code} · {loc.city}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
                      <span className="truncate">{loc.server.ip_address}</span>
                      <span className="shrink-0 tabular-nums">
                        {loc.lat.toFixed(2)}°, {loc.lng.toFixed(2)}°
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="truncate">{loc.isp}</span>
                      {loc.server.latency_ms !== null && (
                        <span className="shrink-0 font-mono text-slate-300 tabular-nums">
                          {loc.server.latency_ms}ms
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Selected Node Quick Inspector Footer */}
          {selectedLocation && (
            <div className="mt-3 border-t border-slate-800 pt-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-100">
                    {selectedLocation.server.name} · {selectedLocation.city},{' '}
                    {selectedLocation.country}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-400">
                    {selectedLocation.isp} {selectedLocation.asn ? `(${selectedLocation.asn})` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => checkServerMutation.mutate(selectedLocation.server.id)}
                  disabled={checkServerMutation.isPending}
                  title={t('Проверить SSH', 'Probe SSH')}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1 font-mono text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Navigation className="h-3 w-3 text-emerald-400" />
                  <span>Ping SSH</span>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                <Link
                  to={`/servers/${selectedLocation.server.id}`}
                  className="inline-flex items-center justify-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1.5 font-mono text-[11px] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <Terminal className="h-3 w-3" />
                  <span>SSH</span>
                </Link>
                <Link
                  to={`/metrics?serverId=${selectedLocation.server.id}`}
                  className="inline-flex items-center justify-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1.5 font-mono text-[11px] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <Activity className="h-3 w-3" />
                  <span>{t('Метрики', 'Metrics')}</span>
                </Link>
                <Link
                  to={`/containers?serverId=${selectedLocation.server.id}`}
                  className="inline-flex items-center justify-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1.5 font-mono text-[11px] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <Box className="h-3 w-3" />
                  <span>Docker</span>
                </Link>
                <Link
                  to={`/logs?serverId=${selectedLocation.server.id}`}
                  className="inline-flex items-center justify-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1.5 font-mono text-[11px] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <FileText className="h-3 w-3" />
                  <span>{t('Логи', 'Logs')}</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
