'use client';

import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useMountTransition } from '@/hooks/useMountTransition';
import {
  Users,
  Wifi,
  WifiOff,
  Loader2,
  Copy,
  Check,
  LogOut,
  UserCheck,
  UserX,
  Clock,
  Crown,
  X,
  Info,
  Lock,
  Unlock,
  UserMinus,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import { CollabMember, PendingRequest, CollabStatus } from '@/services/collabService';

interface Props {
  roomId: string;
  status: CollabStatus;
  isHost: boolean;
  isLocked: boolean;
  members: CollabMember[];
  pending: PendingRequest[];
  onApprove: (peerId: string) => void;
  onReject: (peerId: string) => void;
  onLeave: () => void;
  onKick: (peerId: string) => void;
  onLockRoom: (locked: boolean) => void;
}

export const CollabBar = memo(function CollabBar({
  roomId,
  status,
  isHost,
  isLocked,
  members,
  pending,
  onApprove,
  onReject,
  onLeave,
  onKick,
  onLockRoom,
}: Props) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const membersRef = useRef<HTMLDivElement>(null);
  const membersBtnRef = useRef<HTMLButtonElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const infoBtnRef = useRef<HTMLButtonElement>(null);

  const { hasRendered: hasRenderedMembers, isActive: isActiveMembers } = useMountTransition(showMembers, 250);
  const { hasRendered: hasRenderedInfo, isActive: isActiveInfo } = useMountTransition(showInfo, 250);

  // Close popups on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      showMembers &&
      membersRef.current &&
      !membersRef.current.contains(e.target as Node) &&
      membersBtnRef.current &&
      !membersBtnRef.current.contains(e.target as Node)
    ) {
      setShowMembers(false);
    }
    if (
      showInfo &&
      infoRef.current &&
      !infoRef.current.contains(e.target as Node) &&
      infoBtnRef.current &&
      !infoBtnRef.current.contains(e.target as Node)
    ) {
      setShowInfo(false);
    }
  }, [showMembers, showInfo]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusIcon = () => {
    switch (status) {
      case 'connected':
        return <Wifi size={14} className="text-green-500" />;
      case 'connecting':
      case 'waiting-approval':
        return <Loader2 size={14} className="animate-spin text-yellow-500" />;
      default:
        return <WifiOff size={14} className="text-red-500" />;
    }
  };

  const panelBg = isDark ? 'bg-[#1a1a2e]' : 'bg-white';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const textP = isDark ? 'text-white' : 'text-slate-900';
  const textM = isDark ? 'text-slate-400' : 'text-slate-600';

  return (
    <>
      {/* Status dot */}
      <div className="flex items-center gap-1.5 mr-1">
        {statusIcon()}
        {isHost && <Crown size={13} className="text-amber-500" />}
        {isLocked && <Lock size={12} className="text-red-400" />}
      </div>

      {/* Members button */}
      <div className="relative">
        <button
          ref={membersBtnRef}
          onClick={() => { setShowMembers(!showMembers); setShowInfo(false); }}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all active:scale-95 relative ${
            showMembers
              ? isDark ? 'bg-[#CAA4F7]/20 text-[#CAA4F7]' : 'bg-[#CAA4F7]/15 text-[#9B6DD7]'
              : isDark ? 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
          }`}
          title="Room Members"
        >
          <div className="flex -space-x-1.5">
            {members.slice(0, 3).map((m) => (
              <div
                key={m.peerId}
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] font-bold text-white"
                style={{ backgroundColor: m.color, borderColor: isDark ? '#181821' : '#DBDFE7' }}
              >
                {m.displayName[0]?.toUpperCase()}
              </div>
            ))}
            {members.length > 3 && (
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] font-bold ${isDark ? 'bg-slate-700 border-[#181821] text-slate-300' : 'bg-slate-300 border-[#DBDFE7] text-slate-700'}`}>
                +{members.length - 3}
              </div>
            )}
          </div>
          <Users size={14} />
          <span className="text-xs font-bold">{members.length}</span>
          {isHost && pending.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center animate-pulse">
              {pending.length}
            </span>
          )}
        </button>

        {/* Members popup */}
        {hasRenderedMembers && (
          <div
            ref={membersRef}
            className={`absolute top-full right-0 mt-2 z-50 w-72 rounded-xl ${panelBg} border ${border} shadow-2xl overflow-hidden transition-all duration-250 ease-out transform origin-top-right ${isActiveMembers ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'}`}
          >
            <div className={`px-4 py-3 border-b ${border} flex items-center justify-between`}>
              <h3 className={`text-sm font-bold ${textP}`}>Room Members</h3>
              <button
                onClick={() => setShowMembers(false)}
                className={`p-1 rounded-sm ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
              >
                <X size={14} className={textM} />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {members.map((m) => (
                <div
                  key={m.peerId}
                  className={`flex items-center gap-3 px-4 py-2.5 group ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.displayName[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-bold truncate ${textP}`}>
                      {m.displayName}
                      {m.isHost && <Crown size={10} className="inline ml-1 text-amber-500" />}
                    </div>
                  </div>
                  {isHost && !m.isHost && (
                    <button
                      onClick={() => onKick(m.peerId)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                      title={`Kick ${m.displayName}`}
                    >
                      <UserMinus size={12} />
                    </button>
                  )}
                  <Wifi size={10} className="text-green-500 shrink-0" />
                </div>
              ))}
              {isHost && pending.length > 0 && (
                <>
                  <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${textM} border-t ${border}`}>
                    <Clock size={10} className="inline mr-1" /> Pending Requests
                  </div>
                  {pending.map((p) => (
                    <div
                      key={p.peerId}
                      className={`flex items-center gap-3 px-4 py-2.5 ${isDark ? 'bg-amber-500/5' : 'bg-amber-50'}`}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.displayName[0]?.toUpperCase()}
                      </div>
                      <span className={`flex-1 text-xs font-medium truncate ${textP}`}>
                        {p.displayName}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => onApprove(p.peerId)}
                          className="p-1.5 rounded-md bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors"
                          title="Approve"
                        >
                          <UserCheck size={12} />
                        </button>
                        <button
                          onClick={() => onReject(p.peerId)}
                          className="p-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          title="Reject"
                        >
                          <UserX size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info button */}
      <div className="relative">
        <button
          ref={infoBtnRef}
          onClick={() => { setShowInfo(!showInfo); setShowMembers(false); }}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
            showInfo
              ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-500/15 text-blue-600'
              : isDark ? 'text-slate-400 hover:bg-slate-700/50 hover:text-blue-400' : 'text-slate-500 hover:bg-slate-200 hover:text-blue-600'
          }`}
          title="Room Info"
        >
          <Info size={16} />
        </button>

        {/* Info popup */}
        {hasRenderedInfo && (
          <div
            ref={infoRef}
            className={`absolute top-full right-0 mt-2 z-50 w-80 rounded-xl ${panelBg} border ${border} shadow-2xl overflow-hidden transition-all duration-250 ease-out transform origin-top-right ${isActiveInfo ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'}`}
          >
            <div className={`px-4 py-3 border-b ${border} flex items-center justify-between`}>
              <h3 className={`text-sm font-bold ${textP}`}>Room Info</h3>
              <button
                onClick={() => setShowInfo(false)}
                className={`p-1 rounded-sm ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
              >
                <X size={14} className={textM} />
              </button>
            </div>
            <div className="px-4 py-4 space-y-4 flex flex-col items-center">
              {/* Room ID */}
              <div className="w-full">
                <label className={`block text-[10px] font-bold mb-1.5 ${textM} text-center uppercase tracking-wider`}>Room ID</label>
                <div className="flex gap-2 justify-center items-center">
                  <div
                    className={`px-5 py-2.5 rounded-lg border ${isDark ? 'bg-[#232340] border-slate-600' : 'bg-slate-100 border-slate-300'} font-mono text-lg tracking-[0.3em] ${textP} font-bold select-all`}
                  >
                    {roomId}
                  </div>
                  <button
                    onClick={handleCopy}
                    className="flex items-center justify-center p-2.5 rounded-lg bg-[#CAA4F7]/20 hover:bg-[#CAA4F7]/30 text-[#CAA4F7] border border-[#CAA4F7]/30 transition-all active:scale-95"
                    title="Copy Room ID"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* QR Code */}
              <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                <QRCode
                  value={roomId}
                  size={140}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>

              {/* Lock toggle — host only */}
              {isHost && (
                <div className="w-full">
                  <div className={`border-t ${border} pt-3 mt-1`}>
                    <button
                      onClick={() => onLockRoom(!isLocked)}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all active:scale-[0.98] border ${
                        isLocked
                          ? isDark
                            ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                            : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                          : isDark
                            ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                            : 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      {isLocked ? 'Room Locked — Click to Unlock' : 'Room Open — Click to Lock'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Leave button */}
      <button
        onClick={onLeave}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all active:scale-95 text-xs font-bold"
        title="Leave Room"
      >
        <LogOut size={13} />
        <span className="hidden sm:inline">LEAVE</span>
      </button>
    </>
  );
});
