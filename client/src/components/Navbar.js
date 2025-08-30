// File: src/components/Navbar.js
import React from "react";
import { NavLink } from "react-router-dom";
import "./Navbar.css"; // We'll create this CSS file next

const Navbar = () => {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <i className="fas fa-water"></i>
        <span>RED OCEAN</span>
      </div>
      <div className="navbar-links">
        <NavLink to="/" end>
          <i className="fas fa-comments"></i> AI Chat
        </NavLink>
        <NavLink to="/dashboard">
          <i className="fas fa-chart-pie"></i> ROI Dashboard
        </NavLink>
      </div>
    </nav>
  );
};

export default Navbar;
