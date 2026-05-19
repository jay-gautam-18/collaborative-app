import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"
import cors from "cors"

const app = express()
const httpServer = createServer(app)

app.use(express.json())
app.use(cors({ origin: "http://localhost:5173" }))
app.use(express.static("public"))

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // KEY FIX: shorten the ping/disconnect timeout so ghost sockets from
  // a hard refresh are cleaned up in ~10s instead of the default 5 minutes.
  pingInterval: 5000,   // send ping every 5s
  pingTimeout: 10000,   // disconnect if no pong within 10s
})

// ── Yjs CRDT sync + LevelDB persistence ──────────────────────────────────────
const ySocketIo = new YSocketIO(io, {
  levelPersistenceName: "./y-leveldb-store",
})
ySocketIo.initialize()

// ── In-memory room registry ───────────────────────────────────────────────────
const rooms = new Map()

function getOrCreateRoom(roomId, problemSlug = null) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Set(),
      createdAt: Date.now(),
      problemSlug,
    })
  }
  return rooms.get(roomId)
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId)
  if (room && room.users.size === 0) {
    rooms.delete(roomId)
  }
}

// ── Socket.IO events ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`)

  socket.on("join-room", ({ roomId, username, problemSlug }) => {
    socket.join(roomId)
    socket.data.roomId = roomId
    socket.data.username = username

    const room = getOrCreateRoom(roomId, problemSlug || null)
    room.users.add(socket.id)

    socket.to(roomId).emit("peer-joined", { peerId: socket.id, username })
    console.log(`[room] ${username} joined ${roomId} (${room.users.size} users)`)
  })

  // WebRTC signalling — Phase 2
  socket.on("webrtc-offer", ({ targetId, offer }) => {
    io.to(targetId).emit("webrtc-offer", { fromId: socket.id, offer })
  })
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    io.to(targetId).emit("webrtc-answer", { fromId: socket.id, answer })
  })
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("webrtc-ice-candidate", { fromId: socket.id, candidate })
  })

  socket.on("disconnect", (reason) => {
    const { roomId, username } = socket.data
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId)
      room.users.delete(socket.id)
      socket.to(roomId).emit("peer-left", { peerId: socket.id, username })
      cleanupRoom(roomId)
      console.log(`[room] ${username} left ${roomId} (reason: ${reason})`)
    }
    console.log(`[socket] disconnected: ${socket.id}`)
  })
})

// ── REST ──────────────────────────────────────────────────────────────────────
app.get("/api/rooms", (req, res) => {
  const list = []
  for (const [roomId, room] of rooms.entries()) {
    list.push({
      roomId,
      userCount: room.users.size,
      createdAt: room.createdAt,
      problemSlug: room.problemSlug || null,
    })
  }
  res.json({ rooms: list })
})

app.post("/api/rooms", (req, res) => {
  const { roomId, problemSlug } = req.body
  if (!roomId || typeof roomId !== "string" || roomId.trim() === "") {
    return res.status(400).json({ error: "roomId is required" })
  }
  const clean = roomId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
  getOrCreateRoom(clean, problemSlug || null)
  res.json({ roomId: clean })
})

// LeetCode proxy — Phase 3
app.get("/api/problems", async (req, res) => {
  res.json({ message: "LeetCode proxy coming in Phase 3", problems: [] })
})
app.get("/api/problems/:slug", async (req, res) => {
  res.json({ message: "LeetCode proxy coming in Phase 3", problem: null })
})

app.get("/health", (req, res) => {
  res.json({ message: "ok", success: true, activeRooms: rooms.size })
})

httpServer.listen(3000, () => {
  console.log("server running on http://localhost:3000")
})
