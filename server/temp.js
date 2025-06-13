const {Server} = require("socket.io");
const http = require("http");
const server = http.createServer();
const io = new Server(server,{
    cors:true,
});

const emailToSocketIdMap = new Map();
const socketIdToEmailMap = new Map();

io.on("connection", (socket)=>{
    console.log("Socket Connection",socket.id);
    
    socket.on('room:join',data =>{
        // console.log(data); Entry To JOIN ROOM
        const {email,room} = data;
        emailToSocketIdMap.set(email,socket.id);
        socketIdToEmailMap.set(socket.id,email);
        
        io.to(room).emit('user:joined',{email:email,id:socket.id})
        socket.join(room);
        io.to(socket.id).emit('room:join',data);
        // console.log("Sent Client DATA");

    })

    socket.on("user:call",({to,offer})=>{
        // console.log(to,offer);
        io.to(to).emit("incomming:call",{from: socket.id,offer:offer});
        // console.log("made a call to user");
    })

    socket.on("call:accepted",({to,ans})=>{
        // console.log(ans);
        io.to(to).emit("call:accepted",{from:socket.id,ans:ans});
    })

    // Fix the typo in the negotiation event name
    socket.on("peer:nego:needed", ({to, offer}) => {
        io.to(to).emit("peer:nego:needed", {from: socket.id, offer});
    });

    socket.on("peer:nego:done", ({to, ans}) => {
        io.to(to).emit("peer:nego:final", {from: socket.id, ans});
    });
    // Add to your existing server code
    socket.on("ice-candidate", ({to, candidate}) => {
        io.to(to).emit("ice-candidate", {from: socket.id, candidate});
    });
})
// Use 0.0.0.0 to listen on all network interfaces
server.listen(8000, "192.168.1.3", () => {
    console.log("Server running on port 8000");
});