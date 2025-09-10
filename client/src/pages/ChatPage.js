// File: src/pages/ChatPage.js
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./Chat.css";

// --- The Redesigned Property Card Component (no changes) ---
const PropertyCard = ({ property }) => {
  if (!property || !property.Property) return null;
  const prop = property.Property;
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

// --- Main Chat Page Component ---
const ChatPage = () => {
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([
    {
      role: "assistant",
      text: "Hello! I'm your real estate assistant. How can I help you find the perfect property today?",
      suggestions: [],
      entity: null,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const chatHistoryRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleResponse = (result) => {
    const userMessage = { role: "user", text: result.transcript };
    const assistantMessage = {
      role: "assistant",
      text: result.summary,
      suggestions: result.suggestions || [],
      entity: result.entity || null, // <-- CRITICAL: Save the entity for context
    };
    setChatHistory((prev) => [...prev, userMessage, assistantMessage]);
  };

  const handleError = (error) => {
    console.error("Error processing request:", error);
    const errorMessage = {
      role: "assistant",
      text:
        error.response?.data?.error ||
        "Sorry, I am having trouble connecting. Please try again.",
      suggestions: [],
    };
    setChatHistory((prev) => [...prev, errorMessage]);
  };

  // --- Text Input Submission ---
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    const userQuery = message;
    setChatHistory((prev) => [...prev, { role: "user", text: userQuery }]);
    setIsLoading(true);
    setMessage("");

    try {
      const response = await axios.post("http://localhost:5000/api/chat", {
        userQuery,
        chatHistory,
      });
      handleResponse(response.data);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Voice Input Submission ---
  const processAudio = async (audioBlob) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("metadata", JSON.stringify({ chatHistory }));

    try {
      const response = await axios.post(
        "http://localhost:5000/api/chat-speech",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );
      handleResponse(response.data);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceInput = async () => {
    if (isListening) {
      mediaRecorderRef.current.stop();
      setIsListening(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        mediaRecorderRef.current = new MediaRecorder(stream, {
          mimeType: "audio/webm",
        });
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (event) => {
          audioChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm",
          });
          processAudio(audioBlob);
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorderRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Microphone access error:", err);
        alert(
          "Microphone access was denied. Please allow access in your browser settings."
        );
      }
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
            {msg.role === "assistant" &&
              msg.suggestions &&
              msg.suggestions.length > 0 && (
                <div className="suggestions-container">
                  {msg.suggestions.map((suggestion) => (
                    <PropertyCard
                      key={suggestion.uniqueId}
                      property={suggestion}
                    />
                  ))}
                </div>
              )}
          </div>
        ))}
        {isListening && <div className="listening-indicator">Listening...</div>}
        {isLoading && !isListening && (
          <div className="listening-indicator">Thinking...</div>
        )}
      </div>
      <form onSubmit={sendMessage} className="chat-form">
        <button
          type="button"
          onClick={handleVoiceInput}
          className={`mic-button ${isListening ? "listening" : ""}`}
          disabled={isLoading}
        >
          <i className="fas fa-microphone"></i>
        </button>
        <input
          type="text"
          className="chat-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask me anything or use the mic..."
          disabled={isLoading || isListening}
        />
        <button
          type="submit"
          className="send-button"
          disabled={isLoading || isListening || !message.trim()}
        >
          <i className="fas fa-paper-plane"></i>
        </button>
      </form>
    </div>
  );
};

export default ChatPage;
