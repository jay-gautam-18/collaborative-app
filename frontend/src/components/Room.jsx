import { useState, useRef, useMemo, useEffect, useCallback } from "react"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"
import { SocketIOProvider } from "y-socket.io"
import * as Y from "yjs"
import useWebRTC from "../hooks/useWebRTC"
import MeetingStrip from "./MeetingStrip"

// ── Helpers ───────────────────────────────────────────────────────────────────
const CURSOR_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
]

function colorForUser(username) {
  let hash = 0
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash)
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

let cursorCssInjected = false
function injectCursorCSS() {
  if (cursorCssInjected) return
  cursorCssInjected = true
  const style = document.createElement("style")
  style.textContent = `
    .yRemoteSelection{background-color:var(--yrs-color,rgba(59,130,246,.35));border-radius:2px}
    .yRemoteSelectionHead{position:absolute;border-left:2px solid var(--yrs-color,#3B82F6);border-top:2px solid var(--yrs-color,#3B82F6);border-top-right-radius:2px;height:100%;box-sizing:border-box}
    .yRemoteSelectionHead::after{position:absolute;content:attr(data-username);background-color:var(--yrs-color,#3B82F6);color:#fff;font-size:11px;font-family:monospace;padding:1px 5px;border-radius:0 3px 3px 3px;white-space:nowrap;top:-1.4em;left:-2px;pointer-events:none;z-index:100}
    .scrollbar-hide::-webkit-scrollbar{display:none}
    .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
    .problem-content p{margin-bottom:.75rem}
    .problem-content pre{background:#1e1e2e;border:1px solid #374151;border-radius:6px;padding:10px 12px;margin:8px 0;font-size:12px;overflow-x:auto;white-space:pre-wrap}
    .problem-content code{background:#1e1e2e;border:1px solid #374151;border-radius:3px;padding:1px 4px;font-size:12px}
    .problem-content strong{color:#e5e7eb}
    .problem-content ul{list-style:disc;padding-left:1.25rem;margin-bottom:.75rem}
    .problem-content ol{list-style:decimal;padding-left:1.25rem;margin-bottom:.75rem}
    .problem-content li{margin-bottom:.25rem}
    .problem-content sup{font-size:.75em;vertical-align:super}
  `
  document.head.appendChild(style)
}

const DIFFICULTY_COLOR = {
  Easy:   "text-emerald-400 bg-emerald-950/60 border-emerald-800/60",
  Medium: "text-amber-400 bg-amber-950/60 border-amber-800/60",
  Hard:   "text-rose-400 bg-rose-950/60 border-rose-800/60",
}

