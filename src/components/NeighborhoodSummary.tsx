/**
 * NeighborhoodSummary - Aggregate community impact overlay
 *
 * Floating card on the map that shows cumulative impact data
 * for the neighborhood based on all stored analyses.
 * Framed as a community empowerment tool.
 */

import React, { useEffect, useState, useCallback } from "react";
import "./NeighborhoodSummary.css";

interface NeighborhoodData {
  total_analyses: number;
  average_severity: number;
  risk_distribution: Record<string, number>;
  building_types: Record<string, number>;
  analyses: Array<{
    location?: { lng: number; lat: number };
    building?: { type: string };
    overall?: { risk: string; severity: number };
    timestamp?: string;
  }>;
}

interface NeighborhoodSummaryProps {
  isVisible: boolean;
  centerPoint?: [number, number];
  onToggle: () => void;
}

export const NeighborhoodSummary: React.FC<NeighborhoodSummaryProps> = ({
  isVisible,
  centerPoint,
  onToggle,
}) => {
  const [data, setData] = useState<NeighborhoodData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(false);

    const query = centerPoint
      ? `Impact analyses near coordinates ${centerPoint[1].toFixed(4)}N, ${centerPoint[0].toFixed(4)}W in downtown Toronto`
      : "All impact analyses in downtown Toronto";

    try {
      const response = await fetch("http://localhost:3001/api/moorcheh/neighborhood-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: 20 }),
      });

      if (!response.ok) throw new Error("Failed");

      const result = await response.json();
      if (result.success) {
        setData(result);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [centerPoint]);

  useEffect(() => {
    if (isVisible) {
      fetchStats();
    }
  }, [isVisible, fetchStats]);

  const getSeverityColor = (severity: number) => {
    if (severity <= 3) return "#28a745";
    if (severity <= 5) return "#ffc107";
    if (severity <= 7) return "#fd7e14";
    return "#dc3545";
  };

  const getRiskBarWidth = (count: number, total: number) => {
    return total > 0 ? `${(count / total) * 100}%` : "0%";
  };

  return (
    <>
      {/* Toggle button - always visible */}
      <button
        className={`neighborhood-toggle ${isVisible ? "active" : ""}`}
        onClick={onToggle}
        title="Neighborhood Impact Summary"
      >
        <span className="neighborhood-toggle-icon">&#x1f3d8;</span>
        <span className="neighborhood-toggle-label">Community Impact</span>
      </button>

      {/* Summary panel */}
      {isVisible && (
        <div className="neighborhood-summary">
          <div className="neighborhood-header">
            <h4>Neighborhood Impact Summary</h4>
            <p className="neighborhood-tagline">
              Collective knowledge from community-generated analyses
            </p>
          </div>

          {loading && (
            <div className="neighborhood-loading">
              <div className="neighborhood-spinner"></div>
              <span>Querying community memory...</span>
            </div>
          )}

          {error && (
            <div className="neighborhood-error">
              Connect to Moorcheh service to view community insights.
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Key stats */}
              <div className="neighborhood-stats-grid">
                <div className="neighborhood-stat-card">
                  <div className="stat-number">{data.total_analyses}</div>
                  <div className="stat-desc">Analyses Stored</div>
                </div>
                <div className="neighborhood-stat-card">
                  <div
                    className="stat-number"
                    style={{ color: getSeverityColor(data.average_severity) }}
                  >
                    {data.average_severity}
                  </div>
                  <div className="stat-desc">Avg Severity</div>
                </div>
              </div>

              {/* Risk distribution */}
              {data.total_analyses > 0 && (
                <div className="neighborhood-section">
                  <h5>Risk Distribution</h5>
                  <div className="risk-bar-container">
                    {(["low", "medium", "high", "critical"] as const).map((risk) => {
                      const count = data.risk_distribution[risk] || 0;
                      if (count === 0) return null;
                      const colors: Record<string, string> = {
                        low: "#28a745",
                        medium: "#ffc107",
                        high: "#fd7e14",
                        critical: "#dc3545",
                      };
                      return (
                        <div
                          key={risk}
                          className="risk-bar-segment"
                          style={{
                            width: getRiskBarWidth(count, data.total_analyses),
                            backgroundColor: colors[risk],
                          }}
                          title={`${risk}: ${count}`}
                        >
                          {count > 0 && <span>{count}</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="risk-bar-legend">
                    <span style={{ color: "#28a745" }}>Low</span>
                    <span style={{ color: "#ffc107" }}>Med</span>
                    <span style={{ color: "#fd7e14" }}>High</span>
                    <span style={{ color: "#dc3545" }}>Crit</span>
                  </div>
                </div>
              )}

              {/* Building types */}
              {Object.keys(data.building_types).length > 0 && (
                <div className="neighborhood-section">
                  <h5>Building Types Analyzed</h5>
                  <div className="building-type-tags">
                    {Object.entries(data.building_types).map(([type, count]) => (
                      <span key={type} className="building-type-tag">
                        {type} ({count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Community framing */}
              <div className="neighborhood-community-note">
                <p>
                  Every analysis enriches the community's shared understanding of
                  urban development impact in this neighborhood. This data helps
                  residents make informed decisions about proposed developments.
                </p>
              </div>

              <button className="neighborhood-refresh" onClick={fetchStats}>
                Refresh Stats
              </button>
            </>
          )}

          {!loading && !error && data && data.total_analyses === 0 && (
            <div className="neighborhood-empty">
              <p>
                No analyses stored yet. Place buildings and run impact analyses
                to build the community's knowledge base.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
};
