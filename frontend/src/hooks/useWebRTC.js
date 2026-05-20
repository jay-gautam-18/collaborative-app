import { useEffect, useRef, useState, useCallback } from "react"

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
]

// Named export — matches the import in Room.jsx
export function useWebRTC({ socket, roomId, username, meetingActive }) {
  const [localStream, setLocalStream] = useState(null)
  const [peers, setPeers] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isCamOff, setIsCamOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  const pcsRef = useRef(new Map())
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const activeRef = useRef(false)
  const socketRef = useRef(socket)

  useEffect(() => { socketRef.current = socket }, [socket])

  // ── Peer map helpers ──────────────────────────────────────────────────────
  function updatePeer(peerId, patch) {
    setPeers((prev) => {
      const next = new Map(prev)
      next.set(peerId, { ...(next.get(peerId) || {}), ...patch })
      return next
    })
  }

  function removePeer(peerId) {
    setPeers((prev) => { const n = new Map(prev); n.delete(peerId); return n })
    const pc = pcsRef.current.get(peerId)
    if (pc) { pc.close(); pcsRef.current.delete(peerId) }
  }

  // ── RTCPeerConnection factory ─────────────────────────────────────────────
  const createPeerConnection = useCallback((peerId, peerUsername) => {
    if (pcsRef.current.has(peerId)) {
      pcsRef.current.get(peerId).close()
      pcsRef.current.delete(peerId)
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcsRef.current.set(peerId, pc)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", { targetId: peerId, candidate })
      }
    }

    pc.ontrack = ({ streams }) => {
      if (streams?.[0]) updatePeer(peerId, { stream: streams[0], username: peerUsername })
    }

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        removePeer(peerId)
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    return pc
  }, [])

  // ── Get local media ───────────────────────────────────────────────────────
  async function getLocalStream() {
    if (localStreamRef.current) return localStreamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      setLocalStream(stream)
      return stream
    } catch (err) {
      console.warn("[webrtc] media denied:", err.message)
      // Silent fallback so signalling still works
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      localStreamRef.current = dest.stream
      setLocalStream(dest.stream)
      return dest.stream
    }
  }

  // ── Join / leave ──────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    if (activeRef.current) return
    if (!socketRef.current) { console.warn("[webrtc] socket not ready"); return }
    activeRef.current = true
    await getLocalStream()
    socketRef.current.emit("meeting-join", { roomId, username })
  }, [roomId, username])

  const leaveMeeting = useCallback(() => {
    activeRef.current = false
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setIsScreenSharing(false)
    pcsRef.current.forEach((pc) => pc.close())
    pcsRef.current.clear()
    setPeers(new Map())
    socketRef.current?.emit("meeting-leave", { roomId })
  }, [roomId])

  // ── Signalling ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return

    async function onMeetingPeerJoined({ peerId, username: peerUsername }) {
      await getLocalStream()
      updatePeer(peerId, { stream: null, username: peerUsername })
      const pc = createPeerConnection(peerId, peerUsername)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socketRef.current?.emit("webrtc-offer", { targetId: peerId, offer })
    }

    async function onOffer({ fromId, offer, username: peerUsername }) {
      await getLocalStream()
      updatePeer(fromId, { stream: null, username: peerUsername || fromId })
      const pc = createPeerConnection(fromId, peerUsername || fromId)
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socketRef.current?.emit("webrtc-answer", { targetId: fromId, answer })
    }

    async function onAnswer({ fromId, answer }) {
      const pc = pcsRef.current.get(fromId)
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }

    async function onIceCandidate({ fromId, candidate }) {
      const pc = pcsRef.current.get(fromId)
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
        catch (_) { /* stale, safe to ignore */ }
      }
    }

    function onMeetingPeerLeft({ peerId }) { removePeer(peerId) }

    function onExistingMembers({ members: list }) {
      list.forEach(({ peerId, username: u }) => updatePeer(peerId, { stream: null, username: u }))
    }

    socket.on("meeting-existing-members", onExistingMembers)
    socket.on("meeting-peer-joined", onMeetingPeerJoined)
    socket.on("webrtc-offer", onOffer)
    socket.on("webrtc-answer", onAnswer)
    socket.on("webrtc-ice-candidate", onIceCandidate)
    socket.on("meeting-peer-left", onMeetingPeerLeft)

    return () => {
      socket.off("meeting-existing-members", onExistingMembers)
      socket.off("meeting-peer-joined", onMeetingPeerJoined)
      socket.off("webrtc-offer", onOffer)
      socket.off("webrtc-answer", onAnswer)
      socket.off("webrtc-ice-candidate", onIceCandidate)
      socket.off("meeting-peer-left", onMeetingPeerLeft)
    }
  }, [socket, createPeerConnection])

  useEffect(() => {
    if (!meetingActive && activeRef.current) leaveMeeting()
  }, [meetingActive, leaveMeeting])

  useEffect(() => () => { if (activeRef.current) leaveMeeting() }, [leaveMeeting])

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled })
    setIsMuted((p) => !p)
  }, [])

  const toggleCam = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled })
    setIsCamOff((p) => !p)
  }, [])

  const toggleScreenShare = useCallback(async () => {
    if (!localStreamRef.current) return
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const camTrack = camStream.getVideoTracks()[0]
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video")
          if (sender && camTrack) sender.replaceTrack(camTrack)
        })
        const audioTrack = localStreamRef.current.getAudioTracks()[0]
        const newStream = new MediaStream([camTrack, audioTrack].filter(Boolean))
        localStreamRef.current = newStream
        setLocalStream(newStream)
      } catch (e) { console.warn("[webrtc] cam restore failed:", e.message) }
      setIsScreenSharing(false)
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]
        pcsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video")
          if (sender) sender.replaceTrack(screenTrack)
        })
        const audioTrack = localStreamRef.current.getAudioTracks()[0]
        const newStream = new MediaStream([screenTrack, audioTrack].filter(Boolean))
        localStreamRef.current = newStream
        setLocalStream(newStream)
        setIsScreenSharing(true)
        screenTrack.onended = () => setIsScreenSharing(false)
      } catch (e) { console.warn("[webrtc] screen share denied:", e.message) }
    }
  }, [isScreenSharing])

  return {
    localStream, peers,
    isMuted, isCamOff, isScreenSharing,
    toggleMic, toggleCam, toggleScreenShare,
    joinMeeting, leaveMeeting,
  }
}