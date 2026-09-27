import { useEffect, useState, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { io } from 'socket.io-client';
import PlayerView from './components/PlayerView';
import AdminView from './components/AdminView';

// Automatically use the same host for production deployment
const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;
export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 15,
  reconnectionDelay: 1000
});

function App() {
  const [gameState, setGameState] = useState({ players: [], currentRound: '0' });
  const [mousePos, setMousePos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const appRef = useRef(null);

  useEffect(() => {
    socket.on('state_update', (data) => {
      setGameState(data);
    });
    return () => socket.off('state_update');
  }, []);

  // Smooth Lerp for mouse tracking
  const targetMousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const currentMousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  useEffect(() => {
    let animationFrameId;
    const handleMouseMove = (e) => {
      targetMousePos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);

    const updatePhysics = () => {
      currentMousePos.current.x += (targetMousePos.current.x - currentMousePos.current.x) * 0.05;
      currentMousePos.current.y += (targetMousePos.current.y - currentMousePos.current.y) * 0.05;
      setMousePos({ x: currentMousePos.current.x, y: currentMousePos.current.y });
      animationFrameId = requestAnimationFrame(updatePhysics);
    };
    updatePhysics();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // ADDON 3: Blood drip styles (static, generated once)
  const dripStyles = useMemo(() => {
    return [...Array(12)].map(() => ({
      left: `${Math.random() * 100}vw`,
      height: `${Math.random() * 150 + 50}px`,
      animationDuration: `${Math.random() * 15 + 15}s`,
      animationDelay: `-${Math.random() * 20}s`
    }));
  }, []);

  // ADDON 8: Micro-particle styles (static, generated once)
  const particleStyles = useMemo(() => {
    return [...Array(40)].map(() => ({
      left: `${Math.random() * 100}vw`,
      top: `${Math.random() * 100}vh`,
      width: `${Math.random() * 2 + 1}px`,
      height: `${Math.random() * 2 + 1}px`,
      animationDuration: `${Math.random() * 20 + 15}s`,
      animationDelay: `-${Math.random() * 20}s`,
      '--px-drift': `${(Math.random() - 0.5) * 120}px`,
      '--py-drift': `-${Math.random() * 100 + 50}vh`
    }));
  }, []);

  return (
    <div 
      className="app-container" 
      ref={appRef}
      style={{
        '--mouse-x': `${mousePos.x}px`,
        '--mouse-y': `${mousePos.y}px`
      }}
    >
      {/* ADDON 1: Blood Orbs */}
      <div className="blood-orb orb-1"></div>
      <div className="blood-orb orb-2"></div>
      <div className="blood-orb orb-3"></div>

      {/* ADDON 2: CRT Scanlines */}
      <div className="scanlines"></div>

      {/* ADDON 3: Blood Drip Streaks */}
      <div className="blood-drips">
        {dripStyles.map((style, i) => (
          <div key={i} className="drip" style={style}></div>
        ))}
      </div>

      {/* ADDON 5: Cinematic Vignette */}
      <div className="vignette"></div>

      {/* ADDON 8: Floating Micro-Particles */}
      <div className="micro-particles">
        {particleStyles.map((style, i) => (
          <div key={i} className="particle" style={style}></div>
        ))}
      </div>
      
      <Router>
        <Routes>
          <Route path="/" element={<PlayerView gameState={gameState} socket={socket} mousePos={mousePos} />} />
          <Route path="/secret-admin" element={<AdminView gameState={gameState} />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
