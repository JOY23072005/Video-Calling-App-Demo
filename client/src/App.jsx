import { useState } from 'react'
import {Routes,Route} from "react-router-dom"
import Lobby from './screens/lobby'
import Room from './screens/Room'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className='App'>
      <Routes>
        <Route index element={<Lobby/>}/>
        <Route path="/room/:roomId" element={<Room/>}/>
        <Route path="*" element={<h1>404:Not Found</h1>}/>
      </Routes>
    </div>
  )
}

export default App
