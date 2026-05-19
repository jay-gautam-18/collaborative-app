import { useState, useEffect } from "react"
import "./App.css"
import Lobby from "./components/Lobby"
import Room from "./components/Room"

// ── Tiny client-side router ────────────────────────────────────────────────────
// URL shapes:
//   /                  → lobby
//   /room/swift-river-42 → room view
//
// We do NOT use react-router to keep deps minimal. If you add react-router
// later just replace the useEffect + navigate helpers below.

function getRoomIdFromUrl() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)$/)
  return match ? match[1] : null
}

function navigateToRoom(roomId) {
  window.history.pushState({}, "", `/room/${roomId}`)
  // Force a re-render by dispatching a popstate-like event
  window.dispatchEvent(new Event("pushstate"))
}

function navigateToLobby() {
  window.history.pushState({}, "", "/")
  window.dispatchEvent(new Event("pushstate"))
}

export default function App() {
  const [username, setUsername] = useState(() => {
    // Persist username across page refreshes
    return localStorage.getItem("ct-username") || ""
  })
  const [usernameInput, setUsernameInput] = useState("")
  const [currentRoomId, setCurrentRoomId] = useState(() => getRoomIdFromUrl())

  // Listen to URL changes (back/forward + our custom pushstate event)
  useEffect(() => {
    function handleNavigate() {
      setCurrentRoomId(getRoomIdFromUrl())
    }
    window.addEventListener("popstate", handleNavigate)
    window.addEventListener("pushstate", handleNavigate)
    return () => {
      window.removeEventListener("popstate", handleNavigate)
      window.removeEventListener("pushstate", handleNavigate)
    }
  }, [])

  // ── Username gate ──────────────────────────────────────────────────────────
  if (!username) {
    function handleSetUsername(e) {
      e.preventDefault()
      const name = usernameInput.trim()
      if (!name) return
      localStorage.setItem("ct-username", name)
      setUsername(name)
    }

    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-white mb-2 text-center">CodeTogether</h1>
          <p className="text-gray-400 text-sm text-center mb-8">
            Choose a display name to get started
          </p>
          <form onSubmit={handleSetUsername} className="flex flex-col gap-3">
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="Your name or username"
              autoFocus
              className="bg-gray-800 border border-gray-600 text-white rounded-lg px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              Continue
            </button>
          </form>
        </div>
      </main>
    )
  }

  // ── Room view ──────────────────────────────────────────────────────────────
  if (currentRoomId) {
    return (
      <Room
        roomId={currentRoomId}
        username={username}
        onLeave={() => navigateToLobby()}
      />
    )
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  return (
    <Lobby
      username={username}
      onJoinRoom={(roomId) => navigateToRoom(roomId)}
    />
  )
}
