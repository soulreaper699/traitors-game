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

  // Group players for display based on current round
  let displayGroups = {};
  alivePlayers.forEach(p => {
    let g = '?';
    if (currentRound === '1') g = p.round1_group || '?';
    else if (currentRound === '2') g = p.round2_group || '?';
    else if (currentRound === '3') g = p.round3_group || '?';
    else if (currentRound === '4') g = p.round4_group || '?';
    
    if (!displayGroups[g]) displayGroups[g] = [];
    displayGroups[g].push(p);
  });

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
        <h2 style={{ marginBottom: '1rem' }}>Game Controls (Current Round: {currentRound})</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round1')}>
            Start Round 1 (Groups of 10)
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round2')}>
            Start Round 2 (Groups of 15)
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round3')}>
            Start Round 3
          </button>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleAction('start-round4')}>
            Start Round 4 (Final 15)
          </button>
        </div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Alive Players by Group</h2>
      <div className="admin-grid">
        {Object.keys(displayGroups).sort((a,b) => a.localeCompare(b)).map(group => (
          <div key={group} className="glass-panel">
            <h3 style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)' }}>
              Group {group} ({displayGroups[group].length} Players)
            </h3>
            <div className="player-list stagger-enter">
              {displayGroups[group].map(p => (
                <div key={p.id} className="player-item">
                  <div>
                    <span className="status-dot alive"></span>
                    <span style={{ fontWeight: 'bold' }}>{p.name}</span>
                    <span className={`role-badge ${p.role === 'Traitor' ? 'traitor' : 'innocent'}`} style={{ marginLeft: '8px' }}>
                      {p.role}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {currentRound === '4' && (
                      <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)' }} onClick={() => handleDeclareWinner(p.id)}>
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
      
    </div>
  );
}
