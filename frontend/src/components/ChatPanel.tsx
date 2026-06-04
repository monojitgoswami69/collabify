'use client';

import { useState, useRef, useEffect, memo } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { ChatMessage } from '@/services/collabService';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessage[];
  selfPeerId: string;
  onSendMessage: (text: string) => void;
  onClose?: () => void;
}

export const ChatPanel = memo(function ChatPanel({
  isOpen,
  messages,
  selfPeerId,
  onSendMessage,
  onClose,
}: ChatPanelProps) {
  const { isDark } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const panelBg = isDark ? 'bg-[#1E1E2A]' : 'bg-[#F0F2F6]';
  const borderColor = isDark ? 'border-slate-700/50' : 'border-slate-300/50';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDark
    ? 'bg-[#232340] border-slate-600/50'
    : 'bg-white border-slate-300';
  const selfBubble = 'bg-[#CAA4F7] text-[#1E1E2A]';
  const otherBubble = isDark
    ? 'bg-[#232340] text-slate-200'
    : 'bg-white text-slate-800 border border-slate-200/80';

  return (
    <div
      className={`shrink-0 overflow-hidden fixed md:relative right-0 top-0 bottom-0 z-40 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none md:pointer-events-auto'
      }`}
      style={{
        width: isOpen ? 'clamp(280px, 100vw, 300px)' : 0,
        transition: 'width 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        contain: 'strict',
      }}
    >
      <div
        className={`flex flex-col h-full w-[280px] sm:w-[300px] border-l ${borderColor} ${panelBg} shadow-2xl md:shadow-none`}
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          opacity: isOpen ? 1 : 0,
          transition:
            'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 200ms ease',
          willChange: 'transform, opacity',
        }}
      >
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${borderColor} shrink-0`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-[#CAA4F7]" />
            <h2 className={`text-xs font-bold uppercase tracking-wider ${textMuted}`}>
              Room Chat
            </h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className={`md:hidden p-1.5 rounded-md ${textMuted} hover:text-red-500 hover:bg-red-500/10 transition-colors`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {messages.length === 0 && (
            <div
              className={`flex flex-col items-center justify-center h-full py-8 ${textMuted}`}
            >
              <MessageSquare size={24} className="mb-2 opacity-40" />
              <p className="text-xs">No messages yet</p>
              <p className="text-[10px] mt-1 opacity-50">Say hello to your collaborators!</p>
            </div>
          )}
          {messages.map((msg) => {
            const isSelf = msg.peerId === selfPeerId;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 mx-1">
                  {!isSelf && (
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                      style={{ backgroundColor: msg.color }}
                    >
                      {msg.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={`text-[10px] font-semibold ${isSelf ? 'text-[#CAA4F7]' : textMuted}`}
                  >
                    {isSelf ? 'You' : msg.displayName}
                  </span>
                  <span className={`text-[9px] ${textMuted} opacity-50`}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  className={`px-3 py-2 rounded-lg text-[12px] max-w-[85%] leading-relaxed ${
                    isSelf
                      ? `${selfBubble} rounded-tr-sm`
                      : `${otherBubble} rounded-tl-sm`
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className={`p-3 border-t ${borderColor} shrink-0`}>
          <form onSubmit={handleSend} className="relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              className={`w-full pl-3 pr-10 py-2 rounded-lg text-[12px] focus:outline-hidden transition-colors border ${inputBg} ${textPrimary} placeholder:text-slate-400/60 focus:ring-1 focus:ring-[#CAA4F7]/50 focus:border-[#CAA4F7]/50`}
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${
                !inputValue.trim()
                  ? 'opacity-30 cursor-not-allowed'
                  : 'text-[#CAA4F7] hover:bg-[#CAA4F7]/10'
              }`}
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
});