// ── Problem panel ─────────────────────────────────────────────────────────────
function ProblemPanel({ problemSlug }) {
  const [problem, setProblem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState("")
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!problemSlug) { setLoading(false); return }
    setLoading(true)
    fetch(`http://localhost:3000/api/problems/${problemSlug}`)
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.error); setProblem(data.problem); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [problemSlug])

  if (collapsed) {
    return (
      <div className="w-8 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 shrink-0">
        <button onClick={() => setCollapsed(false)} className="text-gray-500 hover:text-white transition-colors" title="Show problem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
    )
  }

  return (
    <aside className="w-80 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Problem</h2>
        <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-white transition-colors" title="Collapse">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 5v14L4 12z"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-gray-300">
        {loading && <div className="flex items-center gap-2 text-gray-500 mt-4"><div className="w-3 h-3 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin"/>Loading…</div>}
        {error && <div className="text-red-400 text-xs mt-4 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">Failed: {error}</div>}
        {!loading && !error && !problem && <div className="text-gray-500 text-xs mt-4">No problem attached.</div>}
        {problem && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-gray-400 text-xs">#{problem.questionFrontendId}</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${DIFFICULTY_COLOR[problem.difficulty]}`}>{problem.difficulty}</span>
              </div>
              <h3 className="text-white font-semibold text-base leading-snug">{problem.title}</h3>
            </div>
            {problem.topicTags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {problem.topicTags.map(tag => (
                  <span key={tag.slug} className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded px-2 py-0.5">{tag.name}</span>
                ))}
              </div>
            )}
            {problem.content && (
              <div className="problem-content text-gray-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: problem.content }}/>
            )}
            {problem.hints?.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">Hints ({problem.hints.length})</summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {problem.hints.map((hint, i) => (
                    <li key={i} className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded px-3 py-2">{hint}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

// ── Terminal panel ────────────────────────────────────────────────────────────
function Terminal({ lines, isRunning, onClear }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [lines])

  return (
    <div className="flex flex-col h-full bg-[#0d1117] font-mono text-xs">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/70"/>
            <div className="w-3 h-3 rounded-full bg-yellow-500/70"/>
            <div className="w-3 h-3 rounded-full bg-green-500/70"/>
          </div>
          <span className="text-gray-500 text-xs ml-1">output</span>
          {isRunning && (
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/>
              <span className="text-green-400 text-xs">running</span>
            </div>
          )}
        </div>
        <button onClick={onClear} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">
          clear
        </button>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 leading-relaxed">
        {lines.length === 0 && (
          <span className="text-gray-700">Run your code to see output here…</span>
        )}
        {lines.map((line, i) => (
          <span
            key={i}
            className={
              line.type === "stderr" ? "text-red-400" :
              line.type === "info"   ? "text-gray-500" :
              "text-gray-200"
            }
            style={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
          >
            {line.text}
          </span>
        ))}
        <div ref={bottomRef}/>
      </div>
    </div>
  )
}

// ── Main Room component ───────────────────────────────────────────────────────
export default function Room({ roomId, username, problemSlug, onLeave }) {
  const editorRef    = useRef(null)
  const providerRef  = useRef(null)
  const bindingRef   = useRef(null)
  const awarenessRef = useRef(null)
  const chatBottomRef = useRef(null)
  const yTextRef     = useRef(null)   // stable ref to yText for run button

  const [users, setUsers]         = useState([])
  const [language, setLanguage]   = useState("javascript")
  const [copied, setCopied]       = useState(false)
  const [messages, setMessages]   = useState([])
  const [chatInput, setChatInput] = useState("")
  const [meetingActive, setMeetingActive] = useState(false)
  const [socket, setSocket]       = useState(null)

  // ── Terminal state ────────────────────────────────────────────────────────
  const [terminalLines, setTerminalLines] = useState([])
  const [isRunning, setIsRunning]         = useState(false)
  const [terminalOpen, setTerminalOpen]   = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(200)

  // ── Yjs ───────────────────────────────────────────────────────────────────
  const yDoc      = useMemo(() => new Y.Doc(), [])
  const yText     = useMemo(() => yDoc.getText("monaco"), [yDoc])
  const ySettings = useMemo(() => yDoc.getMap("settings"), [yDoc])
  const yMessages = useMemo(() => yDoc.getArray("messages"), [yDoc])

  useEffect(() => {
    yTextRef.current = yText
    injectCursorCSS()
  }, [yText])

  // ── Provider ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const provider = new SocketIOProvider("http://localhost:3000", roomId, yDoc, { autoConnect: true })
    providerRef.current  = provider
    awarenessRef.current = provider.awareness
    setSocket(provider.socket)

    provider.socket.emit("join-room", { roomId, username, problemSlug })

    const myColor = colorForUser(username)
    provider.awareness.setLocalStateField("user", { username, name: username, color: myColor })

    function handleUnload() {
      provider.awareness.setLocalStateField("user", null)
      provider.awareness.destroy()
    }
    window.addEventListener("beforeunload", handleUnload)

    function updateUsers() {
      const states = Array.from(provider.awareness.getStates().values())
      setUsers(states.filter(s => s.user?.username).map(s => s.user))
    }
    updateUsers()
    provider.awareness.on("change", updateUsers)

    function onSettingsChange() {
      const lang = ySettings.get("language")
      if (lang) setLanguage(lang)
    }
    ySettings.observe(onSettingsChange)

    function onMessagesChange() { setMessages(yMessages.toArray()) }
    yMessages.observe(onMessagesChange)
    setMessages(yMessages.toArray())

    provider.on("sync", (isSynced) => {
      if (isSynced) {
        const lang = ySettings.get("language")
        if (lang) setLanguage(lang)
        setMessages(yMessages.toArray())
      }
    })

    // ── Run notifications from other users ─────────────────────────────────
    provider.socket.on("run-notification", ({ username: who, language: lang }) => {
      setTerminalLines(prev => [...prev, {
        type: "info",
        text: `▶ ${who} is running ${lang}…\n`,
      }])
      setTerminalOpen(true)
    })

    // ── Execution output (only comes to the user who ran) ──────────────────
    provider.socket.on("run-output", ({ type, text }) => {
      if (type === "clear") { setTerminalLines([]); return }
      setTerminalLines(prev => [...prev, { type, text }])
      setTerminalOpen(true)
    })

    provider.socket.on("run-done", ({ exitCode }) => {
      setIsRunning(false)
    })

    return () => {
      window.removeEventListener("beforeunload", handleUnload)
      provider.awareness.setLocalStateField("user", null)
      provider.awareness.off("change", updateUsers)
      ySettings.unobserve(onSettingsChange)
      yMessages.unobserve(onMessagesChange)
      bindingRef.current?.destroy()
      bindingRef.current = null
      provider.socket.off("run-output")
      provider.socket.off("run-done")
      provider.socket.off("run-notification")
      provider.disconnect()
      providerRef.current  = null
      awarenessRef.current = null
      setSocket(null)
    }
  }, [roomId, username, problemSlug, yDoc, ySettings, yMessages])

  // ── Run code ──────────────────────────────────────────────────────────────
  function handleRun() {
    if (isRunning || !socket) return
    const code = yTextRef.current?.toString() || ""
    if (!code.trim()) return

    setIsRunning(true)
    setTerminalOpen(true)
    socket.emit("run-code", { code, language, roomId })
  }

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const { localStream, peers, isMuted, isCamOff, isScreenSharing,
    toggleMic, toggleCam, toggleScreenShare, joinMeeting, leaveMeeting,
  } = useWebRTC({ socket, roomId, username, meetingActive })

  async function handleToggleMeeting() {
    if (meetingActive) { leaveMeeting(); setMeetingActive(false) }
    else { setMeetingActive(true); await joinMeeting() }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  function sendMessage() {
    const text = chatInput.trim()
    if (!text) return
    yMessages.push([{ username, color: colorForUser(username), text, ts: Date.now() }])
    setChatInput("")
  }

  function handleChatKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // ── Monaco mount ──────────────────────────────────────────────────────────
  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor
    setTimeout(() => {
      const awareness = awarenessRef.current
      if (!awareness) return
      bindingRef.current = new MonacoBinding(yText, editor.getModel(), new Set([editor]), awareness)
    }, 0)
  }, [yText])

  function handleLanguageChange(e) {
    const lang = e.target.value
    setLanguage(lang)
    ySettings.set("language", lang)
  }

  function copyRoomId() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Terminal resize drag ──────────────────────────────────────────────────
  const dragRef = useRef(null)
  function onDragStart(e) {
    const startY = e.clientY
    const startH = terminalHeight
    function onMove(ev) {
      const delta = startY - ev.clientY
      setTerminalHeight(Math.max(80, Math.min(500, startH + delta)))
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const SUPPORTED = ["javascript", "typescript", "python", "cpp", "java"]
  const canRun = SUPPORTED.includes(language)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-3 shrink-0">
        <span className="text-white font-bold text-sm tracking-tight">CodeTogether</span>
        <div className="w-px h-5 bg-gray-700"/>

        <button onClick={copyRoomId} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors group" title="Copy room link">
          <span className="font-mono text-xs">{roomId}</span>
          <span className="text-xs text-gray-600 group-hover:text-gray-400">{copied ? "✓" : "copy"}</span>
        </button>

        <div className="flex-1 flex justify-center items-center gap-3">
          <select
            value={language} onChange={handleLanguageChange}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
          </select>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={isRunning || !canRun || !socket}
            title={!canRun ? `${language} execution not supported on this server` : "Run code (shared with room)"}
            className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-lg transition-all ${
              isRunning
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : !canRun
                  ? "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700"
                  : "bg-green-600 hover:bg-green-500 text-white shadow-sm shadow-green-900/40"
            }`}
          >
            {isRunning ? (
              <>
                <div className="w-3 h-3 border-2 border-gray-500 border-t-gray-200 rounded-full animate-spin"/>
                Running…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Run
              </>
            )}
          </button>
        </div>

        {/* Meeting toggle */}
        <button
          onClick={handleToggleMeeting}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${meetingActive ? "bg-red-600 hover:bg-red-500 text-white" : "bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300"}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            {meetingActive
              ? <path d="M23.77 17.48l-4.56-4.55-2.83 2.83 1.29 1.29c-1.34.65-2.79 1.05-4.34 1.12l-1.43-1.43-2.83 2.83 3.24 3.24C22.36 22.56 23.77 17.48 23.77 17.48zM1 1.27L2.28 0 24 21.72 22.73 23l-3.38-3.38C14.55 23.2 6.26 21.6 1.82 15.96l3.56-3.56 1.3 1.3c-.62-.77-1.06-1.67-1.3-2.62L4 9.73 6.84 6.9 1 1.27z"/>
              : <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            }
          </svg>
          {meetingActive ? "End call" : "Call"}
        </button>

        <button onClick={onLeave} className="text-sm text-gray-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-900/20">
          Leave
        </button>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Problem panel */}
        {problemSlug && <ProblemPanel problemSlug={problemSlug}/>}

        {/* Editor + terminal column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Editor */}
          <section className="flex-1 overflow-hidden min-h-0">
            <Editor
              height="100%"
              language={language}
              defaultValue="// Start coding together..."
              theme="vs-dark"
              onMount={handleEditorMount}
              options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, fixedOverflowWidgets: true }}
            />
          </section>

          {/* Terminal panel */}
          {terminalOpen && (
            <>
              {/* Drag handle */}
              <div
                ref={dragRef}
                onMouseDown={onDragStart}
                className="h-1.5 bg-gray-800 hover:bg-blue-600/50 cursor-row-resize transition-colors shrink-0 border-t border-gray-700"
                title="Drag to resize terminal"
              />
              <div className="shrink-0 bg-[#0d1117] border-t border-gray-800" style={{ height: terminalHeight }}>
                <Terminal
                  lines={terminalLines}
                  isRunning={isRunning}
                  onClear={() => setTerminalLines([])}
                />
              </div>
            </>
          )}

          {/* Terminal toggle tab (when closed) */}
          {!terminalOpen && (
            <div className="shrink-0 border-t border-gray-800 bg-gray-900 flex items-center px-4 h-8">
              <button
                onClick={() => setTerminalOpen(true)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Terminal
                {terminalLines.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5"/>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <aside className="w-64 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0">

          {/* Online users */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Online — {users.length}</h2>
            <ul className="flex flex-col gap-2">
              {users.map((u, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: u.color || colorForUser(u.username) }}/>
                  <span className="text-sm text-gray-200 truncate">
                    {u.username}{u.username === username && <span className="text-gray-500 text-xs ml-1">(you)</span>}
                  </span>
                  {meetingActive && u.username === username && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-green-500 shrink-0" title="In call"/>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-800 shrink-0">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Chat</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
              {messages.length === 0 && <p className="text-gray-600 text-xs text-center mt-4">No messages yet. Say hello!</p>}
              {messages.map((msg, i) => {
                const isMe = msg.username === username
                return (
                  <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    {(i === 0 || messages[i - 1].username !== msg.username) && (
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span className="text-xs font-medium" style={{ color: msg.color || colorForUser(msg.username) }}>
                          {isMe ? "you" : msg.username}
                        </span>
                        <span className="text-gray-600 text-xs">{formatTime(msg.ts)}</span>
                      </div>
                    )}
                    <div className={`max-w-[200px] px-3 py-1.5 rounded-2xl text-sm leading-snug break-words ${isMe ? "bg-blue-600 text-white rounded-tr-sm" : "bg-gray-800 text-gray-100 rounded-tl-sm"}`}>
                      {msg.text}
                    </div>
                  </div>
                )
              })}
              <div ref={chatBottomRef}/>
            </div>
            <div className="p-3 border-t border-gray-800 shrink-0">
              <div className="flex gap-2">
                <input
                  type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown} placeholder="Message…" maxLength={500}
                  className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                />
                <button onClick={sendMessage} disabled={!chatInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors shrink-0">
                  Send
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Meeting strip */}
      <MeetingStrip
        isActive={meetingActive} localStream={localStream} peers={peers} username={username}
        isMuted={isMuted} isCamOff={isCamOff} isScreenSharing={isScreenSharing}
        onToggleMic={toggleMic} onToggleCam={toggleCam} onToggleScreen={toggleScreenShare}
        onLeave={handleToggleMeeting}
      />
    </main>
  )
}
