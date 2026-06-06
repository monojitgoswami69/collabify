'use client';

import { useState, useEffect, memo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useMountTransition } from '@/hooks/useMountTransition';
import { X, Users, Plus, LogIn } from 'lucide-react';

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
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');

  // Initialise once on the client (avoids hydration mismatch).
  useEffect(() => {
    setDisplayName(localStorage.getItem('codecollab_displayName') || '');
  }, []);

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

  const handleCreate = () => {
    if (!displayName.trim()) return;
    const newId = generateRoomId();
    onCreateRoom(displayName.trim(), newId);
    onClose();
  };

  const handleJoin = () => {
    if (!displayName.trim() || !roomId.trim()) return;
    onClearJoinError?.();
    onJoinRoom(displayName.trim(), roomId.trim().toUpperCase());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative w-full max-w-2xl rounded-2xl ${bg} border ${border} shadow-2xl overflow-hidden transition-all duration-300 ease-out transform ${isActive ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0'}`}
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

        <div className="px-6 py-6 space-y-6">
          <div className="max-w-md mx-auto">
            <label className={`block text-xs font-bold mb-1.5 ${textM} text-center`}>DISPLAY NAME</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. John"
              maxLength={30}
              className={`w-full px-4 py-3 rounded-xl border ${inputBg} ${inputBorder} ${inputText} text-base text-center placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#CAA4F7]/50 focus:border-[#CAA4F7] transition-all font-medium`}
            />
          </div>

          <div className={`border-t ${border} pt-6 grid grid-cols-1 md:grid-cols-2 gap-8`}>
            {/* Host Section */}
            <div className="flex flex-col space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'} text-[#CAA4F7]`}>
                  <Plus size={20} />
                </div>
                <div>
                  <h3 className={`font-bold ${textP}`}>Host Room</h3>
                  <p className={`text-xs ${textM}`}>Create a new room and invite others</p>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-end">
                <button
                  onClick={handleCreate}
                  disabled={!displayName.trim()}
                  className="w-full py-3.5 rounded-xl bg-[#CAA4F7] hover:bg-[#D4B5F9] text-[#1E1E2A] font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-md"
                >
                  Create & Host Room
                </button>
              </div>
            </div>

            {/* Vertical Divider for md */}
            <div className={`hidden md:block absolute left-1/2 top-[160px] bottom-6 w-px ${border} -translate-x-1/2`} />

            {/* Join Section */}
            <div className="flex flex-col space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${isDark ? 'bg-blue-500/10' : 'bg-blue-50'} text-blue-400`}>
                  <LogIn size={20} />
                </div>
                <div>
                  <h3 className={`font-bold ${textP}`}>Join Room</h3>
                  <p className={`text-xs ${textM}`}>Enter a room code to join existing</p>
                </div>
              </div>

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

              <div className="flex-1 flex flex-col justify-end">
                <button
                  onClick={handleJoin}
                  disabled={!displayName.trim() || !roomId.trim()}
                  className={`w-full py-3.5 rounded-xl border-2 font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-sm ${
                    isDark 
                      ? 'bg-transparent border-[#CAA4F7] text-[#CAA4F7] hover:bg-[#CAA4F7]/10' 
                      : 'bg-white border-[#CAA4F7] text-[#9B6DD7] hover:bg-slate-50'
                  }`}
                >
                  Request to Join
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
