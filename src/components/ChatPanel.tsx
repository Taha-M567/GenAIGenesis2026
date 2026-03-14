/**
 * ChatPanel - Conversational sidebar for querying community memory
 *
 * Sends questions to the Moorcheh-backed /api/moorcheh/chat endpoint,
 * which generates grounded answers drawing on regulatory docs and
 * accumulated impact analyses.
 */

import React, { useState, useRef, useEffect } from "react";
import "./ChatPanel.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  timestamp: number;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const EXAMPLE_QUERIES = [
  "What's the noise limit for construction in Toronto?",
  "How will this building affect traffic on nearby streets?",
  "Does this project require a TTC coordination plan?",
  "What permits are needed for a 15-story building?",
  "Show cumulative impact of all analyzed buildings",
];

export const ChatPanel: React.FC<ChatPanelProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text?: string) => {
    const query = text || input.trim();
    if (!query || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Build chat history for context
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("http://localhost:3001/api/moorcheh/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          history,
          namespaces: ["regulatory", "analyses"],
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content:
          data.answer || "I couldn't find a relevant answer. Try rephrasing your question.",
        sources: data.sources || [],
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Unable to reach the memory service. Make sure the Moorcheh service is running on port 8000.\n\nError: ${(error as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  if (!isOpen) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-left">
          <h3>Community Memory Chat</h3>
          <span className="chat-subtitle">Ask about regulations, past analyses, or cumulative impact</span>
        </div>
        <div className="chat-header-actions">
          <button className="chat-clear-btn" onClick={clearChat} title="Clear chat">
            Clear
          </button>
          <button className="chat-close-btn" onClick={onClose} title="Close chat">
            &times;
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">&#x1f9e0;</div>
            <h4>6ixthSense Community Memory</h4>
            <p>
              Ask questions grounded in Toronto regulatory documents and past
              impact analyses. Every building analysis enriches the community's
              shared knowledge.
            </p>
            <div className="chat-examples">
              <p className="chat-examples-label">Try asking:</p>
              {EXAMPLE_QUERIES.map((q, i) => (
                <button
                  key={i}
                  className="chat-example-btn"
                  onClick={() => sendMessage(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-avatar">
              {msg.role === "user" ? "You" : "AI"}
            </div>
            <div className="chat-message-body">
              <div className="chat-message-content">{msg.content}</div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="chat-message-sources">
                  <span className="sources-label">Sources:</span>
                  {msg.sources.map((src, j) => (
                    <span key={j} className="source-tag">
                      {typeof src === "string" ? src : JSON.stringify(src)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-avatar">AI</div>
            <div className="chat-message-body">
              <div className="chat-typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask about Toronto regulations, past analyses, or cumulative impact..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="chat-send-btn"
          onClick={() => sendMessage()}
          disabled={!input.trim() || isLoading}
        >
          Send
        </button>
      </div>

      <div className="chat-footer">
        <span>Powered by Moorcheh Memory &middot; 32x compression &middot; Sub-second retrieval</span>
      </div>
    </div>
  );
};
