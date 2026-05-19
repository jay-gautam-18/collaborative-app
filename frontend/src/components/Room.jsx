import { useState, useRef, useMemo, useEffect, useCallback } from "react"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"
import { SocketIOProvider } from "y-socket.io"
import * as Y from "yjs"

// ── Helpers ───────────────────────────────────────────────────────────────────
const CURSOR_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
]

function colorForUser(username) {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  }
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
    .yRemoteSelection {
      background-color: var(--yrs-color, rgba(59,130,246,0.35));
      border-radius: 2px;
    }
    .yRemoteSelectionHead {
      position: absolute;
      border-left: 2px solid var(--yrs-color, #3B82F6);
      border-top: 2px solid var(--yrs-color, #3B82F6);
      border-top-right-radius: 2px;
      height: 100%;
      box-sizing: border-box;
    }
    .yRemoteSelectionHead::after {
      position: absolute;
      content: attr(data-username);
      background-color: var(--yrs-color, #3B82F6);
      color: #fff;
      font-size: 11px;
      font-family: monospace;
      padding: 1px 5px;
      border-radius: 0 3px 3px 3px;
      white-space: nowrap;
      top: -1.4em;
      left: -2px;
      pointer-events: none;
      z-index: 100;
    }
  `
  document.head.appendChild(style)
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Room({ roomId, username, onLeave }) {
  const editorRef = useRef(null)
  const providerRef = useRef(null)
  const bindingRef = useRef(null)
  const awarenessRef = useRef(null)
  const chatBottomRef = useRef(null)

  const [users, setUsers] = useState([])
  const [language, setLanguage] = useState("javascript")
  const [copied, setCopied] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState("")

  // ── Stable Yjs shared structures ──────────────────────────────────────────
  const yDoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => yDoc.getText("monaco"), [yDoc])
  const ySettings = useMemo(() => yDoc.getMap("settings"), [yDoc])
  // Y.Array of { username, color, text, ts } objects — synced to all peers
  const yMessages = useMemo(() => yDoc.getArray("messages"), [yDoc])

  useEffect(() => { injectCursorCSS() }, [])

  // ── Provider ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const provider = new SocketIOProvider(
      "http://localhost:3000",
      roomId,
      yDoc,
      { autoConnect: true }
    )
    providerRef.current = provider
    awarenessRef.current = provider.awareness

    provider.socket.emit("join-room", { roomId, username })

    const myColor = colorForUser(username)
    provider.awareness.setLocalStateField("user", {
      username,
      name: username,
      color: myColor,
    })

    // Synchronous cleanup on refresh — kills ghost awareness states
    function handleUnload() {
      provider.awareness.setLocalStateField("user", null)
      provider.awareness.destroy()
    }
    window.addEventListener("beforeunload", handleUnload)

    // Online users
    function updateUsers() {
      const states = Array.from(provider.awareness.getStates().values())
      setUsers(
        states
          .filter((s) => s.user?.username)
          .map((s) => s.user)
      )
    }
    updateUsers()
    provider.awareness.on("change", updateUsers)

    // Language sync
    function onSettingsChange() {
      const lang = ySettings.get("language")
      if (lang && typeof lang === "string") setLanguage(lang)
    }
    ySettings.observe(onSettingsChange)

    // ── Chat sync ─────────────────────────────────────────────────────────
    // Y.Array.observe fires whenever any peer pushes a message.
    // We snapshot the full array into React state — simple and reliable.
    function onMessagesChange() {
      setMessages(yMessages.toArray())
    }
    yMessages.observe(onMessagesChange)
    // Load any persisted messages immediately
    setMessages(yMessages.toArray())

    // Read persisted language on sync
    provider.on("sync", (isSynced) => {
      if (isSynced) {
        const lang = ySettings.get("language")
        if (lang) setLanguage(lang)
        // Also load persisted messages on sync
        setMessages(yMessages.toArray())
      }
    })

    return () => {
      window.removeEventListener("beforeunload", handleUnload)
      provider.awareness.setLocalStateField("user", null)
      provider.awareness.off("change", updateUsers)
      ySettings.unobserve(onSettingsChange)
      yMessages.unobserve(onMessagesChange)
      bindingRef.current?.destroy()
      bindingRef.current = null
      provider.disconnect()
      providerRef.current = null
      awarenessRef.current = null
    }
  }, [roomId, username, yDoc, ySettings, yMessages])

  // ── Auto-scroll chat to bottom on new messages ────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // ── Monaco mount ──────────────────────────────────────────────────────────
  const handleEditorMount = useCallback(
    (editor) => {
      editorRef.current = editor
      setTimeout(() => {
        const awareness = awarenessRef.current
        if (!awareness) return
        bindingRef.current = new MonacoBinding(
          yText,
          editor.getModel(),
          new Set([editor]),
          awareness
        )
      }, 0)
    },
    [yText]
  )

  // ── Language change ───────────────────────────────────────────────────────
  function handleLanguageChange(e) {
    const lang = e.target.value
    setLanguage(lang)
    ySettings.set("language", lang)
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = chatInput.trim()
    if (!text) return
    // Push to Y.Array — automatically synced to all peers via Yjs
    yMessages.push([{
      username,
      color: colorForUser(username),
      text,
      ts: Date.now(),
    }])
    setChatInput("")
  }

  function handleChatKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Copy room link ────────────────────────────────────────────────────────
  function copyRoomId() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 shrink-0">
        <span className="text-white font-bold text-sm tracking-tight">CodeTogether</span>
        <div className="w-px h-5 bg-gray-700" />
        <button
          onClick={copyRoomId}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors group"
          title="Click to copy room link"
        >
          <span className="font-mono">{roomId}</span>
          <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
            {copied ? "✓ copied link" : "copy link"}
          </span>
        </button>

        <div className="flex-1 flex justify-center">
          <select
            value={language}
            onChange={handleLanguageChange}
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
        </div>

        <button
          onClick={onLeave}
          className="text-sm text-gray-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-900/20"
        >
          Leave room
        </button>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">

        {/* Editor */}
        <section className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={language}
            defaultValue="// Start coding together..."
            theme="vs-dark"
            onMount={handleEditorMount}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              fixedOverflowWidgets: true,
            }}
          />
        </section>

        {/* Right sidebar */}
        <aside className="w-64 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0">

          {/* Online users */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Online — {users.length}
            </h2>
            <ul className="flex flex-col gap-2">
              {users.map((u, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: u.color || colorForUser(u.username) }}
                  />
                  <span className="text-sm text-gray-200 truncate">
                    {u.username}
                    {u.username === username && (
                      <span className="text-gray-500 text-xs ml-1">(you)</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-800 shrink-0">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Chat</h2>
            </div>

            {/* Message list — scrollable */}
            <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
              {messages.length === 0 && (
                <p className="text-gray-600 text-xs text-center mt-4">
                  No messages yet. Say hello!
                </p>
              )}
              {messages.map((msg, i) => {
                const isMe = msg.username === username
                return (
                  <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    {/* Name + time */}
                    {/* Only show name header if different from previous message sender */}
                    {(i === 0 || messages[i - 1].username !== msg.username) && (
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span
                          className="text-xs font-medium"
                          style={{ color: msg.color || colorForUser(msg.username) }}
                        >
                          {isMe ? "you" : msg.username}
                        </span>
                        <span className="text-gray-600 text-xs">{formatTime(msg.ts)}</span>
                      </div>
                    )}
                    {/* Bubble */}
                    <div
                      className={`
                        max-w-[200px] px-3 py-1.5 rounded-2xl text-sm leading-snug break-words
                        ${isMe
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-gray-800 text-gray-100 rounded-tl-sm"
                        }
                      `}
                    >
                      {msg.text}
                    </div>
                  </div>
                )
              })}
              {/* Invisible anchor for auto-scroll */}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-800 shrink-0">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Message…"
                  maxLength={500}
                  className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                />
                <button
                  onClick={sendMessage}
                  disabled={!chatInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors shrink-0"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
