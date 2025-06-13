import React,{useState} from 'react'
import { useCallback } from 'react';
import { useSocket } from '../context/SocketProvider';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Lobby() {

    const [email,setEmail] = useState("");
    const [room,setRoom] = useState("");
    const socket = useSocket();
    const navigate = useNavigate();

  const handleSubmitForm = useCallback((e)=>{
    e.preventDefault();
    // console.log({
    //   email:email,room:room
    // })
    // console.log("Sending Server Data");
    socket.emit("room:join",{email:email,room:room});
    // console.log("Sent DATA");

  },[email,room,socket])

  const handleJoinRoom = useCallback((data)=>{
    const {email,room} = data;
    // console.log(email,room)
    navigate(`/room/${room}`)
  },[])

  useEffect(()=>{
    socket.on('room:join',handleJoinRoom);
    return ()=>{
      socket.off('room:join',handleJoinRoom);
    }
  },[socket])

  // console.log(socket);
  return (
    <div>
      <form onSubmit={handleSubmitForm} className='container'>
        <h1>Lobby</h1>
        <div>
          <label htmlFor='email'>Email ID </label>
          <br/>
          <input type="email" onChange={(e)=>{setEmail(e.target.value)}} value={email} id="email" />
          <br/>
        </div>
        <div>
        <label htmlFor='room'>Room</label>
        <br/>
        <input type="text" onChange={(e)=>{setRoom(e.target.value)}} value={room} id="room" />
        <br/>
        </div>
        <button type="submit" >Submit</button>
      </form>
    </div>
  )
}
