/**
 * SimilarAnalysesPanel - Shows similar past analyses as precedent cards
 *
 * After a building impact analysis runs, this component queries Moorcheh
 * for similar past analyses and displays them as context cards.
 * Demonstrates the community memory growing over time.
 */

import React, { useEffect, useState } from "react";
import "./SimilarAnalysesPanel.css";

interface ParsedAnalysis {
  type?: string;
  location?: { lng: number; lat: number };
  building?: {
    type: string;
    height: number;
    footprint: number;
    stories: number;
  };
  impacts?: {
    traffic?: Record<string, unknown>;
    air_quality?: Record<string, unknown>;
    noise?: Record<string, unknown>;
    economic?: Record<string, unknown>;
  };
  overall?: {
    risk: string;
    severity: number;
  };
  narrative?: string;
  timestamp?: string;
}

interface SimilarResult {
  content: string;
  metadata: Record<string, string>;
  score: number;
  parsed: ParsedAnalysis;
}

interface SimilarAnalysesPanelProps {
  buildingLocation: [number, number] | null;
  buildingType: string;
  buildingHeight: number;
  buildingFootprint: number;
  isVisible: boolean;
}

export const SimilarAnalysesPanel: React.FC<SimilarAnalysesPanelProps> = ({
  buildingLocation,
  buildingType,
  buildingHeight,
  buildingFootprint,
  isVisible,
}) => {
  const [results, setResults] = useState<SimilarResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isVisible || !buildingLocation) {
      setResults([]);
      return;
    }

    const fetchSimilar = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("http://localhost:3001/api/moorcheh/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: buildingLocation,
            building_type: buildingType,
            height: buildingHeight,
            footprint: buildingFootprint,
            top_k: 3,
          }),
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const data = await response.json();
        if (data.success && data.results) {
          setResults(data.results.filter((r: SimilarResult) => r.parsed && r.parsed.type));
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchSimilar();
  }, [buildingLocation, buildingType, buildingHeight, buildingFootprint, isVisible]);

  if (!isVisible) return null;

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low": return "#28a745";
      case "medium": return "#ffc107";
      case "high": return "#fd7e14";
      case "critical": return "#dc3545";
      default: return "#6c757d";
    }
  };

  const formatDistance = (loc1: [number, number], loc2?: { lng: number; lat: number }) => {
    if (!loc2) return "";
    const R = 6371000;
    const dLat = ((loc2.lat - loc1[1]) * Math.PI) / 180;
    const dLon = ((loc2.lng - loc1[0]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((loc1[1] * Math.PI) / 180) *
        Math.cos((loc2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return d < 1000 ? `${Math.round(d)}m away` : `${(d / 1000).toFixed(1)}km away`;
  };

  return (
    <div className="similar-analyses-panel">
      <div className="similar-header">
        <h4>Similar Past Analyses</h4>
        <span className="similar-subtitle">Community memory precedents</span>
      </div>

      {loading && (
        <div className="similar-loading">
          <div className="similar-spinner"></div>
          <span>Searching community memory...</span>
        </div>
      )}

      {error && (
        <div className="similar-error">
          Memory service unavailable. Start the Moorcheh service to see past analyses.
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="similar-empty">
          <p>No similar analyses found yet. Each analysis you run enriches the community's shared knowledge.</p>
        </div>
      )}

      {results.map((result, i) => {
        const p = result.parsed;
        const building = p.building;
        const overall = p.overall;

        return (
          <div key={i} className="similar-card">
            <div className="similar-card-header">
              <span
                className="similar-risk-badge"
                style={{ backgroundColor: getRiskColor(overall?.risk || "medium") }}
              >
                {(overall?.risk || "medium").toUpperCase()}
              </span>
              <span className="similar-card-type">
                {building?.type || "Unknown"} Building
              </span>
              {buildingLocation && (
                <span className="similar-card-distance">
                  {formatDistance(buildingLocation, p.location)}
                </span>
              )}
            </div>

            <div className="similar-card-stats">
              {building?.height && (
                <div className="similar-stat">
                  <span className="stat-label">Height</span>
                  <span className="stat-value">{building.height}m</span>
                </div>
              )}
              {building?.stories && (
                <div className="similar-stat">
                  <span className="stat-label">Stories</span>
                  <span className="stat-value">{building.stories}</span>
                </div>
              )}
              {overall?.severity && (
                <div className="similar-stat">
                  <span className="stat-label">Severity</span>
                  <span className="stat-value">{overall.severity}/10</span>
                </div>
              )}
            </div>

            {p.narrative && (
              <p className="similar-card-narrative">
                {p.narrative.length > 150
                  ? p.narrative.substring(0, 150) + "..."
                  : p.narrative}
              </p>
            )}

            {p.timestamp && (
              <div className="similar-card-footer">
                Analyzed: {new Date(p.timestamp).toLocaleDateString()}
              </div>
            )}
          </div>
        );
      })}

      {results.length > 0 && (
        <div className="similar-memory-note">
          Retrieved via Moorcheh semantic search &middot; 32x compressed memory
        </div>
      )}
    </div>
  );
};
