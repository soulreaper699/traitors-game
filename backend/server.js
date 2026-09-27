const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/dist'), {
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
  cors: { origin: '*' }
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

const broadcastState = async () => {
  try {
    const players = await getAllPlayers();
    const currentRound = await getConfig('current_round');
    const winnerId = await getConfig('winner_id');
    const cluesRaw = await getConfig('group_clues');
    let clues = {};
    try { if (cluesRaw) clues = JSON.parse(cluesRaw); } catch(e) {}
    io.emit('state_update', { players, currentRound, winnerId, clues });
  } catch (err) {
    console.error('Failed to broadcast state', err);
  }
};

io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);

  // Send initial state to the connected client
  const players = await getAllPlayers();
  const currentRound = await getConfig('current_round');
  const winnerId = await getConfig('winner_id');
  const cluesRaw = await getConfig('group_clues');
  let clues = {};
  try { if (cluesRaw) clues = JSON.parse(cluesRaw); } catch(e) {}
  socket.emit('state_update', { players, currentRound, winnerId, clues });

  socket.on('register', (data) => {
    const { id, name } = data;
    db.run(`INSERT INTO players (id, name) VALUES (?, ?)`, [id, name], (err) => {
      if (err) {
        console.error('Registration error', err);
        socket.emit('error', 'Could not register');
      } else {
        broadcastState();
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Helper to group and assign roles for Round 1 / The Relic Trial
const formRound1GroupsAndRoles = (players) => {
  const preTraitors = players.filter(p => p.role === 'Traitor').sort(() => Math.random() - 0.5);
  const innocents = players.filter(p => p.role !== 'Traitor').sort(() => Math.random() - 0.5);

  const chunkSize = 10;
  const numGroups = Math.max(1, Math.ceil(players.length / chunkSize));
  const groups = Array.from({ length: numGroups }, () => []);

  // Distribute pre-assigned traitors evenly across groups
  preTraitors.forEach((traitor, idx) => {
    groups[idx % numGroups].push(traitor);
  });

  // Distribute remaining players across groups until full
  innocents.forEach((player) => {
    const smallestGroup = groups.reduce((min, g) => g.length < min.length ? g : min, groups[0]);
    smallestGroup.push(player);
  });

  // Shuffle within each group so positions are natural
  groups.forEach(g => g.sort(() => Math.random() - 0.5));

  const updates = [];
  groups.forEach((group, groupIdx) => {
    let numTraitors = 3;
    if (group.length < 10) numTraitors = Math.max(1, Math.round(group.length * 0.3));

    const existingTraitors = group.filter(p => p.role === 'Traitor');
    let neededTraitors = Math.max(0, numTraitors - existingTraitors.length);
    const innocentCandidates = group.filter(p => p.role !== 'Traitor');
    const newlySelectedTraitors = new Set(innocentCandidates.slice(0, neededTraitors).map(p => p.id));

    group.forEach((player) => {
      let finalRole = 'Innocent';
      if (player.role === 'Traitor' || newlySelectedTraitors.has(player.id)) {
        finalRole = 'Traitor';
      }
      updates.push({ id: player.id, role: finalRole, group: groupIdx + 1 });
    });
  });

  return updates;
};

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
    db.run('COMMIT', () => {
      broadcastState();
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
      db.run('COMMIT', () => {
        broadcastState();
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
      db.run('COMMIT', () => {
        broadcastState();
        res.json({ success: true });
      });
    });
  }
});

// Admin endpoint: Update clue for a group
app.post('/api/admin/set-clue', async (req, res) => {
  const { group, clue } = req.body;
  const currentCluesRaw = await getConfig('group_clues');
  let clues = {};
  try { if (currentCluesRaw) clues = JSON.parse(currentCluesRaw); } catch(e) {}
  clues[group] = clue;
  await setConfig('group_clues', JSON.stringify(clues));
  broadcastState();
  res.json({ success: true, clues });
});

app.post('/api/admin/start-round2', async (req, res) => {
  let players = await getAllPlayers();
  const alivePlayers = players.filter(p => p.status === 'Alive');
  
  // Separate existing traitors and innocents
  const existingTraitors = alivePlayers.filter(p => p.role === 'Traitor').sort(() => Math.random() - 0.5);
  const innocents = alivePlayers.filter(p => p.role !== 'Traitor').sort(() => Math.random() - 0.5);

  const chunkSize = 15;
  const numGroups = Math.max(1, Math.ceil(alivePlayers.length / chunkSize));
  const groups = Array.from({ length: numGroups }, () => []);

  // Distribute existing traitors across groups
  existingTraitors.forEach((traitor, idx) => {
    groups[idx % numGroups].push(traitor);
  });

  // Distribute remaining alive innocents
  innocents.forEach((player) => {
    const smallestGroup = groups.reduce((min, g) => g.length < min.length ? g : min, groups[0]);
    smallestGroup.push(player);
  });

  groups.forEach(g => g.sort(() => Math.random() - 0.5));

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    groups.forEach((group, groupIdx) => {
      let numTraitors = Math.max(1, Math.round(group.length * 0.3));
      const groupTraitors = group.filter(p => p.role === 'Traitor');
      let neededTraitors = Math.max(0, numTraitors - groupTraitors.length);
      const innocentCandidates = group.filter(p => p.role !== 'Traitor');
      const newlySelectedTraitors = new Set(innocentCandidates.slice(0, neededTraitors).map(p => p.id));

      group.forEach((player) => {
        let finalRole = 'Innocent';
        if (player.role === 'Traitor' || newlySelectedTraitors.has(player.id)) {
          finalRole = 'Traitor';
        }
        db.run(`UPDATE players SET role = ?, round2_group = ? WHERE id = ?`, 
          [finalRole, groupIdx + 1, player.id]);
      });
    });
    db.run(`UPDATE config SET value = '2' WHERE key = 'current_round'`);
    db.run('COMMIT', () => {
      broadcastState();
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
    db.run('COMMIT', () => {
      broadcastState();
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/start-round4', async (req, res) => {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`UPDATE players SET round4_group = 1 WHERE status = 'Alive'`);
    db.run(`UPDATE config SET value = '4' WHERE key = 'current_round'`);
    db.run('COMMIT', () => {
      broadcastState();
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/eliminate', (req, res) => {
  const { id } = req.body;
  db.run(`UPDATE players SET status = 'Eliminated' WHERE id = ?`, [id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else {
      broadcastState();
      res.json({ success: true });
    }
  });
});

app.post('/api/admin/set-role', (req, res) => {
  const { id, role } = req.body;
  if (!['Traitor', 'Innocent'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  db.run(`UPDATE players SET role = ? WHERE id = ?`, [role, id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else {
      broadcastState();
      res.json({ success: true });
    }
  });
});

// Admin endpoint: Manually assign a player to any group
app.post('/api/admin/set-player-group', async (req, res) => {
  const { id, group } = req.body;
  const currentRound = (await getConfig('current_round')) || '0';
  
  let col = 'round1_group';
  if (currentRound === '2') col = 'round2_group';
  else if (currentRound === '3') col = 'round3_group';
  else if (currentRound === '4') col = 'round4_group';
  else col = 'round1_group';

  const groupNum = parseInt(group, 10);
  const finalGroup = isNaN(groupNum) || groupNum <= 0 ? null : groupNum;

  db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [finalGroup, id], (err) => {
    if (err) res.status(500).json({ error: err.message });
    else {
      broadcastState();
      res.json({ success: true, group: finalGroup });
    }
  });
});

// Admin endpoint: Auto-assign / randomize players into groups based on the round's design
app.post('/api/admin/randomize-groups', async (req, res) => {
  const { onlyUnassigned = false } = req.body;
  const currentRound = (await getConfig('current_round')) || '0';
  
  let col = 'round1_group';
  let designedSize = 10;
  if (currentRound === '2') { col = 'round2_group'; designedSize = 15; }
  else if (currentRound === '3') { col = 'round3_group'; designedSize = 2; }
  else if (currentRound === '4') { col = 'round4_group'; designedSize = 15; }

  let players = await getAllPlayers();
  let alivePlayers = players.filter(p => p.status === 'Alive');
  
  if (onlyUnassigned) {
    const unassigned = alivePlayers.filter(p => !p[col] || p[col] <= 0);
    if (unassigned.length === 0) {
      return res.json({ success: true, message: 'No unassigned players' });
    }

    // Count how many players are in each existing group
    const groupCounts = {};
    alivePlayers.forEach(p => {
      const g = p[col];
      if (g && g > 0) groupCounts[g] = (groupCounts[g] || 0) + 1;
    });

    const shuffled = unassigned.sort(() => Math.random() - 0.5);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      shuffled.forEach((p) => {
        // Find existing group that has space (< designedSize)
        let targetGroup = null;
        const existingGroups = Object.keys(groupCounts).map(Number).sort((a,b) => a - b);
        for (const g of existingGroups) {
          if (groupCounts[g] < designedSize) {
            targetGroup = g;
            break;
          }
        }
        // If all existing groups are full or none exist yet, create next group
        if (!targetGroup) {
          const maxGroup = existingGroups.length > 0 ? Math.max(...existingGroups) : 0;
          targetGroup = maxGroup + 1;
        }
        groupCounts[targetGroup] = (groupCounts[targetGroup] || 0) + 1;
        db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [targetGroup, p.id]);
      });
      db.run('COMMIT', () => {
        broadcastState();
        res.json({ success: true, assignedCount: shuffled.length });
      });
    });
  } else {
    // Randomize all alive players according to the round's designed group size
    const shuffled = alivePlayers.sort(() => Math.random() - 0.5);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      shuffled.forEach((p, idx) => {
        const gNum = 1 + Math.floor(idx / designedSize);
        db.run(`UPDATE players SET ${col} = ? WHERE id = ?`, [gNum, p.id]);
      });
      db.run('COMMIT', () => {
        broadcastState();
        res.json({ success: true, assignedCount: shuffled.length });
      });
    });
  }
});

app.post('/api/admin/set-winner', (req, res) => {
  const { id } = req.body;
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`UPDATE config SET value = ? WHERE key = 'winner_id'`, [id]);
    db.run('COMMIT', () => {
      broadcastState();
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/reset', (req, res) => {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(`DELETE FROM players`);
    db.run(`UPDATE config SET value = '0' WHERE key = 'current_round'`);
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
    db.run('COMMIT', () => {
      broadcastState();
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
