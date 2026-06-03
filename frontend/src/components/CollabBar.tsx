'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import { CollabMember, PendingRequest, CollabStatus } from '@/services/collabService';

interface Props {
  roomId: string;
  status: CollabStatus;
  isHost: boolean;
  members: CollabMember[];
  pending: PendingRequest[];
  onApprove: (peerId: string) => void;
  onReject: (peerId: string) => void;
  onLeave: () => void;
}

export function CollabBar({
  roomId,
  status,
  isHost,
  members,
  pending,
  onApprove,
  onReject,
  onLeave,
}: Props) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const { hasRendered, isActive } = useMountTransition(showPanel, 300);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusIcon = () => {
    switch (status) {
      case 'connected':
        return <Wifi size={15} className="text-green-400" />;
      case 'connecting':
      case 'waiting-approval':
        return <Loader2 size={15} className="animate-spin text-yellow-400" />;
      default:
        return <WifiOff size={15} className="text-red-400" />;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case 'connected':
        return 'CONNECTED';
      case 'connecting':
        return 'CONNECTING...';
      case 'waiting-approval':
        return 'WAITING FOR APPROVAL...';
      case 'rejected':
        return 'REJECTED';
      case 'error':
        return 'ERROR';
      default:
        return 'DISCONNECTED';
    }
  };

  const bg = isDark ? 'bg-[#12121c]' : 'bg-[#d0d4dc]';
  const panelBg = isDark ? 'bg-[#1a1a2e]' : 'bg-white';
  const border = isDark ? 'border-slate-700/50' : 'border-slate-200';
  const textP = isDark ? 'text-white' : 'text-slate-900';
  const textM = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <>
      <div
        className={`h-11 flex items-center justify-between px-4 text-[13px] kode-font font-bold ${bg} ${isDark ? 'text-white/80' : 'text-slate-600'} border-t ${border} relative`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {statusIcon()}
            <span>{statusLabel()}</span>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#CAA4F7]/15 text-[#CAA4F7] hover:bg-[#CAA4F7]/25 transition-colors"
            title="Copy Room ID"
          >
            <span className="tracking-widest">{roomId}</span>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {isHost && <Crown size={15} className="text-amber-400" />}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity relative"
          >
            <div className="flex -space-x-1.5">
              {members.slice(0, 5).map((m) => (
                <div
                  key={m.peerId}
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: m.color, borderColor: isDark ? '#12121c' : '#d0d4dc' }}
                  title={m.displayName}
                >
                  {m.displayName[0]?.toUpperCase()}
                </div>
              ))}
              {members.length > 5 && (
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${isDark ? 'bg-slate-700 border-[#12121c] text-slate-300' : 'bg-slate-200 border-[#d0d4dc] text-slate-600'}`}
                >
                  +{members.length - 5}
                </div>
              )}
            </div>
            <Users size={15} />
            <span>{members.length}</span>
            {isHost && pending.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center animate-pulse">
                {pending.length}
              </span>
            )}
          </button>

          <button
            onClick={onLeave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors text-[12px] font-bold"
          >
            <LogOut size={13} /> LEAVE
          </button>
        </div>
      </div>

      {hasRendered && (
        <>
          <div
            className={`fixed inset-0 z-40 transition-opacity duration-300 ease-out ${isActive ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setShowPanel(false)}
          />
          <div
            className={`absolute bottom-14 right-4 z-50 w-72 rounded-xl ${panelBg} border ${border} shadow-2xl overflow-hidden transition-all duration-300 ease-out transform origin-bottom-right ${isActive ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'}`}
          >
            <div className={`px-4 py-3 border-b ${border} flex items-center justify-between`}>
              <h3 className={`text-sm font-bold ${textP}`}>Room Members</h3>
              <button
                onClick={() => setShowPanel(false)}
                className={`p-1 rounded ${isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
              >
                <X size={14} className={textM} />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {members.map((m) => (
                <div
                  key={m.peerId}
                  className={`flex items-center gap-3 px-4 py-2.5 ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}
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
                      {m.isHost && <Crown size={10} className="inline ml-1 text-amber-400" />}
                    </div>
                  </div>
                  <Wifi size={10} className="text-green-400 shrink-0" />
                </div>
              ))}
              {isHost && pending.length > 0 && (
                <>
                  <div
                    className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${textM} border-t ${border}`}
                  >
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
                          className="p-1.5 rounded-md bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
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
        </>
      )}
    </>
  );
}
