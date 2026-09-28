import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const io = new Server(server, {
  cors: { origin: "*" }
});

// Demo-only in-memory state. Replace with a database in production.
const users = new Map();
const groups = new Map();
const messages = new Map();
const instants = [];
const statuses = [];

const demoGroups = [
  { id: "g-matrix", name: "MATRIX//CORE", description: "Main community channel", owner: "SYSTEM", members: [] },
  { id: "g-dev", name: "DEV//LAB", description: "Build, break, rebuild.", owner: "SYSTEM", members: [] }
];
demoGroups.forEach(g => groups.set(g.id, g));

function cleanText(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function publicUsers() {
  return [...users.values()].map(({ id, username, online }) => ({ id, username, online }));
}

function getUserBySocket(socketId) {
  return [...users.values()].find(u => u.socketId === socketId);
}

function conversationKey(a, b) {
  return [a, b].sort().join("::");
}

function activeInstants() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return instants.filter(x => x.createdAt > cutoff);
}

function activeStatuses() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return statuses.filter(x => x.createdAt > cutoff);
}

io.on("connection", socket => {
  socket.on("register", username => {
    const name = cleanText(username, 24).replace(/\s+/g, " ");
    if (!name) return socket.emit("error_message", "Username is required.");

    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${socket.id.slice(-5)}`;
    const user = { id, username: name, socketId: socket.id, online: true };
    users.set(id, user);
    socket.data.userId = id;

    socket.emit("bootstrap", {
      me: { id, username: name },
      users: publicUsers(),
      groups: [...groups.values()],
      instants: activeInstants(),
      statuses: activeStatuses()
    });
    io.emit("users", publicUsers());
  });

  socket.on("dm:send", ({ to, text }) => {
    const sender = users.get(socket.data.userId);
    const target = users.get(to);
    const body = cleanText(text);
    if (!sender || !target || !body) return;

    const message = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: sender.id,
      fromName: sender.username,
      to: target.id,
      text: body,
      createdAt: Date.now()
    };

    const key = conversationKey(sender.id, target.id);
    if (!messages.has(key)) messages.set(key, []);
    messages.get(key).push(message);

    socket.emit("dm:message", message);
    io.to(target.socketId).emit("dm:message", message);
  });

  socket.on("dm:history", ({ withUser }) => {
    const me = socket.data.userId;
    if (!me || !withUser) return;
    socket.emit("dm:history", {
      withUser,
      messages: messages.get(conversationKey(me, withUser)) ?? []
    });
  });

  socket.on("instant:create", ({ text }) => {
    const user = users.get(socket.data.userId);
    const body = cleanText(text, 280);
    if (!user || !body) return;
    const instant = {
      id: `i-${Date.now()}`,
      userId: user.id,
      username: user.username,
      text: body,
      createdAt: Date.now()
    };
    instants.push(instant);
    io.emit("instant:new", instant);
  });

  socket.on("status:create", ({ text }) => {
    const user = users.get(socket.data.userId);
    const body = cleanText(text, 280);
    if (!user || !body) return;
    const status = {
      id: `s-${Date.now()}`,
      userId: user.id,
      username: user.username,
      text: body,
      createdAt: Date.now()
    };
    statuses.push(status);
    io.emit("status:new", status);
  });

  socket.on("group:create", ({ name, description }) => {
    const user = users.get(socket.data.userId);
    const groupName = cleanText(name, 40);
    if (!user || !groupName) return;

    const group = {
      id: `g-${Date.now()}`,
      name: groupName,
      description: cleanText(description, 120),
      owner: user.username,
      members: [user.id]
    };
    groups.set(group.id, group);
    io.emit("groups", [...groups.values()]);
  });

  socket.on("group:join", groupId => {
    const user = users.get(socket.data.userId);
    const group = groups.get(groupId);
    if (!user || !group) return;
    if (!group.members.includes(user.id)) group.members.push(user.id);
    socket.join(group.id);
    io.emit("groups", [...groups.values()]);
  });

  socket.on("group:send", ({ groupId, text }) => {
    const user = users.get(socket.data.userId);
    const group = groups.get(groupId);
    const body = cleanText(text);
    if (!user || !group || !group.members.includes(user.id) || !body) return;

    const message = {
      id: `gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      groupId,
      from: user.id,
      fromName: user.username,
      text: body,
      createdAt: Date.now()
    };
    io.to(group.id).emit("group:message", message);
  });

  // WebRTC signaling: SDP/ICE data is relayed only between two sockets.
  socket.on("call:offer", ({ to, offer, mode }) => {
    const target = users.get(to);
    const sender = users.get(socket.data.userId);
    if (target && sender) {
      io.to(target.socketId).emit("call:offer", {
        from: sender.id,
        fromName: sender.username,
        offer,
        mode
      });
    }
  });

  socket.on("call:answer", ({ to, answer }) => {
    const target = users.get(to);
    if (target) io.to(target.socketId).emit("call:answer", { answer, from: socket.data.userId });
  });

  socket.on("call:ice", ({ to, candidate }) => {
    const target = users.get(to);
    if (target) io.to(target.socketId).emit("call:ice", { candidate, from: socket.data.userId });
  });

  socket.on("call:end", ({ to }) => {
    const target = users.get(to);
    if (target) io.to(target.socketId).emit("call:end");
  });

  socket.on("disconnect", () => {
    const user = getUserBySocket(socket.id);
    if (user) {
      users.delete(user.id);
      io.emit("users", publicUsers());
    }
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "matrix-social" }));

app.post("/api/crai", async (req, res) => {
  const message = cleanText(req.body?.message, 4000);
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
  if (!message) return res.status(400).json({ error: "Message is required." });

  const apiUrl = process.env.AI_API_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (!apiUrl || !apiKey || !model) {
    return res.json({
      reply: localCrai(message)
    });
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are CRAI, a concise, helpful assistant inside a social network. Be safe, practical and clear."
          },
          ...history.map(x => ({ role: x.role === "assistant" ? "assistant" : "user", content: cleanText(x.content, 4000) })),
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({ error: `AI provider error: ${detail.slice(0, 300)}` });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return res.status(502).json({ error: "AI provider returned no message." });
    res.json({ reply });
  } catch (error) {
    console.error("CRAI error:", error);
    res.status(500).json({ error: "CRAI could not reach the configured provider." });
  }
});

function localCrai(input) {
  const q = input.toLowerCase();
  if (q.includes("help")) return "CRAI online. Try: 'How do I start a video call?', 'What can I post?', or 'Explain the Matrix interface.'";
  if (q.includes("video") || q.includes("call")) return "Select a user from DIRECT, then use the VIDEO or VOICE action. Your browser will request the required media permission.";
  if (q.includes("instant")) return "INSTΛNTS are ephemeral posts designed to disappear after 24 hours.";
  if (q.includes("group")) return "Open GROUPS to create or join a realtime discussion channel.";
  if (q.includes("theme")) return "Use the theme switch in the top bar. Your preference is stored locally.";
  return `CRAI local mode received: "${input.slice(0, 180)}". Connect an AI_API_URL, AI_API_KEY and AI_MODEL in .env for a full model.`;
}

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`MATRIX SOCIAL running at http://localhost:${port}`);
});
