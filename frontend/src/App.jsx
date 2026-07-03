import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || '';

export default function App() {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [myName, setMyName] = useState('');
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);

  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'], reconnection: true });
    socketRef.current = socket;

    socket.on('all-users', (list) => {
      setUsers(list);
      list.forEach((u) => callUser(u.id, socket));
    });

    socket.on('user-joined', (user) => {
      setUsers((prev) => [...prev, user]);
    });

    socket.on('user-left', (user) => {
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      const pc = peersRef.current.get(user.id);
      if (pc) { pc.close(); peersRef.current.delete(user.id); }
      const vid = document.getElementById(`video-${user.id}`);
      if (vid) vid.srcObject = null;
    });

    socket.on('offer', async ({ from, offer }) => {
      let pc = peersRef.current.get(from);
      if (!pc) pc = createPeer(from, socket, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer: pc.localDescription });
    });

    socket.on('answer', async ({ from, answer }) => {
      const pc = peersRef.current.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current.get(from);
      if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('chat', (msg) => {
      setChats((prev) => [...prev, msg]);
    });

    return () => { socket.disconnect(); };
  }, []);

  const createPeer = useCallback((userId, socket, isInitiator) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: userId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const vid = document.getElementById(`video-${userId}`);
      if (vid && e.streams[0]) vid.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        pc.restartIce?.();
      }
    };

    peersRef.current.set(userId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    }

    if (isInitiator) {
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).then(() => {
        socket.emit('offer', { to: userId, offer: pc.localDescription });
      }).catch(console.error);
    }

    return pc;
  }, []);

  const callUser = useCallback((userId, socket) => {
    createPeer(userId, socket, true);
  }, [createPeer]);

  const startMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return true;
    } catch (err) {
      alert('Camera/mic required: ' + err.message);
      return false;
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await startMedia();
    if (!ok) return;
    setMyName(name.trim());
    setJoined(true);
    socketRef.current.emit('join', { name: name.trim() });
  };

  const toggleAudio = () => {
    const next = !audioOn;
    setAudioOn(next);
    if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
  };

  const toggleVideo = () => {
    const next = !videoOn;
    setVideoOn(next);
    if (localStreamRef.current) localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = next));
  };

  const toggleScreen = async () => {
    if (screenOn) {
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(track);
      });
      track.onended = () => { setScreenOn(false); };
      setScreenOn(true);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    const input = e.target.elements.msg;
    const text = input.value.trim();
    if (!text) return;
    socketRef.current.emit('chat', { text });
    input.value = '';
  };

  const leave = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop());
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    window.location.reload();
  };

  const allUsers = [{ id: 'local', name: `${myName} (you)` }, ...users];

  if (!joined) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <h1>GhostFree</h1>
          <p>Enter your name to join the room</p>
          <form onSubmit={handleJoin}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
            <button type="submit" disabled={!name.trim()}>Join Room</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="header">
        <div className="header-title">GhostFree</div>
        <div className="header-count">{allUsers.length} online</div>
        <button className="control-btn" onClick={() => setChatOpen((o) => !o)} title="Chat">💬</button>
      </div>

      <div className="grid">
        {allUsers.map((u) => (
          <div key={u.id} className="video-card">
            {u.id === 'local' ? (
              <video ref={localVideoRef} autoPlay playsInline muted />
            ) : (
              <video id={`video-${u.id}`} autoPlay playsInline />
            )}
            <div className="video-overlay">
              <span className="name">{u.name}</span>
              {u.id === 'local' && !audioOn && <span className="muted">Muted</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="controls">
        <button className={`control-btn ${audioOn ? '' : 'off'}`} onClick={toggleAudio} title="Mic">
          {audioOn ? '🎤' : '🔇'}
        </button>
        <button className={`control-btn ${videoOn ? '' : 'off'}`} onClick={toggleVideo} title="Camera">
          {videoOn ? '📹' : '📷'}
        </button>
        <button className="control-btn" onClick={toggleScreen} title="Share Screen">🖥️</button>
        <button className="control-btn leave" onClick={leave}>📞 Leave</button>
      </div>

      <div className={`chat-panel ${chatOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <span className="chat-title">Chat</span>
          <button className="chat-close" onClick={() => setChatOpen(false)}>×</button>
        </div>
        <div className="chat-messages">
          {chats.length === 0 && <p style={{ textAlign: 'center', color: '#606080', fontSize: 13, marginTop: 20 }}>No messages yet</p>}
          {chats.map((m, i) => (
            <div key={i} className="chat-msg">
              <div className="chat-msg-author">{m.name}</div>
              <div className="chat-msg-text">{m.text}</div>
              <div className="chat-msg-time">{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          ))}
        </div>
        <form className="chat-input-area" onSubmit={sendMessage}>
          <input className="chat-input" name="msg" placeholder="Type a message..." />
          <button type="submit" className="chat-send">Send</button>
        </form>
      </div>
    </div>
  );
}
