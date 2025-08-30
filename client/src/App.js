import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import ChatPage from "./pages/ChatPage";
import ROIDashboardPage from "./pages/ROIDashboardPage"; // Import the new page

function App() {
  return (
    <Router>
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/dashboard" element={<ROIDashboardPage />} />
        </Routes>
      </main>
    </Router>
  );
}

export default App;
