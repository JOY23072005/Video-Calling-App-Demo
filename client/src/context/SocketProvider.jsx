import React,{createContext, useMemo} from 'react'
import { useContext } from 'react'
import {io} from "socket.io-client" 

const SocketContext = createContext(null)

export const useSocket = () =>{
    const socket = useContext(SocketContext);
    return socket;
};

export default function SocketProvider(props) {

    const socket = useMemo(()=>io('https://192.168.1.3:8000', {
        secure: true,
        rejectUnauthorized: false // Only use for self-signed certs in dev
        })
    ,[])

    return (
        <SocketContext.Provider value = {socket}>
        {props.children}
        </SocketContext.Provider>
    )
};
