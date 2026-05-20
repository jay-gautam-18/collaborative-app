import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"
import cors from "cors"
import { spawn, execSync } from "child_process"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"

const app = express()
const httpServer = createServer(app)

app.use(express.json())
app.use(cors({ origin: "http://localhost:5173" }))
app.use(express.static("public"))

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 5000,
  pingTimeout: 10000,
})

// ── Yjs CRDT sync + LevelDB persistence ──────────────────────────────────────
const ySocketIo = new YSocketIO(io, {
  levelPersistenceName: "./y-leveldb-store",
})
ySocketIo.initialize()

// ── In-memory room registry ───────────────────────────────────────────────────
const rooms = new Map()
const meetingMembers = new Map()

function getOrCreateRoom(roomId, problemSlug = null) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Set(), createdAt: Date.now(), problemSlug })
  }
  return rooms.get(roomId)
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId)
  if (room && room.users.size === 0) {
    rooms.delete(roomId)
    meetingMembers.delete(roomId)
  }
}

// ── Code execution engine ─────────────────────────────────────────────────────

const EXECUTION_TIMEOUT_MS = 10000  // 10 seconds max
const MAX_OUTPUT_BYTES      = 50000  // 50 KB output cap

// Supported languages and how to run them
// Each entry: { ext, run: (filePath, dir) => { cmd, args } }
// For compiled languages: { ext, compile: (filePath, dir) => { cmd, args }, run: (dir) => { cmd, args } }
const RUNNERS = {
  javascript: {
    ext: "js",
    run: (fp) => ({ cmd: "node", args: ["--max-old-space-size=64", fp] }),
  },
  typescript: {
    ext: "ts",
    // Transpile with node --input-type after stripping types via a quick sed
    // (avoids needing tsc — uses node's built-in strip-only mode in v22+)
    run: (fp) => ({ cmd: "node", args: ["--experimental-strip-types", fp] }),
  },
  python: {
    ext: "py",
    run: (fp) => ({ cmd: "python3", args: ["-u", fp] }),
  },
  cpp: {
    ext: "cpp",
    compile: (fp, dir) => ({ cmd: "g++", args: ["-O2", "-o", join(dir, "out"), fp] }),
    run: (_fp, dir) => ({ cmd: join(dir, "out"), args: [] }),
  },
  java: {
    ext: "java",
    // Wrap in a Main class if the user hasn't defined one
    wrapIfNeeded: (code) => {
      if (/class\s+\w+/.test(code)) return code
      return `public class Main {\n  public static void main(String[] args) {\n${code.split("\n").map(l => "    " + l).join("\n")}\n  }\n}`
    },
    compile: (fp, dir) => ({ cmd: "javac", args: [fp] }),
    run: (_fp, dir) => ({ cmd: "java", args: ["-cp", dir, "Main"] }),
  },
  go: { unsupported: true, reason: "Go is not installed on this server." },
  rust: { unsupported: true, reason: "Rust is not installed on this server." },
}

// Check javac availability once at startup
let javacAvailable = false
try { execSync("javac --version", { stdio: "ignore" }); javacAvailable = true } catch { /* not available */ }

