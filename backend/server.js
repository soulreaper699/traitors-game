const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const compression = require('compression');

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/dist'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  perMessageDeflate: false
});

// Setup SQLite database
const db = new sqlite3.Database('./traitors.db', (err) => {
  if (err) console.error('Error opening database', err);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT,
    role TEXT DEFAULT 'Pending',
    status TEXT DEFAULT 'Alive',
    round1_group INTEGER,
    round2_group INTEGER,
    round3_group INTEGER,
    round4_group INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Insert default config if not exists
  db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('current_round', '0')`);
  db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('winner_id', '')`);
  db.run(`INSERT OR IGNORE INTO config (key, value) VALUES ('group_clues', '{}')`);
});

// Helper to get config
const getConfig = (key) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM config WHERE key = ?`, [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : null);
    });
  });
};

const setConfig = (key, value) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE config SET value = ? WHERE key = ?`, [value, key], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Helper to get all players
const getAllPlayers = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM players ORDER BY created_at ASC`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// ==========================================
// HIGH-CONCURRENCY IN-MEMORY STATE CACHE
// ==========================================
let stateCache = {
  players: [],
  currentRound: '0',
  winnerId: '',
  clues: {}
};

const syncStateFromDB = async () => {
  try {
    const players = await getAllPlayers();
    const currentRound = (await getConfig('current_round')) || '0';
    const winnerId = (await getConfig('winner_id')) || '';
    const cluesRaw = await getConfig('group_clues');
    let clues = {};
    try { if (cluesRaw) clues = JSON.parse(cluesRaw); } catch(e) {}
    stateCache = { players, currentRound, winnerId, clues };
    return stateCache;
  } catch (err) {
    console.error('Failed to sync state from DB:', err);
    return stateCache;
  }
};

// Initial sync from DB
setTimeout(syncStateFromDB, 300);

// ==========================================
// ADMIN SECURITY AUTHENTICATION (PASSCODE: 777@)
// ==========================================
const ADMIN_PIN = process.env.ADMIN_PIN || '777@';

// Sanitizes state so secret roles are never leaked over network packets
const getSanitizedState = (targetPlayerId) => {
  const currentRound = stateCache.currentRound || '0';
  const isConcealedRound = currentRound === '0' || currentRound === 'trial';
  
  const sanitizedPlayers = (stateCache.players || []).map(p => {
    // In Lobby (0) and The Relic Trial, all roles are concealed
    if (isConcealedRound) {
      return { ...p, role: 'Concealed' };
    }
    // In active rounds (1-4), each player only sees their own role; other roles are masked
    if (targetPlayerId && p.id === targetPlayerId) {
      return p;
    }
    return { ...p, role: 'Unknown' };
  });

  return {
    ...stateCache,
    players: sanitizedPlayers
  };
};

let broadcastTimer = null;
const broadcastState = (immediate = false) => {
  const emitUpdate = () => {
    for (const [_, s] of io.sockets.sockets) {
      if (s.isAdmin) {
        s.emit('state_update', stateCache);
      } else {
        s.emit('state_update', getSanitizedState(s.playerId));
      }
    }
    broadcastTimer = null;
  };

  if (immediate) {
    if (broadcastTimer) clearTimeout(broadcastTimer);
    emitUpdate();
  } else {
    if (!broadcastTimer) {
      broadcastTimer = setTimeout(emitUpdate, 200);
    }
  }
};

io.on('connection', (socket) => {
  // Default to sanitized state on connect
  socket.emit('state_update', getSanitizedState(socket.playerId));

  socket.on('identify', (data) => {
    if (data && data.id) {
      socket.playerId = data.id;
      socket.emit('state_update', socket.isAdmin ? stateCache : getSanitizedState(socket.playerId));
    }
  });

  socket.on('admin_auth', (data) => {
    if (data && String(data.pin).trim() === ADMIN_PIN) {
      socket.isAdmin = true;
      socket.emit('state_update', stateCache);
    }
  });

  socket.on('admin_deauth', () => {
    socket.isAdmin = false;
    socket.emit('state_update', getSanitizedState(socket.playerId));
  });

  socket.on('register', (data) => {
    const { id, name } = data;
    socket.playerId = id;
    const cleanPlayerNumber = String(name || '').replace(/\D/g, '').trim();
    if (!cleanPlayerNumber) {
      return socket.emit('error', 'Player number must be digits only');
    }

    const existing = stateCache.players.find(p => p.id === id);
    if (existing) {
      return socket.emit('state_update', socket.isAdmin ? stateCache : getSanitizedState(socket.playerId));
    }

    const newPlayer = {
      id,
      name: cleanPlayerNumber,
      role: 'Pending',
      status: 'Alive',
      round1_group: null,
      round2_group: null,
      round3_group: null,
      round4_group: null
    };

    // Immediate in-memory registration
    stateCache.players.push(newPlayer);
    
    // Batch-debounced broadcast (50 joins in 200ms = 1 broadcast)
    broadcastState(false);

    // Asynchronous database write
    db.run(`INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)`, [id, cleanPlayerNumber], (err) => {
      if (err) {
        console.error('Registration DB error:', err);
      }
    });
  });

  socket.on('disconnect', () => {});
});

// Helper to group and assign roles for Round 1 / The Relic Trial
// Strict Logic: FIRST fill Group 1 up to 10 players, THEN move to Group 2, etc.
const formRound1GroupsAndRoles = (players) => {
  const chunkSize = 10;
  
  // Check if all players already have round1_group assigned
  const allAssigned = players.length > 0 && players.every(p => p.round1_group && p.round1_group > 0);
  let groupMap = {};

  if (allAssigned) {
    // Preserve existing admin group assignments
    players.forEach(p => {
      const g = p.round1_group;
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(p);
    });
  } else {
    // Keep any already manually assigned players in their groups
    players.forEach(p => {
      if (p.round1_group && p.round1_group > 0) {
        if (!groupMap[p.round1_group]) groupMap[p.round1_group] = [];
        groupMap[p.round1_group].push(p);
      }
    });

    // Unassigned players: fill Group 1 to 10 FIRST, then Group 2 to 10, etc.
    const unassigned = players.filter(p => !p.round1_group || p.round1_group <= 0).sort(() => Math.random() - 0.5);
    unassigned.forEach(p => {
      let targetG = 1;
      while (groupMap[targetG] && groupMap[targetG].length >= chunkSize) {
        targetG++;
      }
      if (!groupMap[targetG]) groupMap[targetG] = [];
      groupMap[targetG].push(p);
    });
  }

  // Assign roles per group (keeping pre-assigned Traitors)
  const updates = [];
  const groupKeys = Object.keys(groupMap).map(Number).sort((a,b) => a - b);
  
  groupKeys.forEach(gNum => {
    const group = groupMap[gNum];
    let numTraitors = 3;
    if (group.length < chunkSize) {
      numTraitors = Math.max(1, Math.round(group.length * 0.3));
    }

    const existingTraitors = group.filter(p => p.role === 'Traitor');
    let neededTraitors = Math.max(0, numTraitors - existingTraitors.length);
    const innocentCandidates = group.filter(p => p.role !== 'Traitor').sort(() => Math.random() - 0.5);
    const newlySelectedTraitors = new Set(innocentCandidates.slice(0, neededTraitors).map(p => p.id));

    group.forEach(player => {
      let finalRole = 'Innocent';
      if (player.role === 'Traitor' || newlySelectedTraitors.has(player.id)) {
        finalRole = 'Traitor';
      }
      updates.push({ id: player.id, role: finalRole, group: gNum });
    });
  });

  return updates;
};


app.post('/api/verify-admin-pin', (req, res) => {
  const { pin } = req.body;
  if (String(pin).trim() === ADMIN_PIN) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Incorrect PIN' });
});

// Block any unauthorized requests to admin endpoints
app.use('/api/admin', (req, res, next) => {
  const pin = req.headers['x-admin-pin'] || req.query.pin;
  if (String(pin).trim() !== ADMIN_PIN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin PIN' });
  }
  next();
});

// Admin endpoint: Start The Relic Trial (forms groups of 10 & assigns roles in system secretly)
app.post('/api/admin/start-trial', async (req, res) => {
  let players = await getAllPlayers();
  const alivePlayers = players.filter(p => p.status === 'Alive');
  const updates = formRound1GroupsAndRoles(alivePlayers);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    updates.forEach(u => {
      db.run(`UPDATE players SET role = ?, round1_group = ? WHERE id = ?`, [u.role, u.group, u.id]);
    });
    db.run(`UPDATE config SET value = 'trial' WHERE key = 'current_round'`);
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
    db.run('COMMIT', async () => {
      await syncStateFromDB();
      broadcastState(true);
      res.json({ success: true, count: updates.length });
    });
  });
});

// Admin endpoint: Start Round 1 (Reveals roles; preserves the exact same groups from the trial)
app.post('/api/admin/start-round1', async (req, res) => {
  let players = await getAllPlayers();
  const alivePlayers = players.filter(p => p.status === 'Alive');
  
  // If groups and roles were already assigned from The Relic Trial, keep them!
  const alreadyGrouped = alivePlayers.length > 0 && alivePlayers.every(p => p.round1_group && p.round1_group > 0);

  if (alreadyGrouped) {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(`UPDATE config SET value = '1' WHERE key = 'current_round'`);
      db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
      db.run('COMMIT', async () => {
        await syncStateFromDB();
        broadcastState(true);
        res.json({ success: true, message: 'Advanced to Round 1 with existing groups' });
      });
    });
  } else {
    // Fallback if trial was skipped
    const updates = formRound1GroupsAndRoles(alivePlayers);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      updates.forEach(u => {
        db.run(`UPDATE players SET role = ?, round1_group = ? WHERE id = ?`, [u.role, u.group, u.id]);
      });
      db.run(`UPDATE config SET value = '1' WHERE key = 'current_round'`);
      db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
      db.run('COMMIT', async () => {
        await syncStateFromDB();
        broadcastState(true);
        res.json({ success: true });
      });
    });
  }
});

// Admin endpoint: Update clue for a group
app.post('/api/admin/set-clue', async (req, res) => {
  const { group, clue } = req.body;
  if (!stateCache.clues) stateCache.clues = {};
  stateCache.clues[group] = clue;
  await setConfig('group_clues', JSON.stringify(stateCache.clues));
  broadcastState(true);
  res.json({ success: true, clues: stateCache.clues });
});

app.post('/api/admin/start-round2', async (req, res) => {
  let players = await getAllPlayers();
  const alivePlayers = players.filter(p => p.status === 'Alive');
  const chunkSize = 15;

  const allAssigned = alivePlayers.length > 0 && alivePlayers.every(p => p.round2_group && p.round2_group > 0);
  let groupMap = {};

  if (allAssigned) {
    alivePlayers.forEach(p => {
      const g = p.round2_group;
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(p);
    });
  } else {
    alivePlayers.forEach(p => {
      if (p.round2_group && p.round2_group > 0) {
        if (!groupMap[p.round2_group]) groupMap[p.round2_group] = [];
        groupMap[p.round2_group].push(p);
      }
    });

    const unassigned = alivePlayers.filter(p => !p.round2_group || p.round2_group <= 0).sort(() => Math.random() - 0.5);
    unassigned.forEach(p => {
      let targetG = 1;
      while (groupMap[targetG] && groupMap[targetG].length >= chunkSize) {
        targetG++;
      }
      if (!groupMap[targetG]) groupMap[targetG] = [];
      groupMap[targetG].push(p);
    });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    const groupKeys = Object.keys(groupMap).map(Number).sort((a,b) => a - b);
    groupKeys.forEach(gNum => {
      const group = groupMap[gNum];
      let numTraitors = Math.max(1, Math.round(group.length * 0.3));
      const groupTraitors = group.filter(p => p.role === 'Traitor');
      let neededTraitors = Math.max(0, numTraitors - groupTraitors.length);
      const innocentCandidates = group.filter(p => p.role !== 'Traitor').sort(() => Math.random() - 0.5);
      const newlySelectedTraitors = new Set(innocentCandidates.slice(0, neededTraitors).map(p => p.id));

      group.forEach((player) => {
        let finalRole = 'Innocent';
        if (player.role === 'Traitor' || newlySelectedTraitors.has(player.id)) {
          finalRole = 'Traitor';
        }
        db.run(`UPDATE players SET role = ?, round2_group = ? WHERE id = ?`, 
          [finalRole, gNum, player.id]);
      });
    });
    db.run(`UPDATE config SET value = '2' WHERE key = 'current_round'`);
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
    db.run('COMMIT', async () => {
      await syncStateFromDB();
      broadcastState(true);
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/start-round3', async (req, res) => {
  let players = await getAllPlayers();
  const alivePlayers = players.filter(p => p.status === 'Alive');
  
  // Shuffle players for random pairs
  const shuffledPlayers = alivePlayers.sort(() => Math.random() - 0.5);
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    let groupIdx = 1;
    for (let i = 0; i < shuffledPlayers.length; i++) {
      db.run(`UPDATE players SET round3_group = ? WHERE id = ?`, [groupIdx, shuffledPlayers[i].id]);
      if (i % 2 !== 0) {
        groupIdx++;
      }
    }

    db.run(`UPDATE config SET value = '3' WHERE key = 'current_round'`);
    db.run('COMMIT', async () => {
      await syncStateFromDB();
      broadcastState(true);
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/start-round4', async (req, res) => {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`UPDATE players SET round4_group = 1 WHERE status = 'Alive'`);
    db.run(`UPDATE config SET value = '4' WHERE key = 'current_round'`);
    db.run('COMMIT', async () => {
      await syncStateFromDB();
      broadcastState(true);
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/eliminate', (req, res) => {
  const { id } = req.body;
  const p = stateCache.players.find(pl => pl.id === id);
  if (p) p.status = 'Eliminated';
  broadcastState(true);

  db.run(`UPDATE players SET status = 'Eliminated' WHERE id = ?`, [id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true });
  });
});

// Admin endpoint: Permanently remove a player from the game
app.post('/api/admin/remove-player', (req, res) => {
  let { id, playerNumber } = req.body;
  
  if (!id && playerNumber) {
    const match = stateCache.players.find(p => p.name === String(playerNumber).trim());
    if (match) id = match.id;
  }

  if (!id) {
    return res.status(400).json({ error: 'Player ID or valid number is required' });
  }

  const removedPlayer = stateCache.players.find(pl => pl.id === id);
  stateCache.players = stateCache.players.filter(pl => pl.id !== id);

  if (stateCache.winnerId === id) {
    stateCache.winnerId = '';
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
  }

  // Notify any connected socket belonging to this player that they were removed
  for (const [_, s] of io.sockets.sockets) {
    if (s.playerId === id) {
      s.playerId = null;
      s.emit('player_removed');
      s.emit('state_update', getSanitizedState(null));
    }
  }

  broadcastState(true);

  db.run(`DELETE FROM players WHERE id = ?`, [id], (err) => {
    if (err) {
      console.error('Delete player error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, removed: removedPlayer });
  });
});

app.post('/api/admin/set-role', (req, res) => {
  const { id, role } = req.body;
  if (!['Traitor', 'Innocent'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const p = stateCache.players.find(pl => pl.id === id);
  if (p) p.role = role;
  broadcastState(true);

  db.run(`UPDATE players SET role = ? WHERE id = ?`, [role, id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true });
  });
});

// Admin endpoint: Manually assign a player to any group
app.post('/api/admin/set-player-group', async (req, res) => {
  const { id, group } = req.body;
  const currentRound = stateCache.currentRound || '0';
  
  let col = 'round1_group';
  if (currentRound === '2') col = 'round2_group';
  else if (currentRound === '3') col = 'round3_group';
  else if (currentRound === '4') col = 'round4_group';

  const groupNum = parseInt(group, 10);
  const finalGroup = isNaN(groupNum) || groupNum <= 0 ? null : groupNum;

  const p = stateCache.players.find(pl => pl.id === id);
  if (p) p[col] = finalGroup;
  broadcastState(true);

  db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [finalGroup, id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true, group: finalGroup });
  });
});

// Admin endpoint: Auto-assign / randomize players into groups based on the round's design
app.post('/api/admin/randomize-groups', async (req, res) => {
  const { onlyUnassigned = false } = req.body;
  const currentRound = stateCache.currentRound || '0';
  
  let col = 'round1_group';
  let designedSize = 10;
  if (currentRound === '2') { col = 'round2_group'; designedSize = 15; }
  else if (currentRound === '3') { col = 'round3_group'; designedSize = 2; }
  else if (currentRound === '4') { col = 'round4_group'; designedSize = 15; }

  let alivePlayers = stateCache.players.filter(p => p.status === 'Alive');
  
  if (onlyUnassigned) {
    const unassigned = alivePlayers.filter(p => !p[col] || p[col] <= 0);
    if (unassigned.length === 0) {
      return res.json({ success: true, message: 'No unassigned players' });
    }

    const groupCounts = {};
    alivePlayers.forEach(p => {
      const g = p[col];
      if (g && g > 0) groupCounts[g] = (groupCounts[g] || 0) + 1;
    });

    const shuffled = unassigned.sort(() => Math.random() - 0.5);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      shuffled.forEach((p) => {
        let targetGroup = 1;
        while ((groupCounts[targetGroup] || 0) >= designedSize) {
          targetGroup++;
        }
        groupCounts[targetGroup] = (groupCounts[targetGroup] || 0) + 1;
        p[col] = targetGroup;
        db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [targetGroup, p.id]);
      });
      db.run('COMMIT', async () => {
        await syncStateFromDB();
        broadcastState(true);
        res.json({ success: true, assignedCount: shuffled.length });
      });
    });
  } else {
    const shuffled = alivePlayers.sort(() => Math.random() - 0.5);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      shuffled.forEach((p, idx) => {
        const gNum = 1 + Math.floor(idx / designedSize);
        p[col] = gNum;
        db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [gNum, p.id]);
      });
      db.run('COMMIT', async () => {
        await syncStateFromDB();
        broadcastState(true);
        res.json({ success: true, assignedCount: shuffled.length });
      });
    });
  }
});

app.post('/api/admin/set-winner', (req, res) => {
  const { id } = req.body;
  stateCache.winnerId = id;
  broadcastState(true);
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`UPDATE config SET value = ? WHERE key = 'winner_id'`, [id]);
    db.run('COMMIT', () => {
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/reset', (req, res) => {
  stateCache = {
    players: [],
    currentRound: '0',
    winnerId: '',
    clues: {}
  };
  broadcastState(true);
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`DELETE FROM players`);
    db.run(`UPDATE config SET value = '0' WHERE key = 'current_round'`);
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
    db.run('COMMIT', () => {
      res.json({ success: true });
    });
  });
});

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
