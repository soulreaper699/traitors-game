import { useEffect, useState, useRef, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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

  // Anti-Inspect / Anti-Cheat Keyboard & Context Menu Blocker
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    const handleKeyDown = (e) => {
      // Block F12
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        return false;
      }
      // Block Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Inspect / Console)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
        e.preventDefault();
        return false;
      }
      // Block Ctrl+U (View Source) & Ctrl+S (Save)
      if ((e.ctrlKey || e.metaKey) && ['U', 'u', 'S', 's'].includes(e.key)) {
        e.preventDefault();
        return false;
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Smooth Lerp for mouse tracking
  const targetMousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const currentMousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  useEffect(() => {
    // Skip on touch/mobile devices to save battery & CPU for all players
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

    let animationFrameId;
    let isMoving = false;
    const handleMouseMove = (e) => {
      targetMousePos.current = { x: e.clientX, y: e.clientY };
      if (!isMoving) {
        isMoving = true;
        updatePhysics();
      }
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    const updatePhysics = () => {
      const dx = targetMousePos.current.x - currentMousePos.current.x;
      const dy = targetMousePos.current.y - currentMousePos.current.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        currentMousePos.current.x += dx * 0.08;
        currentMousePos.current.y += dy * 0.08;
        setMousePos({ x: currentMousePos.current.x, y: currentMousePos.current.y });
        animationFrameId = requestAnimationFrame(updatePhysics);
      } else {
        isMoving = false;
      }
    };

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // ADDON 3: Blood drip styles (static, lightweight)
  const dripStyles = useMemo(() => {
    return [...Array(8)].map(() => ({
      left: `${Math.random() * 100}vw`,
      height: `${Math.random() * 120 + 40}px`,
      animationDuration: `${Math.random() * 15 + 15}s`,
      animationDelay: `-${Math.random() * 20}s`
    }));
  }, []);

  // ADDON 8: Micro-particle styles (optimized for 64 simultaneous devices)
  const particleStyles = useMemo(() => {
    return [...Array(15)].map(() => ({
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
          <Route path="/cloak-chamber-7788" element={<AdminView gameState={gameState} socket={socket} />} />
          <Route path="/secret-admin" element={<Navigate to="/" replace />} />
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
