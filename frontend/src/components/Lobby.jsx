import { useState, useEffect, useCallback, useRef } from "react"

function generateRoomId() {
  const adjectives = ["swift", "quiet", "brave", "calm", "sharp", "clear", "bold", "dark", "fast", "cold"]
  const nouns = ["river", "tower", "stone", "flame", "cloud", "ridge", "field", "storm", "light", "wave"]
  const num = Math.floor(Math.random() * 90) + 10
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${num}`
}

const DIFF = {
  Easy:   { label: "Easy",   cls: "text-emerald-400 bg-emerald-950/60 border-emerald-800/60" },
  Medium: { label: "Medium", cls: "text-amber-400  bg-amber-950/60  border-amber-800/60"  },
  Hard:   { label: "Hard",   cls: "text-rose-400   bg-rose-950/60   border-rose-800/60"   },
}

const TABS = ["Problems", "Active Rooms"]

export default function Lobby({ username, onJoinRoom }) {
  const [tab, setTab] = useState("Problems")

  // ── Problems state ────────────────────────────────────────────────────────
  const [problems, setProblems]         = useState([])
  const [total, setTotal]               = useState(0)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState("")
  const [difficulty, setDifficulty]     = useState("")   // "" | "EASY" | "MEDIUM" | "HARD"
  const [search, setSearch]             = useState("")
  const [page, setPage]                 = useState(0)
  const [creating, setCreating]         = useState(null) // slug being created
  const PAGE_SIZE = 20
  const searchRef = useRef(null)

  // ── Active rooms state ────────────────────────────────────────────────────
  const [rooms, setRooms]               = useState([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const [roomsError, setRoomsError]     = useState("")
  const [joinInput, setJoinInput]       = useState("")

  // ── Fetch problems ────────────────────────────────────────────────────────
  const fetchProblems = useCallback(async (diff, pg) => {
    setLoading(true)
    setError("")
    try {
      const skip = pg * PAGE_SIZE
      const url  = `http://localhost:3000/api/problems?limit=${PAGE_SIZE}&skip=${skip}${diff ? `&difficulty=${diff}` : ""}`
      const res  = await fetch(url)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setProblems(data.problems || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError("Could not load problems — " + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProblems(difficulty, page) }, [difficulty, page, fetchProblems])

  // ── Fetch rooms ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function fetchRooms() {
      try {
        const res  = await fetch("http://localhost:3000/api/rooms")
        const data = await res.json()
        if (!cancelled) { setRooms(data.rooms || []); setRoomsLoading(false) }
      } catch {
        if (!cancelled) { setRoomsError("Could not reach server"); setRoomsLoading(false) }
      }
    }
    fetchRooms()
    const iv = setInterval(fetchRooms, 5000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  // ── Client-side search filter ─────────────────────────────────────────────
  const filtered = search.trim()
    ? problems.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.frontendQuestionId?.toString().includes(search)
      )
    : problems

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleSolve(problem) {
    setCreating(problem.titleSlug)
    const roomId = generateRoomId()
    try {
      await fetch("http://localhost:3000/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, problemSlug: problem.titleSlug }),
      })
    } catch { /* non-fatal */ }
    onJoinRoom(roomId, problem.titleSlug)
    setCreating(null)
  }

  function handleJoinById(e) {
    e.preventDefault()
    const clean = joinInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
    if (!clean) return
    onJoinRoom(clean, null)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#0d1117] text-white flex flex-col">

      {/* ── Nav bar ── */}
      <nav className="border-b border-gray-800/80 bg-[#0d1117]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
              </svg>
            </div>
            <span className="font-bold text-white tracking-tight text-base">CodeTogether</span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  tab === t
                    ? "bg-gray-700 text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {t}
                {t === "Active Rooms" && rooms.length > 0 && (
                  <span className="ml-1.5 text-xs bg-blue-600 text-white rounded-full px-1.5 py-0.5">
                    {rooms.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* User */}
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
            <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
              {username[0]?.toUpperCase()}
            </div>
            <span className="text-sm text-gray-300">{username}</span>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto w-full px-6 py-8 flex-1">

        {/* ── Problems tab ── */}
        {tab === "Problems" && (
          <div className="flex flex-col gap-6">

            {/* Header */}
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-white">Problems</h1>
              <p className="text-gray-400 text-sm">
                Pick a problem, start a room, and collaborate in real-time.
              </p>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search problems…"
                  className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-lg pl-9 pr-4 py-2.5 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                />
              </div>

              {/* Difficulty filter */}
              <div className="flex gap-2">
                {["", "EASY", "MEDIUM", "HARD"].map(d => (
                  <button
                    key={d}
                    onClick={() => { setDifficulty(d); setPage(0) }}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      difficulty === d
                        ? d === ""       ? "bg-gray-700 border-gray-600 text-white"
                        : d === "EASY"   ? "bg-emerald-950 border-emerald-700 text-emerald-400"
                        : d === "MEDIUM" ? "bg-amber-950 border-amber-700 text-amber-400"
                                         : "bg-rose-950 border-rose-700 text-rose-400"
                        : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                    }`}
                  >
                    {d === "" ? "All" : d[0] + d.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Problem table */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[2.5rem_1fr_6rem_5rem_5rem] gap-4 px-5 py-3 border-b border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <span>#</span>
                <span>Title</span>
                <span>Difficulty</span>
                <span className="text-right">Acc. %</span>
                <span></span>
              </div>

              {/* Loading */}
              {loading && (
                <div className="py-20 flex flex-col items-center gap-3 text-gray-600">
                  <div className="w-6 h-6 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
                  <span className="text-sm">Loading problems…</span>
                </div>
              )}

              {/* Error */}
              {!loading && error && (
                <div className="py-12 text-center">
                  <p className="text-red-400 text-sm">{error}</p>
                  <button onClick={() => fetchProblems(difficulty, page)} className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline">
                    Retry
                  </button>
                </div>
              )}

              {/* Empty */}
              {!loading && !error && filtered.length === 0 && (
                <div className="py-12 text-center text-gray-600 text-sm">No problems found.</div>
              )}

              {/* Rows */}
              {!loading && !error && filtered.map((p, idx) => (
                <div
                  key={p.titleSlug}
                  className={`grid grid-cols-[2.5rem_1fr_6rem_5rem_5rem] gap-4 px-5 py-3.5 items-center border-b border-gray-800/60 last:border-0 hover:bg-gray-800/40 transition-colors group ${
                    idx % 2 === 0 ? "" : "bg-gray-900/30"
                  }`}
                >
                  {/* Number */}
                  <span className="text-gray-600 text-sm font-mono">{p.frontendQuestionId}</span>

                  {/* Title + tags */}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-gray-200 text-sm font-medium truncate group-hover:text-white transition-colors">
                      {p.title}
                    </span>
                    {p.topicTags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {p.topicTags.slice(0, 3).map(tag => (
                          <span key={tag.slug} className="text-xs text-gray-600 bg-gray-800 rounded px-1.5 py-0.5">
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Difficulty */}
                  <span className={`text-xs font-semibold px-2 py-1 rounded-md border w-fit ${DIFF[p.difficulty]?.cls}`}>
                    {p.difficulty}
                  </span>

                  {/* Acceptance */}
                  <span className="text-right text-sm text-gray-500 font-mono">
                    {p.acRate ? `${Math.round(p.acRate)}%` : "—"}
                  </span>

                  {/* Solve button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSolve(p)}
                      disabled={creating === p.titleSlug}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-600/40 text-blue-400 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all disabled:opacity-50"
                    >
                      {creating === p.titleSlug ? "…" : "Solve →"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {!loading && !error && totalPages > 1 && !search && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 text-xs">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} problems
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs"
                  >
                    ← Prev
                  </button>
                  <span className="text-gray-500 text-xs px-2">Page {page + 1} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Active Rooms tab ── */}
        {tab === "Active Rooms" && (
          <div className="flex flex-col gap-6">

            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-white">Active Rooms</h1>
              <p className="text-gray-400 text-sm">Join an existing session or start a blank room.</p>
            </div>

            {/* Quick join + create blank */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Join by room ID</h2>
                  <p className="text-gray-500 text-xs mt-0.5">Enter an ID shared by a teammate.</p>
                </div>
                <form onSubmit={handleJoinById} className="flex gap-2">
                  <input
                    type="text" value={joinInput} onChange={e => setJoinInput(e.target.value)}
                    placeholder="e.g. swift-river-42"
                    className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-0"
                  />
                  <button type="submit" className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0">
                    Join
                  </button>
                </form>
              </div>

              <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Create blank room</h2>
                  <p className="text-gray-500 text-xs mt-0.5">No problem attached — free-form coding session.</p>
                </div>
                <button
                  onClick={() => onJoinRoom(generateRoomId(), null)}
                  className="w-full bg-blue-600/20 border border-blue-600/40 text-blue-400 hover:bg-blue-600 hover:text-white hover:border-blue-600 text-sm font-semibold py-2.5 rounded-lg transition-all"
                >
                  + Create room
                </button>
              </div>
            </div>

            {/* Room list */}
            {roomsError && (
              <div className="bg-red-950/40 border border-red-800/60 text-red-400 rounded-xl px-4 py-3 text-sm">{roomsError}</div>
            )}

            {roomsLoading && (
              <div className="text-gray-600 text-sm py-8 text-center">Loading rooms…</div>
            )}

            {!roomsLoading && rooms.length === 0 && (
              <div className="text-gray-600 text-sm py-12 text-center bg-gray-900/40 border border-gray-800 rounded-xl">
                No active rooms. Go solve a problem!
              </div>
            )}

            {!roomsLoading && rooms.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_8rem_6rem_5rem] gap-4 px-5 py-3 border-b border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <span>Room</span>
                  <span>Problem</span>
                  <span>People</span>
                  <span></span>
                </div>
                {rooms.map((room, idx) => (
                  <div
                    key={room.roomId}
                    className={`grid grid-cols-[1fr_8rem_6rem_5rem] gap-4 px-5 py-3.5 items-center border-b border-gray-800/60 last:border-0 hover:bg-gray-800/40 transition-colors ${idx % 2 === 0 ? "" : "bg-gray-900/30"}`}
                  >
                    <span className="font-mono text-sm text-gray-300">{room.roomId}</span>
                    <span className="text-xs text-blue-400 truncate">
                      {room.problemSlug || <span className="text-gray-600">—</span>}
                    </span>
                    <span className="text-sm text-gray-400">
                      {room.userCount} {room.userCount === 1 ? "person" : "people"}
                    </span>
                    <div className="flex justify-end">
                      <button
                        onClick={() => onJoinRoom(room.roomId, room.problemSlug || null)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
                      >
                        Join →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
