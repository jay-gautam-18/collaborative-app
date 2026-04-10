import { useState ,useRef ,useMemo , useEffect } from 'react'
import './App.css'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import { SocketIOProvider } from 'y-socket.io'
import * as Y from "yjs"
function App() {
  const editorRef = useRef(null) 
  const [username , setUsername] = useState(()=>{
    return new URLSearchParams(window.location.search).get("username") || ""
  })

  const yDoc = useMemo( ()=> new Y.Doc() ,[] )
  const yText = useMemo( ()=> yDoc.getText("monaco") , [yDoc])
  const handleMount = (editor)=>{
    editorRef.current = editor

   
  }
  const handleJoin = (e)=>{
    e.preventDefault()
    setUsername(e.target.username.value)
    window.history.pushState({},"","?username="+e.target.username.value)
  }
  useEffect(()=>{
    if(editorRef.current && username){
       const provider = new SocketIOProvider("http://localhost:3000" , "monaco" ,yDoc,{autoConnect:true})
    const monacoBinding = new MonacoBinding(
      yText,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
      provider.awareness
    )
  }
  },[
    editorRef.current,
    username
  ])
  if(!username){
    return (
      <main className='h-screen w-screen bg-gray-950 flex gap-3 p-4 items-center justify-center'>
        <form className='felx flex-col gap-4'
        onSubmit={handleJoin}>
        <div className='flex flex-col gap-4'>
          <input
            type="text"
            placeholder="Enter your username"
            name = "username"
            className='bg-gray-800 text-white p-2 rounded-lg placeholder:text-gray-500 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500'
          />
          <button className='p-2 rounded-lg bg-amber-100 border-amber-100 text-gray-900 font-bold'
          type='submit'
          >
            join
          </button>
        </div>
        </form>

      </main>
    )
  }

  return (
    <main className='h-screen w-screen bg-gray-950 flex gap-3 p-4' >
      <aside className='bg-amber-100 h-full w-1/4 rounded-lg'></aside>
      <section className='bg-neutral-700 h-full rounded-lg  w-3/4'>
      <Editor height="100%" 
      defaultLanguage="javascript" 
      defaultValue="// some comment" 
      theme='vs-dark'
      onMount={handleMount}
      />
      </section>
    </main>
  )
}

export default App
