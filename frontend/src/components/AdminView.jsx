import { useState } from 'react';
import { Users, Skull, ShieldAlert, CheckCircle, RefreshCw, Crown } from 'lucide-react';

// Use relative path for production deployment where frontend is served by backend
const API_URL = import.meta.env.PROD ? '' : `http://${window.location.hostname}:3001`;

export default function AdminView({ gameState }) {
  const { players = [], currentRound = '0' } = gameState;
  const [loading, setLoading] = useState(false);

  const alivePlayers = players.filter(p => p.status === 'Alive');
  const eliminatedPlayers = players.filter(p => p.status === 'Eliminated');
  const aliveTraitors = alivePlayers.filter(p => p.role === 'Traitor');
  const aliveInnocents = alivePlayers.filter(p => p.role === 'Innocent');

  const handleAction = async (endpoint) => {
    if (!window.confirm(`Are you sure you want to execute ${endpoint}?`)) return;
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/admin/${endpoint}`, { method: 'POST' });
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
    setLoading(false);
  };

  const handleEliminate = async (id) => {
    if (!window.confirm('Eliminate this player?')) return;
    try {
      await fetch(`${API_URL}/api/admin/eliminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch (err) {
      alert('Elimination failed: ' + err.message);
    }
  };

  const handleDeclareWinner = async (id) => {
    if (!window.confirm('Declare this player as the WINNER? This ends the game.')) return;
    try {
      await fetch(`${API_URL}/api/admin/set-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`${API_URL}/api/admin/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, role: newRole })
      });
    } catch (err) {
      alert('Role change failed: ' + err.message);
    }
  };

  const [customGroupSize, setCustomGroupSize] = useState(2);

  const handleSetPlayerGroup = async (id, groupVal) => {
    let group = groupVal;
    if (groupVal === 'custom') {
      const entered = prompt('Enter group number:');
      if (!entered) return;
      group = parseInt(entered, 10);
      if (isNaN(group) || group <= 0) return alert('Invalid group number');
    }
    try {
      await fetch(`${API_URL}/api/admin/set-player-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, group: group === '' ? null : group })
      });
    } catch (err) {
      alert('Failed to update group: ' + err.message);
    }
  };

  const handleRandomizeGroups = async (onlyUnassigned = false) => {
    const size = parseInt(customGroupSize, 10) || 2;
    if (!window.confirm(onlyUnassigned 
      ? `Auto-assign all unassigned players into groups of ${size}?`
      : `Re-shuffle ALL alive players into groups of ${size}?`)) return;
    try {
      await fetch(`${API_URL}/api/admin/randomize-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupSize: size, onlyUnassigned })
      });
    } catch (err) {
      alert('Failed to randomize groups: ' + err.message);
    }
  };

  const getPlayerGroup = (p) => {
    if (currentRound === '2') return p.round2_group;
    if (currentRound === '3') return p.round3_group;
    if (currentRound === '4') return p.round4_group;
    return p.round1_group;
  };

  const handleSaveClue = async (group, text) => {
    try {
      await fetch(`${API_URL}/api/admin/set-clue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, clue: text })
      });
    } catch (err) {
      alert('Failed to save clue: ' + err.message);
    }
  };

  const defaultClues = {
    1: "Where shadows gather near the highest wall, search beneath the cold stone to unearth your relic piece.",
    2: "Follow the silent corridor toward the mirrored hall. Look where stillness meets forgotten wood.",
    3: "In the chamber of silent tomes, seek beneath the lowermost shelf to recover your squad's crest.",
    4: "Near the threshold where dusk breaks, examine the base of the sentinel pillar.",
    5: "Where two secret pathways converge, the relic shard rests hidden in plain sight."
  };

  // Group players for display based on current round
  let displayGroups = {};
  alivePlayers.forEach(p => {
    let g = '?';
    if (currentRound === 'trial' || currentRound === '1') g = p.round1_group || '?';
    else if (currentRound === '2') g = p.round2_group || '?';
    else if (currentRound === '3') g = p.round3_group || '?';
    else if (currentRound === '4') g = p.round4_group || '?';
    
    if (!displayGroups[g]) displayGroups[g] = [];
    displayGroups[g].push(p);
  });

  const getRoundTitle = (rnd) => {
    if (rnd === '0') return 'Lobby / Waiting Room';
    if (rnd === 'trial') return 'The Relic Trial (Prelude)';
    return `Round ${rnd}`;
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-glow" style={{ fontSize: '2rem', marginBottom: 0 }}>Admin Dashboard</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
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

      {/* GROUP & SQUAD MANAGER TOOLBAR */}
      <div className="glass-panel" style={{ marginBottom: '2rem', border: '1px solid rgba(197, 160, 89, 0.35)' }}>
        <h3 style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🎲 Group & Squad Setup
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Distribute players into groups automatically (e.g. groups of 2, 4, 10), or assign individual players to any group below:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--fg)' }}>Group Size:</span>
            <input
              type="number"
              min="1"
              max="20"
              value={customGroupSize}
              onChange={(e) => setCustomGroupSize(e.target.value)}
              style={{
                width: '60px',
                padding: '8px',
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid var(--accent-gold)',
                color: '#fff',
                borderRadius: '4px',
                textAlign: 'center',
                fontSize: '1rem'
              }}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => handleRandomizeGroups(false)}
          >
            🎲 Randomize ALL into Groups of {customGroupSize}
          </button>
          {displayGroups['?'] && displayGroups['?'].length > 0 && (
            <button
              className="btn btn-outline"
              style={{ padding: '8px 14px', fontSize: '0.85rem', color: 'var(--accent-gold)', borderColor: 'var(--accent-gold)' }}
              onClick={() => handleRandomizeGroups(true)}
            >
              ➕ Auto-Assign {displayGroups['?'].length} Unassigned Player(s)
            </button>
          )}
        </div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Alive Players by Group</h2>
      <div className="admin-grid">
        {Object.keys(displayGroups).sort((a,b) => a.localeCompare(b)).map(group => (
          <div key={group} className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)', flexWrap: 'wrap', gap: '6px' }}>
              <h3 style={{ margin: 0 }}>
                {group === '?' ? (currentRound === '0' ? 'Lobby / Waiting' : 'Unassigned') : `Group ${group}`} ({displayGroups[group].length} Players)
              </h3>
              {group === '?' && displayGroups['?'].length > 0 && (
                <button
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '0.75rem', color: 'var(--accent-gold)', borderColor: 'var(--accent-gold)' }}
                  onClick={() => handleRandomizeGroups(true)}
                >
                  🎲 Auto-Assign into Groups
                </button>
              )}
            </div>

            {group !== '?' && (
              <div style={{ margin: '0.5rem 0 1rem 0', padding: '0.6rem 0.8rem', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid rgba(197, 160, 89, 0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--accent-gold)' }}>
                    📜 Group {group} Clue
                  </span>
                  <button
                    className="btn btn-outline"
                    style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                    onClick={() => {
                      const cur = (gameState.clues && gameState.clues[group]) || defaultClues[group] || '';
                      const newClue = prompt(`Enter clue for Group ${group}:`, cur);
                      if (newClue !== null) handleSaveClue(group, newClue);
                    }}
                  >
                    Edit Clue
                  </button>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  "{(gameState.clues && gameState.clues[group]) || defaultClues[group] || 'Search and retrieve your relic piece.'}"
                </div>
              </div>
            )}
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
                        <option value="1">Group 1</option>
                        <option value="2">Group 2</option>
                        <option value="3">Group 3</option>
                        <option value="4">Group 4</option>
                        <option value="5">Group 5</option>
                        <option value="6">Group 6</option>
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
