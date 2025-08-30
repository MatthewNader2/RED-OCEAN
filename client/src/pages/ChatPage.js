// File: src/Chat.js
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./Chat.css"; // Import the new stylesheet

// --- The Redesigned Property Card Component ---
const PropertyCard = ({ property }) => {
  if (!property || !property.Property) return null;
  const prop = property.Property;

  // Use a placeholder image service. The 'seed' makes the image consistent for the same property.
  const imageUrl = `https://picsum.photos/seed/${prop.totalArea}/400/200`;

  return (
    <div className="property-card">
      <div className="card-image">
        <img src={imageUrl} alt={`View of ${prop.location}`} />
      </div>
      <div className="card-content">
        <h4 className="card-title">
          {prop.location}, {prop.locationDetails.address}
        </h4>
        <div className="card-info-grid">
          <div className="info-item">
            <i className="fas fa-building"></i>
            <span>{prop.type}</span>
          </div>
          <div className="info-item">
            <i className="fas fa-ruler-combined"></i>
            <span>{prop.totalArea.toFixed(0)} sq. units</span>
          </div>
          <div className="info-item">
            <i className="fas fa-bed"></i>
            <span>{prop.bedrooms} Bedrooms</span>
          </div>
          <div className="info-item">
            <i className="fas fa-bath"></i>
            <span>{prop.bathrooms} Bathrooms</span>
          </div>
        </div>
      </div>
      <div className="card-footer">
        <p>
          <i className="fas fa-chart-line"></i> Total ROI: {prop.roi.totalROI}%
        </p>
      </div>
    </div>
  );
};

const Chat = () => {
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([
    // Start with a welcome message from the AI
    {
      role: "ai",
      text: "Hello! I'm your real estate assistant. How can I help you find the perfect property today?",
      suggestions: [],
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const chatHistoryRef = useRef(null);

  // Effect to auto-scroll to the latest message
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    const userMessage = { role: "user", text: message };
    setChatHistory((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setMessage("");

    try {
      const response = await axios.post("http://localhost:5000/api/chat", {
        userQuery: message,
        chatHistory: chatHistory,
      });

      const { summary, suggestions } = response.data;
      const aiMessage = {
        role: "ai",
        text: summary,
        suggestions: suggestions || [],
      };
      setChatHistory((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = {
        role: "ai",
        text: "Sorry, I am having trouble connecting. Please try again.",
        suggestions: [],
      };
      setChatHistory((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <i className="fas fa-robot"></i>
        <span>RED OCEAN AI</span>
      </div>
      <div className="chat-history" ref={chatHistoryRef}>
        {chatHistory.map((msg, index) => (
          <div key={index} className={`message-wrapper ${msg.role}`}>
            <div className={`message-bubble ${msg.role}`}>{msg.text}</div>
            {msg.role === "ai" &&
              msg.suggestions &&
              msg.suggestions.length > 0 && (
                <div className="suggestions-container">
                  {msg.suggestions.map((suggestion, idx) => (
                    <PropertyCard key={idx} property={suggestion} />
                  ))}
                </div>
              )}
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="chat-form">
        <input
          type="text"
          className="chat-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask me anything..."
          disabled={isLoading}
        />
        <button type="submit" className="send-button" disabled={isLoading}>
          <i className="fas fa-paper-plane"></i>
        </button>
      </form>
    </div>
  );
};

export default Chat;
