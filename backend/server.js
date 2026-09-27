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
    io.emit('state_update', { players, currentRound, winnerId });
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
  socket.emit('state_update', { players, currentRound, winnerId });

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

// Admin endpoints (could also be socket events, but REST is fine for actions)
app.post('/api/admin/start-round1', async (req, res) => {
  let players = await getAllPlayers();
  
  // Separate pre-assigned traitors and innocents
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

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    groups.forEach((group, groupIdx) => {
      let numTraitors = 3;
      if (group.length < 10) numTraitors = Math.max(1, Math.round(group.length * 0.3));

      // Any player already set to 'Traitor' by admin REMAINS Traitor
      const existingTraitors = group.filter(p => p.role === 'Traitor');
      let neededTraitors = Math.max(0, numTraitors - existingTraitors.length);
      const innocentCandidates = group.filter(p => p.role !== 'Traitor');
      const newlySelectedTraitors = new Set(innocentCandidates.slice(0, neededTraitors).map(p => p.id));

      group.forEach((player) => {
        let finalRole = 'Innocent';
        if (player.role === 'Traitor' || newlySelectedTraitors.has(player.id)) {
          finalRole = 'Traitor';
        }
        db.run(`UPDATE players SET role = ?, round1_group = ? WHERE id = ?`, 
          [finalRole, groupIdx + 1, player.id]);
      });
    });
    db.run(`UPDATE config SET value = '1' WHERE key = 'current_round'`);
    db.run(`UPDATE config SET value = '' WHERE key = 'winner_id'`);
    db.run('COMMIT', () => {
      broadcastState();
      res.json({ success: true });
    });
  });
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
