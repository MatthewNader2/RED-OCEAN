// File: src/pages/ROIDashboardPage.js
import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  Bar,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { marked } from "marked"; // Import the marked library
import RangeSlider from "../components/RangeSlider";
import "./ROIDashboardPage.css";

const MAX_SELECTIONS = 5;

const ROIDashboardPage = () => {
  const [allProperties, setAllProperties] = useState([]);
  const [selectedProperties, setSelectedProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState("");
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);

  // State for the slider MIN/MAX bounds. This is set only once.
  const [sliderBounds, setSliderBounds] = useState({
    price: { min: 0, max: 1 },
    totalROI: { min: 0, max: 1 },
  });

  // Single state object for all filters.
  const [filters, setFilters] = useState({
    searchTerm: "",
    type: "all",
    risk: ["Low", "Medium", "High"],
    price: [1, 0], // Invalid initial state to prevent premature render
    totalROI: [1, 0], // Invalid initial state
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(
          "http://localhost:5000/api/properties"
        );
        const validProperties = response.data.filter(
          (p) =>
            p.Property &&
            typeof p.Property.priceRange?.min === "number" &&
            typeof p.Property.roi?.totalROI === "number"
        );
        const propertiesWithIds = validProperties.map((p, index) => ({
          ...p,
          uniqueId: index,
        }));
        const props = propertiesWithIds.map((p) => p.Property);

        if (props.length > 0) {
          const priceStep = 1000;
          const roiStep = 0.1;
          const rawMinPrice = Math.min(...props.map((p) => p.priceRange.min));
          const rawMaxPrice = Math.max(...props.map((p) => p.priceRange.min));
          const rawMinROI = Math.min(...props.map((p) => p.roi.totalROI));
          const rawMaxROI = Math.max(...props.map((p) => p.roi.totalROI));
          const minPrice = Math.floor(rawMinPrice / priceStep) * priceStep;
          const maxPrice = Math.ceil(rawMaxPrice / priceStep) * priceStep;
          const minROI = Math.floor(rawMinROI / roiStep) * roiStep;
          const maxROI = Math.ceil(rawMaxROI / roiStep) * roiStep;

          setSliderBounds({
            price: { min: minPrice, max: maxPrice },
            totalROI: { min: minROI, max: maxROI },
          });
          setFilters((prev) => ({
            ...prev,
            price: [minPrice, maxPrice],
            totalROI: [minROI, maxROI],
          }));
        }
        setAllProperties(propertiesWithIds);
      } catch (err) {
        console.error("Data fetching or processing error:", err);
        setError("Failed to fetch or process property data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredProperties = useMemo(() => {
    if (filters.price[0] > filters.price[1]) {
      return allProperties;
    }
    return allProperties.filter((item) => {
      const prop = item.Property;
      return (
        prop.location
          .toLowerCase()
          .includes(filters.searchTerm.toLowerCase()) &&
        (filters.type === "all" || prop.type === filters.type) &&
        filters.risk.includes(prop.riskAssessment.marketRisk) &&
        prop.priceRange.min >= filters.price[0] &&
        prop.priceRange.min <= filters.price[1] &&
        prop.roi.totalROI >= filters.totalROI[0] &&
        prop.roi.totalROI <= filters.totalROI[1]
      );
    });
  }, [allProperties, filters]);

  const handleFilterChange = (e) =>
    setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const handleRiskChange = (e) => {
    const { value, checked } = e.target;
    setFilters((prev) => ({
      ...prev,
      risk: checked
        ? [...prev.risk, value]
        : prev.risk.filter((r) => r !== value),
    }));
  };
  const handleSelectProperty = (propertyId) => {
    setSelectedProperties((prev) => {
      if (prev.includes(propertyId))
        return prev.filter((id) => id !== propertyId);
      if (prev.length < MAX_SELECTIONS) return [...prev, propertyId];
      alert(`You can only select up to ${MAX_SELECTIONS} properties.`);
      return prev;
    });
  };
  const handleSelectAll = (e) => {
    setSelectedProperties(
      e.target.checked
        ? filteredProperties.slice(0, MAX_SELECTIONS).map((p) => p.uniqueId)
        : []
    );
  };

  // --- UPDATED AI ANALYSIS FUNCTION ---
  const handleRunAnalysis = async () => {
    setIsModalOpen(true);
    setIsAnalysisLoading(true);
    setAnalysisResult("");

    try {
      const response = await axios.post(
        "http://localhost:5000/api/analyze-properties",
        {
          ids: selectedProperties,
        }
      );
      setAnalysisResult(response.data.analysis);
    } catch (error) {
      console.error("Error running AI analysis:", error);
      setAnalysisResult(
        "### Error\n\nSorry, I was unable to generate the analysis. Please check the server connection and try again."
      );
    } finally {
      setIsAnalysisLoading(false);
    }
  };

  if (loading)
    return <div className="loading-message">Loading Dashboard...</div>;
  if (error) return <div className="error-message">{error}</div>;

  const kpis = {
    averageROI:
      filteredProperties.reduce(
        (acc, curr) => acc + curr.Property.roi.totalROI,
        0
      ) / (filteredProperties.length || 1),
    totalProjectedValue: filteredProperties.reduce(
      (acc, curr) => acc + curr.Property.roi.projectedValue,
      0
    ),
    bestPerformingAsset: [...filteredProperties].sort(
      (a, b) => b.Property.roi.totalROI - a.Property.roi.totalROI
    )[0],
  };
  const scatterData = filteredProperties.map((p) => ({
    risk: { Low: 1, Medium: 2, High: 3 }[p.Property.riskAssessment.marketRisk],
    roi: p.Property.roi.totalROI,
    name: p.Property.location,
  }));
  const pieData = Object.entries(
    filteredProperties.reduce((acc, curr) => {
      acc[curr.Property.type] = (acc[curr.Property.type] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));
  const PIE_COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"];
  const growthData = [...filteredProperties]
    .sort(
      (a, b) => b.Property.roi.projectedValue - a.Property.roi.projectedValue
    )
    .slice(0, 10)
    .map((p) => ({
      name: p.Property.location,
      "Initial Investment": p.Property.priceRange.min,
      "Projected Value": p.Property.roi.projectedValue,
    }));

  return (
    <>
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              className="modal-close-btn"
              onClick={() => setIsModalOpen(false)}
            >
              &times;
            </button>
            <h2>AI Investment Analysis</h2>
            {isAnalysisLoading ? (
              <div className="loading-spinner"></div>
            ) : (
              <div
                className="analysis-result"
                dangerouslySetInnerHTML={{ __html: marked(analysisResult) }}
              ></div>
            )}
          </div>
        </div>
      )}
      <div className="dashboard-container">
        <header className="dashboard-header">
          <h1>Interactive ROI Dashboard</h1>
          <p>Filter, search, and visualize property investment data.</p>
        </header>

        <div className="kpi-grid">
          <div className="kpi-card">
            <h3>Average Total ROI</h3>
            <p>{kpis.averageROI.toFixed(2)}%</p>
          </div>
          <div className="kpi-card">
            <h3>Filtered Portfolio Value</h3>
            <p>${kpis.totalProjectedValue.toLocaleString()}</p>
          </div>
          <div className="kpi-card">
            <h3>Best Performing Asset</h3>
            <p>
              {kpis.bestPerformingAsset
                ? kpis.bestPerformingAsset.Property.location
                : "N/A"}
            </p>
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-group text-search">
            <label>Search Location</label>
            <input
              type="text"
              name="searchTerm"
              placeholder="e.g., Suite 57"
              value={filters.searchTerm}
              onChange={handleFilterChange}
            />
          </div>
          <div className="filter-group">
            <label>Property Type</label>
            <select
              name="type"
              value={filters.type}
              onChange={handleFilterChange}
            >
              <option value="all">All Types</option>
              <option value="Commercial">Commercial</option>
              <option value="Residential">Residential</option>
            </select>
          </div>
          <div className="filter-group risk-checkboxes">
            <label>Market Risk</label>
            <div>
              {["Low", "Medium", "High"].map((riskValue) => (
                <label key={riskValue}>
                  <input
                    type="checkbox"
                    value={riskValue}
                    checked={filters.risk.includes(riskValue)}
                    onChange={handleRiskChange}
                  />
                  {riskValue}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="filter-bar range-filters">
          <div className="filter-group range-slider">
            <label>
              Price Range: ${filters.price[0].toLocaleString()} - $
              {filters.price[1].toLocaleString()}
            </label>
            {/* CORRECTED: Use sliderBounds for min/max */}
            <RangeSlider
              values={filters.price}
              min={sliderBounds.price.min}
              max={sliderBounds.price.max}
              step={1000}
              onChange={(values) =>
                setFilters((prev) => ({ ...prev, price: values }))
              }
            />
          </div>
          <div className="filter-group range-slider">
            <label>
              Total ROI: {filters.totalROI[0].toFixed(1)}% -{" "}
              {filters.totalROI[1].toFixed(1)}%
            </label>
            {/* CORRECTED: Use sliderBounds for min/max */}
            <RangeSlider
              values={filters.totalROI}
              min={sliderBounds.totalROI.min}
              max={sliderBounds.totalROI.max}
              step={0.1}
              onChange={(values) =>
                setFilters((prev) => ({ ...prev, totalROI: values }))
              }
            />
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-wrapper">
            <h2>ROI vs. Market Risk</h2>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid />
                <XAxis
                  type="number"
                  dataKey="risk"
                  name="Risk"
                  domain={[0, 4]}
                  ticks={[1, 2, 3]}
                  tickFormatter={(tick) => ["Low", "Medium", "High"][tick - 1]}
                />
                <YAxis type="number" dataKey="roi" name="ROI" unit="%" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Scatter name="Properties" data={scatterData} fill="#8884d8" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-wrapper">
            <h2>Property Type Distribution</h2>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-wrapper full-width">
          <h2>Investment vs. Projected Value (Top 10)</h2>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={growthData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-15} textAnchor="end" height={60} />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="Initial Investment" fill="#413ea0" />
              <Line
                type="monotone"
                dataKey="Projected Value"
                stroke="#ff7300"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="analysis-bar">
          <p>
            {selectedProperties.length} / {MAX_SELECTIONS} properties selected
          </p>
          <button
            onClick={handleRunAnalysis}
            disabled={selectedProperties.length === 0}
          >
            <i className="fas fa-magic"></i> Run AI Analysis
          </button>
        </div>

        <div className="table-wrapper">
          <table className="properties-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    title={`Select top ${MAX_SELECTIONS} visible properties`}
                  />
                </th>
                <th>Location</th>
                <th>Type</th>
                <th>Price (Min)</th>
                <th>Total ROI (%)</th>
                <th>Annual ROI (%)</th>
                <th>Market Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredProperties.map((item) => (
                <tr
                  key={item.uniqueId}
                  className={
                    selectedProperties.includes(item.uniqueId)
                      ? "selected-row"
                      : ""
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedProperties.includes(item.uniqueId)}
                      onChange={() => handleSelectProperty(item.uniqueId)}
                    />
                  </td>
                  <td>{item.Property.location}</td>
                  <td>{item.Property.type}</td>
                  <td>${item.Property.priceRange.min.toLocaleString()}</td>
                  <td className="roi-highlight">
                    {item.Property.roi.totalROI.toFixed(2)}%
                  </td>
                  <td>{item.Property.roi.annualROI.toFixed(2)}%</td>
                  <td>
                    <span
                      className={`risk-tag ${item.Property.riskAssessment.marketRisk?.toLowerCase()}`}
                    >
                      {item.Property.riskAssessment.marketRisk}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default ROIDashboardPage;
