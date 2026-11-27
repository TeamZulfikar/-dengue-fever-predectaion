"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import { Layers, RotateCcw } from "lucide-react";
import type { DistrictSummary } from "@/types/dengue";

interface BangladeshMapProps {
  districts: DistrictSummary[];
  selectedDivision: string | null;
  selectedDistrict: string | null;
  onSelectDivision: (division: string) => void;
  onSelectDistrict: (district: string) => void;
  onResetView?: () => void;
}

type BaseMapStyle = "dark" | "satellite" | "minimal";
type MapMetric = "pred" | "actual";

function heatColor(value: number): string {
  if (value >= 150) return "#dc2626";
  if (value >= 100) return "#ef4444";
  if (value >= 50) return "#f97316";
  if (value >= 20) return "#f59e0b";
  if (value >= 5) return "#10b981";
  return "#059669";
}

export default function BangladeshMap({
  districts,
  selectedDivision,
  selectedDistrict,
  onSelectDivision,
  onSelectDistrict,
  onResetView,
}: BangladeshMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [baseStyle, setBaseStyle] = useState<BaseMapStyle>("dark");
  const [metric, setMetric] = useState<MapMetric>("pred");

  const districtLookup = useRef<Map<string, DistrictSummary>>(new Map());
  districtLookup.current = new Map(districts.map((d) => [d.district, d]));

  const stateRef = useRef({
    selectedDivision,
    selectedDistrict,
    metric,
    onSelectDivision,
    onSelectDistrict,
  });
  stateRef.current = {
    selectedDivision,
    selectedDistrict,
    metric,
    onSelectDivision,
    onSelectDistrict,
  };

  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const leaflet = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      const map = leaflet.map(containerRef.current, {
        center: [23.75, 90.35],
        zoom: 7,
        minZoom: 6,
        maxZoom: 12,
        zoomControl: true,
        attributionControl: false,
      });

      mapRef.current = map;

      const tile = leaflet
        .tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19 }
        )
        .addTo(map);
      tileRef.current = tile;

      const res = await fetch("/bangladesh-districts.geojson");
      const geo = (await res.json()) as GeoJSON.FeatureCollection;
      if (cancelled) return;

      const layer = leaflet
        .geoJSON(geo, {
          style: (feature) => {
            const name = String(feature?.properties?.district ?? "");
            const div = String(feature?.properties?.division ?? "");
            const info = districtLookup.current.get(name);
            const val = info
              ? stateRef.current.metric === "pred"
                ? info.pred_blend
                : info.actual_cases ?? 0
              : 0;
            const color = heatColor(val);
            const isSelectedDist = stateRef.current.selectedDistrict === name;
            const isInSelectedDiv = stateRef.current.selectedDivision === div;
            const dimmed =
              stateRef.current.selectedDivision !== null &&
              !isInSelectedDiv &&
              !isSelectedDist;

            return {
              color: isSelectedDist
                ? "#ffffff"
                : isInSelectedDiv
                  ? "#e2e8f0"
                  : "#0f172a",
              weight: isSelectedDist ? 2.8 : isInSelectedDiv ? 1.5 : 0.9,
              fillColor: color,
              fillOpacity: dimmed ? 0.18 : isSelectedDist ? 0.9 : 0.72,
            };
          },
          onEachFeature: (feature, featureLayer) => {
            const name = String(feature.properties?.district ?? "");
            const div = String(feature.properties?.division ?? "");
            const info = districtLookup.current.get(name);
            const predText = info ? `${info.pred_blend}` : "N/A";
            const actualText =
              info?.actual_cases !== null && info?.actual_cases !== undefined
                ? `${info.actual_cases}`
                : "N/A";

            featureLayer.bindTooltip(
              `<div style="font-size:12px;line-height:1.45;min-width:130px">
                <div style="font-weight:700;color:#0f172a">${name} <span style="font-weight:400;color:#475569">(${div})</span></div>
                <div style="margin-top:2px">পূর্বাভাস: <b style="color:#0284c7">${predText}</b></div>
                <div>আসল (Observed): <b>${actualText}</b></div>
              </div>`,
              { sticky: true }
            );

            featureLayer.on("mouseover", () => {
              (featureLayer as L.Path).setStyle({
                weight: 2.2,
                color: "#38bdf8",
                fillOpacity: 0.88,
              });
            });

            featureLayer.on("mouseout", () => {
              layer.resetStyle(featureLayer as L.Path);
            });

            featureLayer.on("click", () => {
              if (
                !stateRef.current.selectedDivision ||
                stateRef.current.selectedDivision !== div
              ) {
                stateRef.current.onSelectDivision(div);
              } else {
                stateRef.current.onSelectDistrict(name);
              }
            });
          },
        })
        .addTo(map);

      layerRef.current = layer;

      const markersGroup = leaflet.layerGroup().addTo(map);
      markersRef.current = markersGroup;

      const top3 = [...districts]
        .sort((a, b) => b.pred_blend - a.pred_blend)
        .slice(0, 3);
      for (const d of top3) {
        leaflet
          .circleMarker([d.lat, d.lon], {
            radius: 6,
            color: "#ffffff",
            weight: 1.5,
            fillColor: "#ef4444",
            fillOpacity: 0.95,
          })
          .bindTooltip(`শীর্ষ ঝুঁকি: ${d.district} (${d.pred_blend})`)
          .on("click", () => stateRef.current.onSelectDistrict(d.district))
          .addTo(markersGroup);
      }

      map.fitBounds(layer.getBounds(), { padding: [14, 14] });
    }

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
        tileRef.current = null;
        markersRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch tile layer style (zero-API-key Esri Dark Gray / Esri Satellite / Minimal)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    import("leaflet").then(({ default: leaflet }) => {
      if (tileRef.current) {
        map.removeLayer(tileRef.current);
        tileRef.current = null;
      }
      if (baseStyle === "dark") {
        tileRef.current = leaflet
          .tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 19 }
          )
          .addTo(map);
        tileRef.current.bringToBack();
      } else if (baseStyle === "satellite") {
        tileRef.current = leaflet
          .tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 19 }
          )
          .addTo(map);
        tileRef.current.bringToBack();
      }
    });
  }, [baseStyle]);

  // Update polygon styles & flyToBounds on selection or metric change
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.setStyle((feature) => {
      const name = String(feature?.properties?.district ?? "");
      const div = String(feature?.properties?.division ?? "");
      const info = districtLookup.current.get(name);
      const val = info
        ? metric === "pred"
          ? info.pred_blend
          : info.actual_cases ?? 0
        : 0;
      const color = heatColor(val);
      const isSelectedDist = selectedDistrict === name;
      const isInSelectedDiv = selectedDivision === div;
      const dimmed =
        selectedDivision !== null && !isInSelectedDiv && !isSelectedDist;

      return {
        color: isSelectedDist
          ? "#ffffff"
          : isInSelectedDiv
            ? "#e2e8f0"
            : "#0f172a",
        weight: isSelectedDist ? 2.8 : isInSelectedDiv ? 1.5 : 0.9,
        fillColor: color,
        fillOpacity: dimmed ? 0.18 : isSelectedDist ? 0.9 : 0.72,
      };
    });

    if (selectedDistrict) {
      let targetLayer: L.Layer | null = null;
      layer.eachLayer((l) => {
        const feat = (l as L.GeoJSON & { feature?: GeoJSON.Feature }).feature;
        if (feat?.properties?.district === selectedDistrict) {
          targetLayer = l;
        }
      });
      if (targetLayer) {
        const bounds = (targetLayer as L.Polygon).getBounds();
        map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 9, duration: 0.6 });
      }
    } else if (selectedDivision) {
      const matchingLayers: L.Layer[] = [];
      layer.eachLayer((l) => {
        const feat = (l as L.GeoJSON & { feature?: GeoJSON.Feature }).feature;
        if (feat?.properties?.division === selectedDivision) {
          matchingLayers.push(l);
        }
      });
      if (matchingLayers.length > 0) {
        import("leaflet").then(({ default: leaflet }) => {
          const group = leaflet.featureGroup(matchingLayers);
          map.flyToBounds(group.getBounds(), {
            padding: [20, 20],
            maxZoom: 8,
            duration: 0.6,
          });
        });
      }
    } else {
      map.flyToBounds(layer.getBounds(), { padding: [14, 14], duration: 0.5 });
    }
  }, [districts, selectedDivision, selectedDistrict, metric]);

  function handleReset() {
    if (onResetView) onResetView();
    if (mapRef.current && layerRef.current) {
      mapRef.current.flyToBounds(layerRef.current.getBounds(), {
        padding: [14, 14],
        duration: 0.5,
      });
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-[#060b16] shadow-2xl">
      {/* Floating Map Controls */}
      <div className="pointer-events-none absolute right-2.5 top-2.5 z-[400] flex flex-wrap items-center justify-end gap-1.5">
        <div className="pointer-events-auto flex items-center rounded-lg border border-slate-700/80 bg-slate-950/90 p-0.5 text-[11px] backdrop-blur">
          <button
            type="button"
            onClick={() => setMetric("pred")}
            className={`rounded-md px-2 py-1 font-medium transition ${
              metric === "pred"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            পূর্বাভাস
          </button>
          <button
            type="button"
            onClick={() => setMetric("actual")}
            className={`rounded-md px-2 py-1 font-medium transition ${
              metric === "actual"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            আসল কেস
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            setBaseStyle((s) =>
              s === "dark" ? "satellite" : s === "satellite" ? "minimal" : "dark"
            )
          }
          className="pointer-events-auto flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 backdrop-blur transition hover:bg-slate-800"
          title="বেস ম্যাপ পরিবর্তন করুন"
        >
          <Layers className="h-3.5 w-3.5 text-sky-400" />
          <span>
            {baseStyle === "dark"
              ? "ডার্ক"
              : baseStyle === "satellite"
                ? "স্যাটেলাইট"
                : "মিনিমাল"}
          </span>
        </button>

        {(selectedDivision || selectedDistrict) && (
          <button
            type="button"
            onClick={handleReset}
            className="pointer-events-auto flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-[11px] font-medium text-sky-300 backdrop-blur transition hover:bg-slate-800"
          >
            <RotateCcw className="h-3 w-3" />
            <span>রিসেট</span>
          </button>
        )}
      </div>

      <div ref={containerRef} className="h-[420px] w-full sm:h-[490px]" />

      {/* Gradient Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-[11px] text-slate-300">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-slate-400">
            {metric === "pred" ? "পূর্বাভাস:" : "আসল:"}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#059669]" />
            &lt;৫
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#10b981]" />
            ৫–১৯
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
            ২০–৪৯
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f97316]" />
            ৫০–৯৯
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
            ১০০–১৪৯
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
            ১৫০+
          </span>
        </div>
        <span className="text-slate-400">
          লাল বিন্দু = শীর্ষ ৩ ঝুঁকিপূর্ণ জেলা
        </span>
      </div>
    </div>
  );
}
