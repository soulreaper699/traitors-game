import { useState, useEffect, useMemo } from 'react';
import { UserPlus, ShieldAlert, CheckCircle, Skull, Crown, Eye } from 'lucide-react';

export default function PlayerView({ gameState, socket, mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 } }) {
  const [name, setName] = useState('');
  const [showFlash, setShowFlash] = useState(false);
  const [prevRound, setPrevRound] = useState(null);
  const [playerId, setPlayerId] = useState(() => {
    try { return localStorage.getItem('traitor_player_id'); }
    catch (e) { return null; }
  });

  // 3D tilt based on mouse position
  const tiltX = (window.innerHeight / 2 - mousePos.y) / 40;
  const tiltY = (mousePos.x - window.innerWidth / 2) / 40;
  const tiltStyle = {
    transform: `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.02, 1.02, 1.02)`
  };

  useEffect(() => {
    if (!playerId) {
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36));
      try { localStorage.setItem('traitor_player_id', newId); }
      catch (e) { console.warn('localStorage blocked by Safari/iOS privacy'); }
      setPlayerId(newId);
    }
  }, [playerId]);

  // ADDON 16: Round transition flash
  const round = parseInt(gameState.currentRound || '0', 10);
  useEffect(() => {
    if (prevRound !== null && prevRound !== round) {
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 600);
    }
    setPrevRound(round);
  }, [round]);

  // ADDON 13: Victory sparkle styles (generated once)
  const sparkleStyles = useMemo(() => {
    return [...Array(20)].map(() => ({
      left: `${Math.random() * 100}%`,
      animationDuration: `${Math.random() * 3 + 2}s`,
      animationDelay: `-${Math.random() * 3}s`
    }));
  }, []);

  const handleRegister = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    socket.emit('register', { id: playerId, name });
  };

  const myPlayer = gameState.players.find(p => p.id === playerId);

  // ====== JOIN SCREEN ======
  if (!myPlayer) {
    return (
      <div className="center-content">
        {showFlash && <div className="round-flash"></div>}
        <h1 className="title-glow">THE TRAITORS</h1>
        <p className="subtitle-flicker">Trust No One</p>
        <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', ...tiltStyle }}>
          <h2 style={{ marginBottom: '1rem' }}>Join the Game</h2>
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Enter your name" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary">
              <UserPlus size={18}/> Register
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ====== WAITING ROOM (ADDON 18: premium spinner) ======
  if (round === 0) {
    return (
      <div className="center-content animate-fade-in">
        {showFlash && <div className="round-flash"></div>}
        <h1 className="title-glow" style={{ fontSize: '3rem' }}>Welcome, {myPlayer.name}</h1>
        <p className="subtitle-flicker">The game is about to begin</p>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', ...tiltStyle }}>
          {/* ADDON 18: Premium triple-ring waiting spinner */}
          <div className="waiting-spinner">
            <div className="waiting-spinner-inner"></div>
          </div>
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '1rem', letterSpacing: '1px' }}>Waiting for the host to start...</p>
        </div>
      </div>
    );
  }

  const isEliminated = myPlayer.status === 'Eliminated';
  const roleClass = myPlayer.role === 'Traitor' ? 'role-traitor' : 'role-innocent';
  const winnerId = gameState.winnerId;

  // ====== GAME OVER (ADDON 13 sparkles, ADDON 30 crown) ======
  if (winnerId) {
    const winner = gameState.players.find(p => p.id === winnerId);
    const amIWinner = playerId === winnerId;
    return (
      <div className="center-content page-transition-enter">
        {showFlash && <div className="round-flash"></div>}
        <h1 className="title-glow" style={{ color: 'var(--accent-gold)' }}>GAME OVER</h1>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', textAlign: 'center', position: 'relative', overflow: 'hidden', ...tiltStyle }}>
          {/* ADDON 13: Victory sparkles */}
          <div className="victory-sparkles">
            {sparkleStyles.map((style, i) => (
              <div key={i} className="sparkle" style={style}></div>
            ))}
          </div>
          
          {amIWinner ? (
            <div style={{ position: 'relative', zIndex: 1 }}>
              {/* ADDON 30: Bouncing crown */}
              <span className="crown-icon" style={{ fontSize: '4rem' }}>👑</span>
              <h1 className="winner-glow" style={{ fontSize: '3rem', fontFamily: 'Cinzel', color: 'var(--accent-gold)', marginTop: '0.5rem' }}>YOU WIN!</h1>
              <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>You have outlasted everyone and claimed victory!</p>
            </div>
          ) : (
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h2 style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>The Winner is...</h2>
              <span className="crown-icon" style={{ fontSize: '2.5rem' }}>👑</span>
              <h1 className="winner-glow" style={{ fontSize: '3rem', fontFamily: 'Cinzel', color: 'var(--accent-gold)' }}>{winner?.name || 'Unknown'}</h1>
              <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Better luck next time.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  let currentGroup = null;
  let groupMembers = [];
  if (round === 1) {
    currentGroup = myPlayer.round1_group;
    groupMembers = gameState.players.filter(p => p.round1_group === currentGroup && p.status === 'Alive');
  } else if (round === 2) {
    currentGroup = myPlayer.round2_group;
    groupMembers = gameState.players.filter(p => p.round2_group === currentGroup && p.status === 'Alive');
  } else if (round === 3) {
    currentGroup = myPlayer.round3_group;
    groupMembers = gameState.players.filter(p => p.round3_group === currentGroup && p.status === 'Alive');
  } else if (round === 4) {
    currentGroup = myPlayer.round4_group;
    groupMembers = gameState.players.filter(p => p.round4_group === currentGroup && p.status === 'Alive');
  }

  // ====== ACTIVE GAMEPLAY ======
  return (
    <div className="center-content page-transition-enter">
      {/* ADDON 16: Round transition flash */}
      {showFlash && <div className="round-flash"></div>}

      {/* ADDON 25: Live indicator */}
      <div className="live-indicator">
        <span className="live-dot"></span>
        LIVE — Round {round}
      </div>

      {/* ADDON 26: Gradient round header */}
      <h2 className="round-header">Round {round}</h2>
      
      {isEliminated ? (
        // ADDON 12 + ADDON 20: Eliminated card with skull watermark and blood splatter
        <div className="glass-panel eliminated-card" style={{ border: '1px solid var(--accent-red)', maxWidth: '500px', position: 'relative', overflow: 'hidden', ...tiltStyle }}>
          <div className="blood-splatter"></div>
          <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
            <Skull size={64} color="var(--accent-red)" style={{ margin: '0 auto 1rem', display: 'block', opacity: 0.8 }} />
            <h1 className="title-glow" style={{ color: 'var(--accent-red)', WebkitTextFillColor: 'var(--accent-red)', marginBottom: '0.5rem', fontSize: '3rem' }}>ELIMINATED</h1>
            <p style={{ color: 'var(--text-muted)' }}>You have been banished from the game.</p>
          </div>
        </div>
      ) : (
        <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', ...tiltStyle }}>
          {round === 3 && (
            <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', border: '1px solid rgba(61, 90, 128, 0.2)' }}>
              <h2 style={{ color: 'var(--accent-blue)', marginBottom: '0.5rem', fontSize: '1.3rem' }}>
                <Eye size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Trust or Betray
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Pair up with another player. You both must secretly choose to Trust or Betray.</p>
            </div>
          )}
          {round === 4 && (
            <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(158, 27, 27, 0.05)', borderRadius: '4px', border: '1px solid rgba(158, 27, 27, 0.2)' }}>
              <h2 style={{ color: 'var(--accent-red)', marginBottom: '0.5rem', fontSize: '1.3rem' }}>
                <Skull size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                The Final Imposter
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>The final showdown. Can you find the last remaining Traitors?</p>
            </div>
          )}

          <h1 className="title-glow" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Group {currentGroup || '?'}</h1>
          
          {/* ADDON 28: Animated divider */}
          <hr className="animated-divider" />
          
          <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>Your Group Members:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {groupMembers.map(p => (
                <span key={p.id} style={{
                  padding: '6px 14px',
                  background: p.id === playerId ? 'rgba(197, 160, 89, 0.15)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${p.id === playerId ? 'var(--accent-gold)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '20px',
                  fontSize: '0.9rem',
                  color: p.id === playerId ? 'var(--accent-gold)' : 'var(--fg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {p.id === playerId ? '(You) ' + p.name : p.name}
                  {p.id === playerId && <span className="status-dot alive" style={{ marginRight: 0, width: '6px', height: '6px' }}></span>}
                </span>
              ))}
            </div>
          </div>

          {/* ADDON 19: Role card flip reveal + ADDON 15: breathing pulse */}
          {!(round >= 3) && (
            <div className="role-card-flip">
              <div className="role-card-inner">
                <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '2px', fontSize: '0.8rem' }}>Your Secret Role</p>
                <div className={`role-reveal ${roleClass}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  {myPlayer.role === 'Traitor' ? <ShieldAlert size={64} /> : <CheckCircle size={64} />}
                  <h1 style={{ fontSize: '3rem', fontFamily: 'Cinzel' }}>{myPlayer.role}</h1>
                  {/* ADDON 29: Role badge */}
                  <span className={`role-badge ${myPlayer.role.toLowerCase()}`}>{myPlayer.role}</span>
                </div>
              </div>
            </div>
          )}

          {myPlayer.role === 'Traitor' && round === 1 && (
             <p style={{ marginTop: '1.5rem', color: 'var(--accent-red)', fontWeight: 'bold', animation: 'traitorPulse 3s infinite' }}>⚔ You have 2 votes this round. Murder with caution.</p>
          )}
          {myPlayer.role === 'Traitor' && round === 2 && (
             <p style={{ marginTop: '1.5rem', color: 'var(--accent-red)', fontWeight: 'bold', animation: 'traitorPulse 3s infinite' }}>🗡 You have 1 vote to banish. Choose wisely.</p>
          )}
        </div>
      )}
    </div>
  );
}
