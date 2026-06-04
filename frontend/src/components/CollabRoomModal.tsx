'use client';

import { useState, useEffect, memo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useMountTransition } from '@/hooks/useMountTransition';
import { X, Users, Plus, LogIn, Copy, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreateRoom: (displayName: string, roomId: string) => void;
  onJoinRoom: (displayName: string, roomId: string) => void;
  joinError?: string | null;
  onClearJoinError?: () => void;
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const CollabRoomModal = memo(function CollabRoomModal({
  isOpen,
  onClose,
  onCreateRoom,
  onJoinRoom,
  joinError,
  onClearJoinError,
}: Props) {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [generatedId, setGeneratedId] = useState('');
  const [copied, setCopied] = useState(false);

  // Initialise once on the client (avoids hydration mismatch & ensures fresh ID each open).
  useEffect(() => {
    setDisplayName(localStorage.getItem('codecollab_displayName') || '');
  }, []);

  useEffect(() => {
    if (!generatedId) setGeneratedId(generateRoomId());
  }, [generatedId]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('codecollab_displayName', displayName);
    }
  }, [displayName]);

  const { hasRendered, isActive } = useMountTransition(isOpen, 300);
  if (!hasRendered) return null;

  const bg = isDark ? 'bg-[#1a1a2e]' : 'bg-white';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const textP = isDark ? 'text-white' : 'text-slate-900';
  const textM = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDark ? 'bg-[#232340]' : 'bg-slate-100';
  const inputBorder = isDark ? 'border-slate-600' : 'border-slate-300';
  const inputText = isDark ? 'text-white' : 'text-slate-900';

  const handleCopyId = () => {
    navigator.clipboard.writeText(generatedId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = () => {
    if (!displayName.trim()) return;
    onCreateRoom(displayName.trim(), generatedId);
    onClose();
  };

  const handleJoin = () => {
    if (!displayName.trim() || !roomId.trim()) return;
    onClearJoinError?.();
    onJoinRoom(displayName.trim(), roomId.trim().toUpperCase());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative w-full max-w-md mx-4 rounded-2xl ${bg} border ${border} shadow-2xl overflow-hidden transition-all duration-300 ease-out transform ${isActive ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2">
            <Users size={20} className="text-[#CAA4F7]" />
            <h2 className={`text-lg font-bold ${textP}`}>Live Collaboration</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
          >
            <X size={18} className={textM} />
          </button>
        </div>

        <div className={`flex border-b ${border}`}>
          {(['create', 'join'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-bold transition-all relative ${
                tab === t
                  ? `${textP} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#CAA4F7]`
                  : `${textM} hover:${textP}`
              }`}
            >
              {t === 'create' ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Plus size={14} /> Host Room
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  <LogIn size={14} /> Join Room
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={`block text-xs font-bold mb-1.5 ${textM}`}>DISPLAY NAME</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. John"
              maxLength={30}
              className={`w-full px-3 py-2.5 rounded-lg border ${inputBg} ${inputBorder} ${inputText} text-sm placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#CAA4F7]/50 focus:border-[#CAA4F7] transition-all`}
            />
          </div>

          <div className="grid grid-cols-1">
            <div
              className={`col-start-1 row-start-1 flex flex-col space-y-4 transition-all duration-300 ${tab === 'create' ? 'opacity-100 z-10' : 'opacity-0 -z-10 invisible'}`}
            >
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${textM}`}>ROOM ID</label>
                <div className="flex gap-2">
                  <div
                    className={`flex-1 flex items-center px-4 py-2.5 rounded-lg border ${inputBg} ${inputBorder} font-mono text-lg tracking-[0.3em] ${textP} font-bold select-all`}
                  >
                    {generatedId}
                  </div>
                  <button
                    onClick={handleCopyId}
                    className="flex items-center justify-center px-3 rounded-lg bg-[#CAA4F7]/20 hover:bg-[#CAA4F7]/30 text-[#CAA4F7] border border-[#CAA4F7]/30 transition-all active:scale-95"
                    title="Copy Room ID"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={!displayName.trim()}
                className="w-full py-3 rounded-lg bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-md mt-auto"
              >
                Create & Host Room
              </button>
            </div>

            <div
              className={`col-start-1 row-start-1 flex flex-col space-y-4 transition-all duration-300 ${tab === 'join' ? 'opacity-100 z-10' : 'opacity-0 -z-10 invisible'}`}
            >
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${textM}`}>ROOM ID</label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value.toUpperCase());
                    onClearJoinError?.();
                  }}
                  placeholder="e.g. A3K7M2"
                  maxLength={10}
                  className={`w-full px-4 py-2.5 rounded-lg border ${inputBg} ${joinError ? 'border-red-400 ring-2 ring-red-400/30' : inputBorder} font-mono text-lg tracking-[0.3em] font-bold ${textP} placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#CAA4F7]/50 focus:border-[#CAA4F7] transition-all uppercase`}
                />
                {joinError && (
                  <p className="text-xs mt-1.5 text-red-400 font-medium">{joinError}</p>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={!displayName.trim() || !roomId.trim()}
                className="w-full py-3 rounded-lg bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-md mt-auto"
              >
                Request to Join
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
