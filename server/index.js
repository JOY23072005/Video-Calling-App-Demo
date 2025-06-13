const fs = require("fs");
const https = require("https");
const { Server } = require("socket.io");

// Load SSL certs
const options = {
    key: fs.readFileSync("server.key"),
    cert: fs.readFileSync("server.cert"),
};

// Create HTTPS server
const httpsServer = https.createServer(options);

// Create Socket.IO server with CORS enabled
const io = new Server(httpsServer, {
    cors: {
        origin: "*", // Adjust in production
        methods: ["GET", "POST"]
    }
});

const emailToSocketIdMap = new Map();
const socketIdToEmailMap = new Map();

io.on("connection", (socket) => {
    console.log("Socket Connection", socket.id);

    socket.on('room:join', data => {
        const { email, room } = data;
        emailToSocketIdMap.set(email, socket.id);
        socketIdToEmailMap.set(socket.id, email);

        io.to(room).emit('user:joined', { email: email, id: socket.id });
        socket.join(room);
        io.to(socket.id).emit('room:join', data);
    });

    socket.on("user:call", ({ to, offer }) => {
        io.to(to).emit("incomming:call", { from: socket.id, offer: offer });
    });

    socket.on("call:accepted", ({ to, ans }) => {
        io.to(to).emit("call:accepted", { from: socket.id, ans: ans });
    });

    socket.on("peer:nego:needed", ({ to, offer }) => {
        io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
    });

    socket.on("peer:nego:done", ({ to, ans }) => {
        io.to(to).emit("peer:nego:final", { from: socket.id, ans });
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });
});

// Start server on 0.0.0.0 for LAN testing
httpsServer.listen(8000, "192.168.1.3", () => {
    console.log("🔐 HTTPS Server running on https://192.168.1.3:8000");
});
