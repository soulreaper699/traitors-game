import { useState, useEffect } from 'react';
import { Users, Skull, ShieldAlert, CheckCircle, RefreshCw, Crown, Lock, LogOut, UserMinus, Trash2 } from 'lucide-react';

// Use relative path for production deployment where frontend is served by backend
const API_URL = import.meta.env.PROD ? '' : `http://${window.location.hostname}:3001`;

export default function AdminView({ gameState, socket }) {
  const { players = [], currentRound = '0' } = gameState;
  const [loading, setLoading] = useState(false);
  const [savedPin, setSavedPin] = useState(() => sessionStorage.getItem('traitors_admin_pin') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(sessionStorage.getItem('traitors_admin_pin')));
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Authenticate socket as admin to receive full unmasked state
  useEffect(() => {
    const currentPin = sessionStorage.getItem('traitors_admin_pin') || savedPin;
    if (currentPin && isAuthenticated && socket) {
      socket.emit('admin_auth', { pin: currentPin });
    }
  }, [isAuthenticated, savedPin, socket]);

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => {
      const pin = sessionStorage.getItem('traitors_admin_pin') || savedPin;
      if (pin && isAuthenticated) {
        socket.emit('admin_auth', { pin });
      }
    };
    socket.on('connect', handleConnect);
    return () => socket.off('connect', handleConnect);
  }, [socket, isAuthenticated, savedPin]);

  const alivePlayers = players.filter(p => p.status === 'Alive');
  const eliminatedPlayers = players.filter(p => p.status === 'Eliminated');
  const aliveTraitors = alivePlayers.filter(p => p.role === 'Traitor');
  const aliveInnocents = alivePlayers.filter(p => p.role === 'Innocent');

  // Verify PIN with server
  const handleUnlock = async (e) => {
    if (e) e.preventDefault();
    if (!enteredPin.trim()) return;
    setVerifying(true);
    setPinError('');
    try {
      const res = await fetch(`${API_URL}/api/verify-admin-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin.trim() })
      });
      if (res.ok) {
        sessionStorage.setItem('traitors_admin_pin', enteredPin.trim());
        setSavedPin(enteredPin.trim());
        setIsAuthenticated(true);
        if (socket) socket.emit('admin_auth', { pin: enteredPin.trim() });
      } else {
        setPinError('Incorrect Passcode. Access Denied.');
      }
    } catch (err) {
      setPinError('Connection error: ' + err.message);
    }
    setVerifying(false);
  };

  const handleLock = () => {
    if (socket) socket.emit('admin_deauth');
    sessionStorage.removeItem('traitors_admin_pin');
    setSavedPin('');
    setIsAuthenticated(false);
    setEnteredPin('');
  };

  // Helper for authenticated admin requests
  const adminFetch = async (endpoint, options = {}) => {
    const currentPin = sessionStorage.getItem('traitors_admin_pin') || savedPin;
    const res = await fetch(`${API_URL}/api/admin/${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentPin,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      handleLock();
      throw new Error('Session expired or invalid PIN. Please unlock again.');
    }
    return res;
  };

  const handleAction = async (endpoint) => {
    if (!window.confirm(`Are you sure you want to execute ${endpoint}?`)) return;
    setLoading(true);
    try {
      await adminFetch(endpoint, { method: 'POST' });
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
    setLoading(false);
  };

  const handleEliminate = async (id) => {
    if (!window.confirm('Eliminate this player?')) return;
    try {
      await adminFetch('eliminate', {
        method: 'POST',
        body: JSON.stringify({ id })
      });
    } catch (err) {
      alert('Elimination failed: ' + err.message);
    }
  };

  const handleDeclareWinner = async (id) => {
    if (!window.confirm('Declare this player as the WINNER? This ends the game.')) return;
    try {
      await adminFetch('set-winner', {
        method: 'POST',
        body: JSON.stringify({ id })
      });
    } catch (err) {
      alert('Declaration failed: ' + err.message);
    }
  };

  const handleToggleRole = async (id, currentRole) => {
    const newRole = currentRole === 'Traitor' ? 'Innocent' : 'Traitor';
    if (!window.confirm(`Change this player's role to ${newRole.toUpperCase()}?`)) return;
    try {
      await adminFetch('set-role', {
        method: 'POST',
        body: JSON.stringify({ id, role: newRole })
      });
    } catch (err) {
      alert('Role change failed: ' + err.message);
    }
  };

  const [selectedPlayerToRemove, setSelectedPlayerToRemove] = useState('');
  const [manualPlayerNumToRemove, setManualPlayerNumToRemove] = useState('');

  const sortedPlayers = [...players].sort((a, b) => (Number(a.name) || 0) - (Number(b.name) || 0));

  const handleRemovePlayer = async (id, playerName) => {
    if (!window.confirm(`Permanently delete Player #${playerName} from the game?\n\nThis deletes their record from the database, updates all squad counts, and resets their screen.`)) {
      return;
    }
    try {
      await adminFetch('remove-player', {
        method: 'POST',
        body: JSON.stringify({ id })
      });
      if (selectedPlayerToRemove === id) setSelectedPlayerToRemove('');
    } catch (err) {
      alert('Failed to remove player: ' + err.message);
    }
  };

  const handleQuickRemovePlayer = async () => {
    let targetId = selectedPlayerToRemove;
    let targetName = '';

    if (manualPlayerNumToRemove.trim()) {
      const match = players.find(p => String(p.name).trim() === manualPlayerNumToRemove.trim());
      if (!match) {
        return alert(`Player #${manualPlayerNumToRemove} was not found in the game.`);
      }
      targetId = match.id;
      targetName = match.name;
    } else if (targetId) {
      const match = players.find(p => p.id === targetId);
      targetName = match ? match.name : targetId;
    }

    if (!targetId) return;

    if (!window.confirm(`Permanently delete Player #${targetName} from the game?\n\nThis deletes their record from the database, updates all squad counts, and resets their screen.`)) {
      return;
    }

    try {
      await adminFetch('remove-player', {
        method: 'POST',
        body: JSON.stringify({ id: targetId })
      });
      setSelectedPlayerToRemove('');
      setManualPlayerNumToRemove('');
    } catch (err) {
      alert('Failed to remove player: ' + err.message);
    }
  };

  const handleSetPlayerGroup = async (id, groupVal) => {
    let group = groupVal;
    if (groupVal === 'custom') {
      const entered = prompt('Enter group number:');
      if (!entered) return;
      group = parseInt(entered, 10);
      if (isNaN(group) || group <= 0) return alert('Invalid group number');
    }
    try {
      await adminFetch('set-player-group', {
        method: 'POST',
        body: JSON.stringify({ id, group: group === '' ? null : group })
      });
    } catch (err) {
      alert('Failed to update group: ' + err.message);
    }
  };

  const handleAutoAssignUnassigned = async () => {
    try {
      await adminFetch('randomize-groups', {
        method: 'POST',
        body: JSON.stringify({ onlyUnassigned: true })
      });
    } catch (err) {
      alert('Failed to assign unassigned players: ' + err.message);
    }
  };

  const getPlayerGroup = (p) => {
    if (currentRound === '2') return p.round2_group;
    if (currentRound === '3') return p.round3_group;
    if (currentRound === '4') return p.round4_group;
    return p.round1_group;
  };

  // Group players for display based on current round
  let displayGroups = {};
  alivePlayers.forEach(p => {
    let g = '?';
    if (currentRound === '0' || currentRound === 'trial' || currentRound === '1') g = p.round1_group || '?';
    else if (currentRound === '2') g = p.round2_group || '?';
    else if (currentRound === '3') g = p.round3_group || '?';
    else if (currentRound === '4') g = p.round4_group || '?';
    
    if (!displayGroups[g]) displayGroups[g] = [];
    displayGroups[g].push(p);
  });

  const maxGroupNumber = Math.max(
    10,
    ...alivePlayers.map(p => Number(getPlayerGroup(p)) || 0),
    Math.ceil(alivePlayers.length / 10)
  );
  const groupOptions = Array.from({ length: Math.min(50, maxGroupNumber) }, (_, i) => i + 1);

  const getRoundTitle = (rnd) => {
    if (rnd === '0') return 'Lobby / Waiting Room';
    if (rnd === 'trial') return 'The Relic Trial (Prelude)';
    return `Round ${rnd}`;
  };

  if (!isAuthenticated) {
    return (
      <div className="center-content">
        <h1 className="title-glow" style={{ fontSize: '2.5rem' }}>RESTRICTED ACCESS</h1>
        <p className="subtitle-flicker">Chamber of the Grand Master</p>
        <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '380px', padding: '2.5rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: 'rgba(197, 160, 89, 0.1)',
              border: '1px solid var(--accent-gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.25rem'
            }}>
              <Lock size={28} color="var(--accent-gold)" />
            </div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>Master Security Passcode</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Enter the master passcode to unlock controls</p>
          </div>

          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <input
              type="password"
              maxLength={16}
              autoFocus
              className="input-field"
              placeholder="••••"
              value={enteredPin}
              onChange={(e) => {
                setPinError('');
                setEnteredPin(e.target.value);
              }}
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '8px' }}
            />
            {pinError && (
              <div style={{ color: 'var(--accent-red)', fontSize: '0.85rem', textAlign: 'center' }}>
                ⚠️ {pinError}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={verifying}>
              {verifying ? 'Verifying...' : 'Unlock Chamber'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-glow" style={{ fontSize: '2rem', marginBottom: 0 }}>Admin Dashboard</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-outline" onClick={handleLock} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>
            <Lock size={16} style={{ marginRight: '8px' }} /> Lock
          </button>
          <button className="btn btn-outline" onClick={() => handleAction('reset')}>
            <RefreshCw size={16} style={{ marginRight: '8px' }} /> Reset Game
          </button>
        </div>
      </div>

      <div className="admin-grid" style={{ marginBottom: '2rem' }}>
        <div className="glass-panel stat-card">
          <Users size={32} color="var(--text-muted)" style={{ margin: '0 auto' }} />
          <h3 style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Total Players</h3>
          <div className="stat-value">{players.length}</div>
        </div>
        <div className="glass-panel stat-card">
          <CheckCircle size={32} color="var(--accent-green)" style={{ margin: '0 auto' }} />
          <h3 style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Alive</h3>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{alivePlayers.length}</div>
        </div>
        <div className="glass-panel stat-card">
          <Skull size={32} color="var(--text-muted)" style={{ margin: '0 auto' }} />
          <h3 style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Eliminated</h3>
          <div className="stat-value">{eliminatedPlayers.length}</div>
        </div>
      </div>
      
      <div className="admin-grid" style={{ marginBottom: '2rem' }}>
        <div className="glass-panel stat-card" style={{ border: '1px solid var(--accent-red)' }}>
          <h3 style={{ color: 'var(--text-muted)' }}>Alive Traitors</h3>
          <div className="stat-value" style={{ color: 'var(--accent-red)' }}>{aliveTraitors.length}</div>
        </div>
        <div className="glass-panel stat-card" style={{ border: '1px solid var(--accent-blue)' }}>
          <h3 style={{ color: 'var(--text-muted)' }}>Alive Innocents</h3>
          <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{aliveInnocents.length}</div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Game Controls (Current State: {getRoundTitle(currentRound)})</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            className="btn btn-primary"
            style={{
              background: currentRound === 'trial' ? 'var(--accent-gold)' : 'linear-gradient(135deg, #4a0000, #1a0000)',
              color: currentRound === 'trial' ? '#000' : 'var(--fg)',
              borderColor: 'var(--accent-gold)'
            }}
            disabled={loading}
            onClick={() => handleAction('start-trial')}
          >
            📜 Start The Relic Trial (Form Groups of 10 & Secretly Assign Roles)
          </button>
          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={() => handleAction('start-round1')}
          >
            👁 Start Round 1 (Reveal Roles to Players; Same Groups Continue)
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round2')}>
            Start Round 2 (Groups of 15)
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round3')}>
            Start Round 3 (Trust or Betray Pairs)
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round4')}>
            Start Round 4 (Final 15)
          </button>
        </div>
      </div>

      {displayGroups['?'] && displayGroups['?'].length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', padding: '1rem', background: 'rgba(197, 160, 89, 0.1)', border: '1px solid var(--accent-gold)', borderRadius: '6px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ color: 'var(--accent-gold)', margin: 0, fontSize: '1rem' }}>
              ⚠️ {displayGroups['?'].length} Unassigned Player(s)
            </h3>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0', fontSize: '0.85rem' }}>
              Assign them manually below or click to auto-fill them into the round's designed squads.
            </p>
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            onClick={handleAutoAssignUnassigned}
          >
            🎲 Auto-Assign into Squads
          </button>
        </div>
      )}

      {/* SECTION: MANAGE & REMOVE PLAYERS */}
      <div className="glass-panel" style={{ marginBottom: '2rem', border: '1px solid rgba(158, 27, 27, 0.4)', background: 'linear-gradient(135deg, rgba(20, 5, 5, 0.8), rgba(10, 2, 2, 0.95))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#ff6b6b', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserMinus size={22} color="#ff6b6b" /> Remove Player from Game
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
              Permanently delete an accidental or duplicate registration. This updates squad counts immediately and resets that player's screen back to registration.
            </p>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
            {players.length} Total Registered
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={selectedPlayerToRemove}
            onChange={(e) => {
              setSelectedPlayerToRemove(e.target.value);
              setManualPlayerNumToRemove('');
            }}
            style={{
              flex: '1 1 240px',
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.7)',
              color: 'var(--fg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '4px',
              fontSize: '0.9rem'
            }}
          >
            <option value="">-- Select Player by Number --</option>
            {sortedPlayers.map(p => (
              <option key={p.id} value={p.id}>
                Player #{p.name} ({p.status} - {p.role === 'Traitor' ? 'Traitor' : 'Innocent'}{getPlayerGroup(p) ? ` - Group ${getPlayerGroup(p)}` : ''})
              </option>
            ))}
          </select>

          <input
            type="text"
            inputMode="numeric"
            placeholder="Or type Player #"
            value={manualPlayerNumToRemove}
            onChange={(e) => {
              setManualPlayerNumToRemove(e.target.value.replace(/\D/g, ''));
              setSelectedPlayerToRemove('');
            }}
            style={{
              width: '160px',
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.7)',
              color: 'var(--fg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '4px',
              fontSize: '0.9rem'
            }}
          />

          <button
            className="btn btn-danger"
            style={{ padding: '8px 18px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            disabled={!selectedPlayerToRemove && !manualPlayerNumToRemove.trim()}
            onClick={handleQuickRemovePlayer}
          >
            <Trash2 size={16} /> Delete Player
          </button>
        </div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Alive Players by Group</h2>
      <div className="admin-grid">
        {Object.keys(displayGroups)
          .sort((a, b) => {
            if (a === '?') return 1;
            if (b === '?') return -1;
            return Number(a) - Number(b);
          })
          .map(group => (
          <div key={group} className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)', flexWrap: 'wrap', gap: '6px' }}>
              <h3 style={{ margin: 0 }}>
                {group === '?' ? (currentRound === '0' ? 'Lobby / Waiting' : 'Unassigned') : `Group ${group}`} ({displayGroups[group].length} Players)
              </h3>
              {group === '?' && displayGroups['?'].length > 0 && (
                <button
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '0.75rem', color: 'var(--accent-gold)', borderColor: 'var(--accent-gold)' }}
                  onClick={handleAutoAssignUnassigned}
                >
                  🎲 Auto-Assign
                </button>
              )}
            </div>

            <div className="player-list stagger-enter">
              {displayGroups[group].map(p => (
                <div key={p.id} className="player-item">
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <span className="status-dot alive"></span>
                    <span style={{ fontWeight: 'bold' }}>{p.name}</span>
                    <span
                      className={`role-badge ${p.role === 'Traitor' ? 'traitor' : 'innocent'}`}
                      style={{ cursor: 'pointer' }}
                      title="Click to toggle role"
                      onClick={() => handleToggleRole(p.id, p.role)}
                    >
                      {p.role} ⇄
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Manual Group Selector Dropdown */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Group:</span>
                      <select
                        value={getPlayerGroup(p) || ''}
                        onChange={(e) => handleSetPlayerGroup(p.id, e.target.value)}
                        style={{
                          background: 'rgba(0,0,0,0.7)',
                          color: getPlayerGroup(p) ? 'var(--accent-gold)' : 'var(--text-muted)',
                          border: `1px solid ${getPlayerGroup(p) ? 'var(--accent-gold)' : 'rgba(255,255,255,0.2)'}`,
                          borderRadius: '4px',
                          padding: '4px 6px',
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="">Unassigned</option>
                        {groupOptions.map(num => (
                          <option key={num} value={num}>Group {num}</option>
                        ))}
                        <option value="custom">+ Custom #...</option>
                      </select>
                    </div>

                    <button
                      className="btn btn-outline"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        color: p.role === 'Traitor' ? 'var(--accent-blue)' : 'var(--accent-red)',
                        borderColor: p.role === 'Traitor' ? 'var(--accent-blue)' : 'var(--accent-red)'
                      }}
                      onClick={() => handleToggleRole(p.id, p.role)}
                    >
                      Make {p.role === 'Traitor' ? 'Innocent' : 'Traitor'}
                    </button>
                    {currentRound === '4' && (
                      <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-gold)', borderColor: 'var(--accent-gold)' }} onClick={() => handleDeclareWinner(p.id)}>
                        Winner
                      </button>
                    )}
                    <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleEliminate(p.id)}>
                      Eliminate
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ padding: '6px 10px', fontSize: '0.8rem', color: '#ff6b6b', borderColor: 'rgba(255, 107, 107, 0.4)' }}
                      title="Permanently remove player from game"
                      onClick={() => handleRemovePlayer(p.id, p.name)}
                    >
                      <Trash2 size={14} style={{ verticalAlign: 'middle' }} />
                    </button>
                  </div>
                </div>
              ))}
              {displayGroups[group].length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No players</div>}
            </div>
          </div>
        ))}
      </div>

      {eliminatedPlayers.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h2 style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Eliminated Players ({eliminatedPlayers.length})</h2>
          <div className="glass-panel" style={{ opacity: 0.8 }}>
            <div className="player-list">
              {eliminatedPlayers.map(p => (
                <div key={p.id} className="player-item" style={{ opacity: 0.65 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <span className="status-dot eliminated"></span>
                    <span style={{ textDecoration: 'line-through' }}>{p.name}</span>
                    <span className={`role-badge ${p.role === 'Traitor' ? 'traitor' : 'innocent'}`}>
                      {p.role}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-outline"
                      style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                      onClick={() => handleToggleRole(p.id, p.role)}
                    >
                      Change to {p.role === 'Traitor' ? 'Innocent' : 'Traitor'}
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ padding: '6px 10px', fontSize: '0.75rem', color: '#ff6b6b', borderColor: 'rgba(255, 107, 107, 0.4)' }}
                      title="Permanently remove player from game"
                      onClick={() => handleRemovePlayer(p.id, p.name)}
                    >
                      <Trash2 size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
