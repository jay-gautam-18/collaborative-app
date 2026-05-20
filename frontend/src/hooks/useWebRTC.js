import { useEffect, useRef, useState, useCallback } from "react"

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
]

export default function useWebRTC({ socket, roomId, username, meetingActive }) {
  const [localStream, setLocalStream] = useState(null)
  const [peers, setPeers] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isCamOff, setIsCamOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  const pcsRef = useRef(new Map())
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const activeRef = useRef(false)

  // Always-current socket ref — socket prop starts null, becomes real socket
  // after provider mounts. Callbacks read this ref so they never stale-close.
  const socketRef = useRef(socket)
  useEffect(() => { socketRef.current = socket }, [socket])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updatePeer(peerId, patch) {
    setPeers((prev) => {
      const next = new Map(prev)
      next.set(peerId, { ...(next.get(peerId) || {}), ...patch })
      return next
    })
  }

  function removePeer(peerId) {
    setPeers((prev) => {
      const next = new Map(prev)
      next.delete(peerId)
      return next
    })
    const pc = pcsRef.current.get(peerId)
    if (pc) { pc.close(); pcsRef.current.delete(peerId) }
  }

  // ── Create RTCPeerConnection ──────────────────────────────────────────────

  const createPeerConnection = useCallback((peerId, peerUsername) => {
    // If we already have a connection to this peer, close it first
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
      if (streams?.[0]) {
        updatePeer(peerId, { stream: streams[0], username: peerUsername })
      }
    }

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        removePeer(peerId)
      }
    }

    // Add existing local tracks so remote side gets our video/audio
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    return pc
  }, [])

  // ── Local media ───────────────────────────────────────────────────────────

  async function getLocalStream() {
    // Return existing stream if already acquired
    if (localStreamRef.current) return localStreamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      setLocalStream(stream)
      return stream
    } catch (err) {
      console.warn("[webrtc] media denied:", err.message)
      // Fallback silent stream so signalling still works without camera
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      localStreamRef.current = dest.stream
      setLocalStream(dest.stream)
      return dest.stream
    }
  }

  // ── Join meeting ──────────────────────────────────────────────────────────
  // CRITICAL ORDER:
  //   1. Set activeRef = true FIRST (synchronously, before any await)
  //   2. Get media (async — may take 1-2s for camera permission)
  //   3. Emit meeting-join AFTER media is ready so tracks exist when
  //      offers arrive from existing peers
  //
  // Why: if activeRef is false when onMeetingPeerJoined fires, the handler
  // would previously bail out. Now we don't guard on activeRef in handlers,
  // but we still need the stream ready before creating peer connections.

  const joinMeeting = useCallback(async () => {
    if (activeRef.current) return
    if (!socketRef.current) {
      console.warn("[webrtc] joinMeeting: socket not ready")
      return
    }

    // ← Set active BEFORE the async camera request
    activeRef.current = true

    // Get camera/mic — existing peers will get our tracks added properly
    await getLocalStream()

    // Now tell the server we're in the call. The server notifies existing
    // members, who send us offers. Our signalling handlers are already
    // listening (attached when socket became non-null).
    socketRef.current.emit("meeting-join", { roomId, username })
    console.log("[webrtc] meeting-join emitted, room:", roomId)
  }, [roomId, username])

  // ── Leave meeting ─────────────────────────────────────────────────────────

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

  // ── Signalling listeners ──────────────────────────────────────────────────
  // Re-attached whenever socket changes (null → real socket on mount).
  // NO activeRef guards here — the guards were the bug. If our socket
  // receives a meeting event we should always handle it; activeRef only
  // gates whether WE initiated, not whether we can respond.

  useEffect(() => {
    if (!socket) return

    // Existing member in the call → we just joined → they send us an offer
    async function onMeetingPeerJoined({ peerId, username: peerUsername }) {
      console.log("[webrtc] meeting-peer-joined from:", peerId, peerUsername)

      // Ensure we have media before creating the connection
      await getLocalStream()

      updatePeer(peerId, { stream: null, username: peerUsername })
      const pc = createPeerConnection(peerId, peerUsername)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socketRef.current?.emit("webrtc-offer", { targetId: peerId, offer })
    }

    // We just joined → existing member sends us an offer → we answer
    async function onOffer({ fromId, offer, username: peerUsername }) {
      console.log("[webrtc] received offer from:", fromId)

      await getLocalStream()

      updatePeer(fromId, { stream: null, username: peerUsername || fromId })
      const pc = createPeerConnection(fromId, peerUsername || fromId)
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socketRef.current?.emit("webrtc-answer", { targetId: fromId, answer })
    }

    async function onAnswer({ fromId, answer }) {
      console.log("[webrtc] received answer from:", fromId)
      const pc = pcsRef.current.get(fromId)
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }

    async function onIceCandidate({ fromId, candidate }) {
      const pc = pcsRef.current.get(fromId)
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
        catch (_) { /* stale candidate, safe to ignore */ }
      }
    }

    function onMeetingPeerLeft({ peerId }) {
      console.log("[webrtc] peer left call:", peerId)
      removePeer(peerId)
    }

    // New joiner receives the list of people already in the call.
    // We register them in the peers map so the UI shows them immediately,
    // and wait for their offers to arrive (which the server already triggered).
    function onExistingMembers({ members: existingList }) {
      console.log("[webrtc] existing members in call:", existingList)
      existingList.forEach(({ peerId, username: peerUsername }) => {
        updatePeer(peerId, { stream: null, username: peerUsername })
      })
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

  // ── External meetingActive flip (e.g. Leave button) ──────────────────────
  useEffect(() => {
    if (!meetingActive && activeRef.current) leaveMeeting()
  }, [meetingActive, leaveMeeting])

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (activeRef.current) leaveMeeting() }
  }, [leaveMeeting])

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
      } catch (e) {
        console.warn("[webrtc] cam restore failed:", e.message)
      }
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
      } catch (e) {
        console.warn("[webrtc] screen share denied:", e.message)
      }
    }
  }, [isScreenSharing])

  return {
    localStream, peers,
    isMuted, isCamOff, isScreenSharing,
    toggleMic, toggleCam, toggleScreenShare,
    joinMeeting, leaveMeeting,
  }
}
