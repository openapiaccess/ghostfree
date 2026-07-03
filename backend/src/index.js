import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);

const FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS
  ? process.env.FRONTEND_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['*'];

const corsOrigin = FRONTEND_ORIGINS.includes('*') ? '*' : FRONTEND_ORIGINS;

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const participants = new Map();

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('join', ({ name }) => {
    participants.set(socket.id, { id: socket.id, name: name || `User ${socket.id.slice(0,4)}` });
    socket.broadcast.emit('user-joined', participants.get(socket.id));
    socket.emit('all-users', Array.from(participants.values()));
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat', ({ text }) => {
    const user = participants.get(socket.id);
    io.emit('chat', { name: user ? user.name : 'Unknown', text, time: Date.now() });
  });

  socket.on('disconnect', () => {
    const user = participants.get(socket.id);
    participants.delete(socket.id);
    if (user) socket.broadcast.emit('user-left', { id: socket.id, name: user.name });
    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on port ${PORT}`));
