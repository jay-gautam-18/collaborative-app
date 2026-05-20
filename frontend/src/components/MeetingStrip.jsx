import { useEffect, useRef } from "react"

// ── Single video tile ─────────────────────────────────────────────────────────
function VideoTile({ stream, username, isLocal, isMuted, isCamOff, isScreenSharing }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const initials = username
    ? username.slice(0, 2).toUpperCase()
    : "??"

  return (
    <div className="relative flex-shrink-0 w-40 h-28 bg-gray-800 rounded-xl overflow-hidden border border-gray-700 group">
      {/* Video element — hidden when cam is off (local) or stream has no video */}
      {stream && !(isLocal && isCamOff) ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal} // always mute local to avoid echo
          className="w-full h-full object-cover"
        />
      ) : (
        // Avatar fallback
        <div className="w-full h-full flex items-center justify-center bg-gray-800">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: stringToColor(username) }}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Name tag */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <span className="text-white text-xs font-medium truncate block">
          {isLocal ? `${username} (you)` : username}
        </span>
      </div>

      {/* Muted indicator */}
      {isLocal && isMuted && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
          <MicOffIcon size={10} />
        </div>
      )}

      {/* Screen share badge */}
      {isLocal && isScreenSharing && (
        <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded font-medium">
          sharing
        </div>
      )}
    </div>
  )
}

// ── Meeting strip ─────────────────────────────────────────────────────────────
export default function MeetingStrip({
  isActive,
  localStream,
  peers,
  username,
  isMuted,
  isCamOff,
  isScreenSharing,
  onToggleMic,
  onToggleCam,
  onToggleScreen,
  onLeave,
}) {
  if (!isActive) return null

  const peerList = Array.from(peers.entries()) // [[peerId, { stream, username }]]

  return (
    <div className="h-44 bg-gray-900 border-t border-gray-800 flex items-center gap-0 shrink-0 px-4">

      {/* Video tiles — scrollable if many participants */}
      <div className="flex-1 flex items-center gap-3 overflow-x-auto py-2 pr-4 scrollbar-hide">
        {/* Local tile always first */}
        <VideoTile
          stream={localStream}
          username={username}
          isLocal={true}
          isMuted={isMuted}
          isCamOff={isCamOff}
          isScreenSharing={isScreenSharing}
        />

        {/* Remote peers */}
        {peerList.map(([peerId, peer]) => (
          <VideoTile
            key={peerId}
            stream={peer.stream}
            username={peer.username || peerId.slice(0, 8)}
            isLocal={false}
          />
        ))}

        {/* Empty state */}
        {peerList.length === 0 && (
          <div className="flex items-center gap-2 text-gray-500 text-sm ml-4">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Waiting for others to join the call…
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0 pl-4 border-l border-gray-800">
        <ControlButton
          active={!isMuted}
          activeClass="bg-gray-700 hover:bg-gray-600"
          inactiveClass="bg-red-600 hover:bg-red-500"
          onClick={onToggleMic}
          title={isMuted ? "Unmute" : "Mute"}
          label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
        </ControlButton>

        <ControlButton
          active={!isCamOff}
          activeClass="bg-gray-700 hover:bg-gray-600"
          inactiveClass="bg-red-600 hover:bg-red-500"
          onClick={onToggleCam}
          title={isCamOff ? "Turn camera on" : "Turn camera off"}
          label={isCamOff ? "Start video" : "Stop video"}
        >
          {isCamOff ? <CamOffIcon size={16} /> : <CamIcon size={16} />}
        </ControlButton>

        <ControlButton
          active={!isScreenSharing}
          activeClass="bg-gray-700 hover:bg-gray-600"
          inactiveClass="bg-blue-600 hover:bg-blue-500"
          onClick={onToggleScreen}
          title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
          label={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          <ScreenIcon size={16} />
        </ControlButton>

        {/* Leave call */}
        <button
          onClick={onLeave}
          title="Leave call"
          className="flex flex-col items-center gap-0.5 bg-red-600 hover:bg-red-500 text-white rounded-xl px-3 py-2 transition-colors min-w-[56px]"
        >
          <PhoneOffIcon size={16} />
          <span className="text-xs font-medium mt-0.5">Leave</span>
        </button>
      </div>
    </div>
  )
}

// ── Control button helper ─────────────────────────────────────────────────────
function ControlButton({ children, active, activeClass, inactiveClass, onClick, title, label }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-col items-center gap-0.5 text-white rounded-xl px-3 py-2 transition-colors min-w-[56px] ${active ? activeClass : inactiveClass}`}
    >
      {children}
      <span className="text-xs font-medium mt-0.5">{label}</span>
    </button>
  )
}

// ── Tiny inline SVG icons (no dependency) ────────────────────────────────────
function MicIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4zm-7 9a7 7 0 0 0 13.93 1H17a5 5 0 0 1-10 0H5zm7 9v3h-1v-3a8 8 0 0 1-7.93-7H5a6 6 0 0 0 11.93 0H19A8 8 0 0 1 12 19z"/>
    </svg>
  )
}

function MicOffIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-2.21-1.79-4-4-4S7 2.79 7 5v.18l7.98 7.99zM4.27 3L3 4.27l6.01 6.01V11c0 2.21 1.79 4 4 4 .21 0 .39-.02.59-.05l1.86 1.86c-.75.45-1.61.71-2.45.71a5 5 0 0 1-5-5H6a7 7 0 0 0 5.93 6.87V22h2v-3.13c.85-.1 1.65-.35 2.38-.73L19.73 21 21 19.73 4.27 3z"/>
    </svg>
  )
}

function CamIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
    </svg>
  )
}

function CamOffIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
    </svg>
  )
}

function ScreenIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v1h12v-1l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
    </svg>
  )
}

function PhoneOffIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.77 17.48l-4.56-4.55-2.83 2.83 1.29 1.29c-1.34.65-2.79 1.05-4.34 1.12l-1.43-1.43-2.83 2.83 3.24 3.24C22.36 22.56 23.77 17.48 23.77 17.48zM1 1.27L2.28 0 24 21.72 22.73 23l-3.38-3.38C14.55 23.2 6.26 21.6 1.82 15.96l3.56-3.56 1.3 1.3c-.62-.77-1.06-1.67-1.3-2.62L4 9.73 6.84 6.9 1 1.27z"/>
    </svg>
  )
}

// ── Deterministic color from username string ──────────────────────────────────
function stringToColor(str = "") {
  const colors = [
    "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
    "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}