function executeCode(language, code, onData, onEnd) {
  const runner = RUNNERS[language]

  if (!runner) {
    onData("stderr", `Language '${language}' is not supported.\n`)
    onEnd(1)
    return
  }

  if (runner.unsupported) {
    onData("stderr", `⚠ ${runner.reason}\n`)
    onEnd(1)
    return
  }

  if (language === "java" && !javacAvailable) {
    onData("stderr", "⚠ Java compiler (javac) is not available on this server.\n")
    onEnd(1)
    return
  }

  // Create isolated temp directory for this execution
  const execId = randomUUID()
  const execDir = join(tmpdir(), `ct-exec-${execId}`)
  mkdirSync(execDir, { recursive: true })

  // Apply any code transformation (e.g. Java class wrapping)
  const finalCode = runner.wrapIfNeeded ? runner.wrapIfNeeded(code) : code

  const fileName = language === "java" ? "Main.java" : `solution.${runner.ext}`
  const filePath  = join(execDir, fileName)
  writeFileSync(filePath, finalCode, "utf8")

  let outputBytes = 0
  let killed      = false
  let proc        = null

  function cleanup() {
    try { rmSync(execDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  function runProcess(cmd, args) {
    proc = spawn(cmd, args, {
      cwd: execDir,
      timeout: EXECUTION_TIMEOUT_MS,
      env: {
        PATH: process.env.PATH,
        HOME: execDir,
        // Isolate — strip most env vars
        LANG: "en_US.UTF-8",
      },
    })

    proc.stdout.on("data", (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        if (!killed) {
          killed = true
          proc.kill("SIGKILL")
          onData("stderr", "\n⚠ Output limit exceeded (50 KB). Process killed.\n")
        }
        return
      }
      onData("stdout", chunk.toString())
    })

    proc.stderr.on("data", (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) return
      onData("stderr", chunk.toString())
    })

    proc.on("close", (code, signal) => {
      cleanup()
      if (signal === "SIGKILL" && !killed) {
        onData("stderr", `\n⏱ Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s.\n`)
        onEnd(1)
      } else {
        onEnd(code ?? 1)
      }
    })

    proc.on("error", (err) => {
      cleanup()
      onData("stderr", `\n⚠ Execution error: ${err.message}\n`)
      onEnd(1)
    })

    // Manual timeout as a safety net (spawn's timeout option isn't always reliable)
    setTimeout(() => {
      if (proc && !proc.killed) {
        killed = true
        proc.kill("SIGKILL")
        onData("stderr", `\n⏱ Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s.\n`)
      }
    }, EXECUTION_TIMEOUT_MS)
  }

  if (runner.compile) {
    // Compiled language: compile first, then run
    const { cmd, args } = runner.compile(filePath, execDir)
    const compiler = spawn(cmd, args, { cwd: execDir, env: { PATH: process.env.PATH } })

    let compileErr = ""
    compiler.stderr.on("data", (d) => { compileErr += d.toString() })
    compiler.stdout.on("data", (d) => { compileErr += d.toString() }) // some compilers use stdout

    compiler.on("close", (code) => {
      if (code !== 0) {
        onData("stderr", `Compilation failed:\n${compileErr}`)
        onEnd(code)
        cleanup()
        return
      }
      // Compilation succeeded — now run
      const run = runner.run(filePath, execDir)
      runProcess(run.cmd, run.args)
    })

    compiler.on("error", (err) => {
      onData("stderr", `Compiler error: ${err.message}\n`)
      onEnd(1)
      cleanup()
    })
  } else {
    const { cmd, args } = runner.run(filePath, execDir)
    runProcess(cmd, args)
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

  // ── Code execution ───────────────────────────────────────────────────────
  // Only the requesting socket receives output — not broadcast to the room.
  // The room sees a "run-started" notification so others know code is running.
  socket.on("run-code", ({ code, language, roomId }) => {
    const username = socket.data.username || "someone"
    console.log(`[exec] ${username} running ${language} (${code.length} chars)`)

    // Notify room that someone started running
    socket.to(roomId).emit("run-notification", { username, language })

    // Stream output back to the requesting socket only
    socket.emit("run-output", { type: "clear" })
    socket.emit("run-output", { type: "info", text: `▶ Running ${language}…\n` })

    const start = Date.now()

    executeCode(
      language,
      code,
      (type, text) => {
        socket.emit("run-output", { type, text })
      },
      (exitCode) => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(2)
        socket.emit("run-output", {
          type: "info",
          text: `\n─────────────────────────────\nExited with code ${exitCode} · ${elapsed}s\n`,
        })
        socket.emit("run-done", { exitCode })
      }
    )
  })

  // ── Meeting signalling ───────────────────────────────────────────────────
  socket.on("meeting-join", ({ roomId, username }) => {
    socket.data.inMeeting = true
    socket.data.meetingRoom = roomId

    if (!meetingMembers.has(roomId)) meetingMembers.set(roomId, new Set())
    const members = meetingMembers.get(roomId)

    members.forEach((peerId) => {
      io.to(peerId).emit("meeting-peer-joined", { peerId: socket.id, username })
    })

    const existingList = []
    members.forEach((peerId) => {
      const s = io.sockets.sockets.get(peerId)
      if (s) existingList.push({ peerId, username: s.data.username || peerId })
    })
    if (existingList.length > 0) {
      socket.emit("meeting-existing-members", { members: existingList })
    }

    members.add(socket.id)
    console.log(`[meeting] ${username} joined call in ${roomId} (${members.size} in call)`)
  })

  socket.on("meeting-leave", ({ roomId }) => {
    socket.data.inMeeting = false
    const members = meetingMembers.get(roomId)
    if (members) {
      members.delete(socket.id)
      socket.to(roomId).emit("meeting-peer-left", { peerId: socket.id })
    }
  })

  socket.on("webrtc-offer", ({ targetId, offer }) => {
    io.to(targetId).emit("webrtc-offer", { fromId: socket.id, offer, username: socket.data.username })
  })
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    io.to(targetId).emit("webrtc-answer", { fromId: socket.id, answer })
  })
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("webrtc-ice-candidate", { fromId: socket.id, candidate })
  })

  socket.on("disconnect", (reason) => {
    const { roomId, username, inMeeting } = socket.data
    if (inMeeting && roomId) {
      const members = meetingMembers.get(roomId)
      if (members) {
        members.delete(socket.id)
        socket.to(roomId).emit("meeting-peer-left", { peerId: socket.id })
      }
    }
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
    list.push({ roomId, userCount: room.users.size, createdAt: room.createdAt, problemSlug: room.problemSlug || null })
  }
  res.json({ rooms: list })
})

