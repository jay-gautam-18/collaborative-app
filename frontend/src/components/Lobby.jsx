import { useState, useEffect } from "react"

// Generates a random readable room ID like "swift-river-42"
function generateRoomId() {
  const adjectives = ["swift", "quiet", "brave", "calm", "sharp", "clear", "bold", "dark", "fast", "cold"]
  const nouns = ["river", "tower", "stone", "flame", "cloud", "ridge", "field", "storm", "light", "wave"]
  const num = Math.floor(Math.random() * 90) + 10
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  return `${adj}-${noun}-${num}`
}

export default function Lobby({ username, onJoinRoom }) {
  const [activeRooms, setActiveRooms] = useState([])
  const [joinInput, setJoinInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Poll active rooms every 5 seconds
  useEffect(() => {
    let cancelled = false

    async function fetchRooms() {
      try {
        const res = await fetch("http://localhost:3000/api/rooms")
        const data = await res.json()
        if (!cancelled) {
          setActiveRooms(data.rooms || [])
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not reach server")
          setLoading(false)
        }
      }
    }

    fetchRooms()
    const interval = setInterval(fetchRooms, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  function handleCreateRoom() {
    const roomId = generateRoomId()
    onJoinRoom(roomId)
  }

  function handleJoinById(e) {
    e.preventDefault()
    const clean = joinInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
    if (!clean) return
    onJoinRoom(clean)
  }

  function handleJoinExisting(roomId) {
    onJoinRoom(roomId)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-start px-6 py-12">

      {/* Header */}
      <div className="w-full max-w-3xl mb-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">CodeTogether</h1>
            <p className="text-gray-400 mt-1 text-sm">
              Collaborative coding rooms — real-time editing, chat, and meetings
            </p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-300">
            Signed in as <span className="text-white font-medium">{username}</span>
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

        {/* Create room */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Create a room</h2>
            <p className="text-gray-400 text-sm mt-1">Start a new session. Share the room ID with others.</p>
          </div>
          <button
            onClick={handleCreateRoom}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            + Create room
          </button>
        </div>

        {/* Join by ID */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Join by ID</h2>
            <p className="text-gray-400 text-sm mt-1">Enter a room ID shared with you.</p>
          </div>
          <form onSubmit={handleJoinById} className="flex gap-2">
            <input
              type="text"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="e.g. swift-river-42"
              className="flex-1 bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
            >
              Join
            </button>
          </form>
        </div>
      </div>

      {/* Active rooms */}
      <div className="w-full max-w-3xl">
        <h2 className="text-base font-semibold text-gray-300 mb-3">Active rooms</h2>

        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-gray-500 text-sm py-6 text-center">Loading rooms…</div>
        )}

        {!loading && activeRooms.length === 0 && (
          <div className="text-gray-500 text-sm py-6 text-center bg-gray-900 border border-gray-800 rounded-xl">
            No active rooms yet. Create one above.
          </div>
        )}

        {!loading && activeRooms.length > 0 && (
          <div className="flex flex-col gap-2">
            {activeRooms.map((room) => (
              <div
                key={room.roomId}
                className="bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 flex items-center justify-between hover:border-gray-500 transition-colors"
              >
                <div>
                  <span className="text-white font-mono text-sm font-medium">{room.roomId}</span>
                  {room.problemSlug && (
                    <span className="ml-3 text-xs text-blue-400 bg-blue-900/40 border border-blue-800 rounded px-2 py-0.5">
                      {room.problemSlug}
                    </span>
                  )}
                  <p className="text-gray-500 text-xs mt-0.5">
                    {room.userCount} {room.userCount === 1 ? "person" : "people"} inside
                  </p>
                </div>
                <button
                  onClick={() => handleJoinExisting(room.roomId)}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