app.post("/api/rooms", (req, res) => {
  const { roomId, problemSlug } = req.body
  if (!roomId || typeof roomId !== "string" || roomId.trim() === "")
    return res.status(400).json({ error: "roomId is required" })
  const clean = roomId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
  getOrCreateRoom(clean, problemSlug || null)
  res.json({ roomId: clean })
})

const LC_GRAPHQL = "https://leetcode.com/graphql"
const HEADERS = {
  "Content-Type": "application/json",
  "Referer": "https://leetcode.com",
  "User-Agent": "Mozilla/5.0 (compatible; CodeTogether/1.0)",
}

app.get("/api/problems", async (req, res) => {
  const limit = parseInt(req.query.limit) || 20
  const skip = parseInt(req.query.skip) || 0
  const difficulty = req.query.difficulty
  const query = `
    query problemList($categorySlug:String,$limit:Int,$skip:Int,$filters:QuestionListFilterInput){
      problemsetQuestionList:questionList(categorySlug:$categorySlug,limit:$limit,skip:$skip,filters:$filters){
        total:totalNum
        questions:data{
          acRate difficulty frontendQuestionId:questionFrontendId
          paidOnly:isPaidOnly title titleSlug topicTags{name slug} hasSolution
        }
      }
    }`
  try {
    const response = await fetch(LC_GRAPHQL, {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({ query, variables: { categorySlug: "", limit, skip, filters: difficulty ? { difficulty } : {} } }),
    })
    const data = await response.json()
    const list = data?.data?.problemsetQuestionList
    if (!list) return res.status(502).json({ error: "Unexpected LeetCode response" })
    res.json({ total: list.total, problems: list.questions.filter(q => !q.paidOnly) })
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch from LeetCode", message: err.message })
  }
})

app.get("/api/problems/:slug", async (req, res) => {
  const query = `
    query questionDetail($titleSlug:String!){
      question(titleSlug:$titleSlug){
        questionId questionFrontendId title titleSlug content
        difficulty topicTags{name slug} exampleTestcases hints hasSolution
      }
    }`
  try {
    const response = await fetch(LC_GRAPHQL, {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({ query, variables: { titleSlug: req.params.slug } }),
    })
    const data = await response.json()
    const question = data?.data?.question
    if (!question) return res.status(404).json({ error: "Problem not found" })
    res.json({ problem: question })
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch problem", message: err.message })
  }
})

app.get("/health", (req, res) => {
  res.json({ ok: true, activeRooms: rooms.size })
})

httpServer.listen(3000, () => {
  console.log("server running on http://localhost:3000")
})
