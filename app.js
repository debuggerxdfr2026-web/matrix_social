(() => {
  "use strict";

  const socket = io();
  const state = {
    me: null,
    users: [],
    groups: [],
    selectedUser: null,
    selectedGroup: null,
    theme: localStorage.getItem("matrix-theme") || "dark",
    call: {
      pc: null, stream: null, peerId: null, mode: null, timer: null, seconds: 0
    },
    craiHistory: []
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  document.documentElement.dataset.theme = state.theme;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(timestamp);
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function switchView(view) {
    $$(".view").forEach(el => el.classList.remove("active"));
    $(`#${view}View`)?.classList.add("active");
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  }

  function showModal(html) {
    $("#modalContent").innerHTML = html;
    $("#modal").classList.remove("hidden");
  }

  function hideModal() {
    $("#modal").classList.add("hidden");
  }

  // Matrix background
  const canvas = $("#matrixCanvas");
  const ctx = canvas.getContext("2d");
  let drops = [];
  function resizeMatrix() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops = Array(Math.ceil(innerWidth / 17)).fill(1);
  }
  function matrixTick() {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#020604";
    ctx.globalAlpha = .12;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = .65;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--green").trim() || "#00ff73";
    ctx.font = "13px monospace";
    drops.forEach((y, i) => {
      const text = String.fromCharCode(0x30A0 + Math.random() * 96);
      ctx.fillText(text, i * 17, y * 17);
      if (y * 17 > innerHeight && Math.random() > .975) drops[i] = 0;
      drops[i]++;
    });
    requestAnimationFrame(matrixTick);
  }
  addEventListener("resize", resizeMatrix);
  resizeMatrix();
  matrixTick();

  // Auth / registration
  const savedName = localStorage.getItem("matrix-username");
  if (savedName) $("#username").value = savedName;

  $("#loginForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#username").value.trim();
    if (!name) return;
    localStorage.setItem("matrix-username", name);
    socket.emit("register", name);
  });

  socket.on("connect", () => {
    $("#connectionState").classList.add("online");
    $("#connectionState").innerHTML = "<i></i> ONLINE";
    const name = localStorage.getItem("matrix-username");
    if (name && !state.me) socket.emit("register", name);
  });

  socket.on("disconnect", () => {
    $("#connectionState").classList.remove("online");
    $("#connectionState").innerHTML = "<i></i> OFFLINE";
  });

  socket.on("error_message", toast);

  socket.on("bootstrap", data => {
    state.me = data.me;
    state.users = data.users;
    state.groups = data.groups;
    $("#loginOverlay").classList.add("hidden");
    $("#composerUser").textContent = state.me.username;
    $("#profileBtn").textContent = state.me.username.slice(0, 1).toUpperCase();
    renderUsers();
    renderGroups();
    renderInstants(data.instants || []);
    renderStatuses(data.statuses || []);
  });

  socket.on("users", users => {
    state.users = users;
    renderUsers();
    if (state.selectedUser) {
      const selected = state.users.find(u => u.id === state.selectedUser.id);
      if (selected) {
        state.selectedUser = selected;
        $("#chatPresence").textContent = selected.online ? "ONLINE // SECURE LINK AVAILABLE" : "OFFLINE";
      }
    }
  });

  // Navigation
  $$(".nav-item, .brand").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

  $("#themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem("matrix-theme", state.theme);
  });

  setInterval(() => $("#clock").textContent = new Date().toLocaleTimeString([], { hour12: false }), 1000);

  // Status
  $("#statusInput").addEventListener("input", e => {
    $("#statusCounter").textContent = `${e.target.value.length} / 280`;
  });
  $("#postStatus").addEventListener("click", () => {
    const text = $("#statusInput").value.trim();
    if (!text) return toast("Status cannot be empty.");
    socket.emit("status:create", { text });
    $("#statusInput").value = "";
    $("#statusCounter").textContent = "0 / 280";
  });

  socket.on("status:new", status => {
    prependStatus(status);
    renderStatusesToFeed(status);
  });

  function prependStatus(status) {
    const html = `<article class="status-card">
      <div class="status-meta"><span>@${escapeHtml(status.username)}</span><span>${formatTime(status.createdAt)}</span></div>
      <div class="status-text">${escapeHtml(status.text)}</div>
    </article>`;
    $("#statusGrid").insertAdjacentHTML("afterbegin", html);
  }

  function renderStatuses(statuses) {
    $("#statusGrid").innerHTML = statuses
      .sort((a,b) => b.createdAt - a.createdAt)
      .map(s => `<article class="status-card">
        <div class="status-meta"><span>@${escapeHtml(s.username)}</span><span>${formatTime(s.createdAt)}</span></div>
        <div class="status-text">${escapeHtml(s.text)}</div>
      </article>`).join("") || `<div class="status-card">No broadcasts yet.</div>`;
  }

  function renderStatusesToFeed(status) {
    const empty = $("#feedList .empty");
    empty?.remove();
    $("#feedList").insertAdjacentHTML("afterbegin", `<article class="feed-item">
      <div class="feed-meta"><span>@${escapeHtml(status.username)}</span><span>STATUS // ${formatTime(status.createdAt)}</span></div>
      <div class="feed-text">${escapeHtml(status.text)}</div>
    </article>`);
    $("#statusCount").textContent = $("#feedList .feed-item").length;
  }

  function renderFeed(statuses = []) {
    const items = statuses.sort((a,b) => b.createdAt-a.createdAt);
    $("#feedList").innerHTML = items.length ? items.map(s => `<article class="feed-item">
      <div class="feed-meta"><span>@${escapeHtml(s.username)}</span><span>STATUS // ${formatTime(s.createdAt)}</span></div>
      <div class="feed-text">${escapeHtml(s.text)}</div>
    </article>`).join("") : `<div class="feed-item empty">No signals yet. Transmit the first status.</div>`;
    $("#statusCount").textContent = items.length;
  }

  // DMs
  function renderUsers() {
    const otherUsers = state.users.filter(u => u.id !== state.me?.id);
    $("#onlineUsers").innerHTML = otherUsers.map(u => `<div class="online-user">
      <span class="online-dot" style="opacity:${u.online ? 1 : .25}"></span>${escapeHtml(u.username)}
    </div>`).join("") || `<div class="online-user">No other nodes.</div>`;

    $("#dmUsers").innerHTML = otherUsers.map(u => `<button class="dm-user ${state.selectedUser?.id === u.id ? "active":""}" data-user="${escapeHtml(u.id)}">
      <span class="user-avatar">${escapeHtml(u.username.slice(0,2).toUpperCase())}</span>
      <span class="user-info"><strong>${escapeHtml(u.username)}</strong><small>${u.online ? "ONLINE" : "OFFLINE"}</small></span>
    </button>`).join("") || `<div class="online-user">Open another browser window to test DMs.</div>`;

    $$(".dm-user").forEach(btn => btn.addEventListener("click", () => selectUser(btn.dataset.user)));
  }

  function selectUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    state.selectedUser = user;
    $("#chatTitle").textContent = `@${user.username}`;
    $("#chatPresence").textContent = user.online ? "ONLINE // SECURE LINK AVAILABLE" : "OFFLINE";
    renderUsers();
    socket.emit("dm:history", { withUser: user.id });
  }

  socket.on("dm:history", ({ messages }) => {
    $("#dmMessages").innerHTML = "";
    messages.forEach(renderDmMessage);
    scrollChat("#dmMessages");
  });

  socket.on("dm:message", message => {
    if (!state.selectedUser) return;
    const relevant = [message.from, message.to].includes(state.me.id) &&
      [message.from, message.to].includes(state.selectedUser.id);
    if (relevant) {
      renderDmMessage(message);
      scrollChat("#dmMessages");
    }
  });

  function renderDmMessage(message) {
    const mine = message.from === state.me.id;
    $("#dmMessages").insertAdjacentHTML("beforeend", `<div class="message ${mine ? "mine":""}">
      ${escapeHtml(message.text)}
      <small>${mine ? "YOU" : `@${escapeHtml(message.fromName)}`} · ${formatTime(message.createdAt)}</small>
    </div>`);
  }

  $("#dmForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!state.selectedUser) return toast("Select a node first.");
    const text = $("#dmInput").value.trim();
    if (!text) return;
    socket.emit("dm:send", { to: state.selectedUser.id, text });
    $("#dmInput").value = "";
  });

  function scrollChat(selector) {
    const el = $(selector);
    el.scrollTop = el.scrollHeight;
  }

  // Groups
  function renderGroups() {
    $("#groupGrid").innerHTML = state.groups.map(g => {
      const joined = g.members.includes(state.me?.id);
      return `<article class="group-card">
        <h3>${escapeHtml(g.name)}</h3>
        <p>${escapeHtml(g.description || "No description.")}</p>
        <footer><span>${g.members.length} NODE${g.members.length === 1 ? "" : "S"}</span>
          <button class="${joined ? "primary" : "outline"} group-action" data-group="${g.id}">${joined ? "OPEN" : "JOIN"}</button>
        </footer>
      </article>`;
    }).join("");

    $$(".group-action").forEach(btn => btn.addEventListener("click", () => {
      const group = state.groups.find(g => g.id === btn.dataset.group);
      if (!group) return;
      if (!group.members.includes(state.me.id)) socket.emit("group:join", group.id);
      openGroup(group);
    }));
  }

  socket.on("groups", groups => {
    state.groups = groups;
    renderGroups();
    if (state.selectedGroup) {
      const updated = groups.find(g => g.id === state.selectedGroup.id);
      if (updated) state.selectedGroup = updated;
    }
  });

  function openGroup(group) {
    state.selectedGroup = group;
    $("#groupChat").classList.remove("hidden");
    $("#groupChatTitle").textContent = group.name;
    $("#groupChatMeta").textContent = `${group.members.length} NODES`;
    $("#groupMessages").innerHTML = `<div class="message">Connected to ${escapeHtml(group.name)}.</div>`;
    socket.emit("group:join", group.id);
    $("#groupChat").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  $("#newGroupBtn").addEventListener("click", () => {
    showModal(`<form id="groupModalForm" class="form-grid">
      <h2>CREATE GROUP</h2>
      <label>GROUP NAME</label><input name="name" maxlength="40" required placeholder="PROJECT//X">
      <label>DESCRIPTION</label><textarea name="description" maxlength="120" placeholder="Purpose of this node..."></textarea>
      <button class="primary">CREATE</button>
    </form>`);
    $("#groupModalForm").addEventListener("submit", e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      socket.emit("group:create", { name: fd.get("name"), description: fd.get("description") });
      hideModal();
    });
  });

  $("#leaveGroupBtn").addEventListener("click", () => {
    state.selectedGroup = null;
    $("#groupChat").classList.add("hidden");
  });

  socket.on("group:message", message => {
    if (state.selectedGroup?.id !== message.groupId) return;
    $("#groupMessages").insertAdjacentHTML("beforeend", `<div class="message ${message.from === state.me.id ? "mine":""}">
      ${escapeHtml(message.text)}<small>@${escapeHtml(message.fromName)} · ${formatTime(message.createdAt)}</small>
    </div>`);
    scrollChat("#groupMessages");
  });

  $("#groupForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!state.selectedGroup) return;
    const text = $("#groupInput").value.trim();
    if (!text) return;
    socket.emit("group:send", { groupId: state.selectedGroup.id, text });
    $("#groupInput").value = "";
  });

  // Instants
  let instantCache = [];
  function renderInstants(items) {
    instantCache = items;
    $("#instantGrid").innerHTML = items.sort((a,b)=>b.createdAt-a.createdAt).map(i => `<article class="instant-card">
      <span class="instant-signal">● LIVE / 24H</span>
      <p>${escapeHtml(i.text)}</p>
      <small>@${escapeHtml(i.username)} · ${formatTime(i.createdAt)}</small>
    </article>`).join("") || `<article class="instant-card"><p>No Instants. Broadcast something ephemeral.</p></article>`;
  }

  socket.on("instant:new", instant => {
    instantCache.unshift(instant);
    renderInstants(instantCache);
  });

  $("#newInstantBtn").addEventListener("click", () => {
    showModal(`<form id="instantModalForm" class="form-grid">
      <h2>NEW INSTΛNT</h2>
      <label>MESSAGE · EXPIRES IN 24H</label>
      <textarea name="text" maxlength="280" required placeholder="Transmit an ephemeral signal..."></textarea>
      <button class="primary">PUBLISH INSTANT</button>
    </form>`);
    $("#instantModalForm").addEventListener("submit", e => {
      e.preventDefault();
      socket.emit("instant:create", { text: new FormData(e.target).get("text") });
      hideModal();
      switchView("instants");
    });
  });

  // Calls
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      ...(window.MATRIX_CONFIG?.TURN_URL ? [{
        urls: window.MATRIX_CONFIG.TURN_URL,
        username: window.MATRIX_CONFIG.TURN_USERNAME,
        credential: window.MATRIX_CONFIG.TURN_CREDENTIAL
      }] : [])
    ]
  };

  async function startCall(mode) {
    if (!state.selectedUser) return toast("Select a node first.");
    if (!state.selectedUser.online) return toast("That node is offline.");

    try {
      state.call.mode = mode;
      state.call.peerId = state.selectedUser.id;
      state.call.stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video"
      });

      openCallUI(state.selectedUser.username, mode, "CALLING...");
      createPeerConnection();

      state.call.stream.getTracks().forEach(track => state.call.pc.addTrack(track, state.call.stream));
      if (mode === "video") $("#localVideo").srcObject = state.call.stream;

      const offer = await state.call.pc.createOffer();
      await state.call.pc.setLocalDescription(offer);
      socket.emit("call:offer", { to: state.call.peerId, offer, mode });
    } catch (error) {
      console.error(error);
      cleanupCall();
      toast("Could not access microphone/camera. Check browser permissions.");
    }
  }

  function createPeerConnection() {
    state.call.pc = new RTCPeerConnection(rtcConfig);
    state.call.pc.onicecandidate = e => {
      if (e.candidate && state.call.peerId) socket.emit("call:ice", { to: state.call.peerId, candidate: e.candidate });
    };
    state.call.pc.ontrack = e => {
      $("#remoteVideo").srcObject = e.streams[0];
    };
    state.call.pc.onconnectionstatechange = () => {
      const status = state.call.pc?.connectionState;
      if (status === "connected") $("#callState").textContent = "LINK ESTABLISHED";
      if (["failed","disconnected","closed"].includes(status)) $("#callState").textContent = status.toUpperCase();
    };
  }

  socket.on("call:offer", async ({ from, fromName, offer, mode }) => {
    if (state.call.pc) {
      socket.emit("call:end", { to: from });
      cleanupCall();
    }

    showModal(`<div class="form-grid">
      <span class="eyebrow">${mode.toUpperCase()} INCOMING</span>
      <h2>INCOMING LINK</h2>
      <p>@${escapeHtml(fromName)} is requesting a ${mode} call.</p>
      <button id="acceptCall" class="primary">ACCEPT</button>
      <button id="rejectCall" class="outline">REJECT</button>
    </div>`);

    $("#acceptCall").onclick = async () => {
      hideModal();
      try {
        state.call.peerId = from;
        state.call.mode = mode;
        state.call.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
        openCallUI(fromName, mode, "CONNECTING...");
        createPeerConnection();
        state.call.stream.getTracks().forEach(track => state.call.pc.addTrack(track, state.call.stream));
        if (mode === "video") $("#localVideo").srcObject = state.call.stream;
        await state.call.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await state.call.pc.createAnswer();
        await state.call.pc.setLocalDescription(answer);
        socket.emit("call:answer", { to: from, answer });
      } catch (error) {
        console.error(error);
        socket.emit("call:end", { to: from });
        cleanupCall();
        toast("Call could not be accepted.");
      }
    };
    $("#rejectCall").onclick = () => {
      hideModal();
      socket.emit("call:end", { to: from });
    };
  });

  socket.on("call:answer", async ({ answer }) => {
    if (!state.call.pc) return;
    await state.call.pc.setRemoteDescription(new RTCSessionDescription(answer));
    $("#callState").textContent = "NEGOTIATING...";
  });

  socket.on("call:ice", async ({ candidate }) => {
    try {
      if (state.call.pc && candidate) await state.call.pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn("ICE candidate failed", error);
    }
  });

  socket.on("call:end", () => {
    toast("Call ended.");
    cleanupCall();
  });

  function openCallUI(peer, mode, stateText) {
    $("#callPeer").textContent = `@${peer}`;
    $("#callMode").textContent = `${mode.toUpperCase()} LINK`;
    $("#callState").textContent = stateText;
    $("#remoteVideo").classList.toggle("hidden", mode !== "video");
    $("#localVideo").classList.toggle("hidden", mode !== "video");
    $("#voiceFallback").classList.toggle("hidden", mode !== "voice");
    $("#callOverlay").classList.remove("hidden");
    state.call.seconds = 0;
    clearInterval(state.call.timer);
    state.call.timer = setInterval(() => {
      state.call.seconds++;
      const m = String(Math.floor(state.call.seconds / 60)).padStart(2, "0");
      const s = String(state.call.seconds % 60).padStart(2, "0");
      $("#callTimer").textContent = `${m}:${s}`;
    }, 1000);
  }

  function cleanupCall() {
    clearInterval(state.call.timer);
    state.call.timer = null;
    state.call.pc?.close();
    state.call.stream?.getTracks().forEach(t => t.stop());
    state.call.pc = null;
    state.call.stream = null;
    state.call.peerId = null;
    $("#remoteVideo").srcObject = null;
    $("#localVideo").srcObject = null;
    $("#callOverlay").classList.add("hidden");
  }

  $("#voiceCall").addEventListener("click", () => startCall("voice"));
  $("#videoCall").addEventListener("click", () => startCall("video"));
  $("#endCallBtn").addEventListener("click", () => {
    if (state.call.peerId) socket.emit("call:end", { to: state.call.peerId });
    cleanupCall();
  });
  $("#muteBtn").addEventListener("click", () => {
    const track = state.call.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#muteBtn").textContent = track.enabled ? "MUTE" : "UNMUTE";
  });
  $("#cameraBtn").addEventListener("click", () => {
    const track = state.call.stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#cameraBtn").textContent = track.enabled ? "CAM" : "CAM OFF";
  });

  // CRAI
  $("#craiToggle").addEventListener("click", () => $("#craiPanel").classList.toggle("open"));
  $("#craiClose").addEventListener("click", () => $("#craiPanel").classList.remove("open"));

  $$(".crai-tools button").forEach(btn => btn.addEventListener("click", () => {
    $("#craiInput").value = btn.dataset.prompt;
    $("#craiForm").requestSubmit();
  }));

  $("#craiForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#craiInput");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    appendCrai("user", message);
    state.craiHistory.push({ role: "user", content: message });

    const thinking = document.createElement("div");
    thinking.className = "ai-bubble";
    thinking.textContent = "CRAI is processing...";
    thinking.id = "craiThinking";
    $("#craiMessages").appendChild(thinking);
    scrollChat("#craiMessages");

    try {
      const response = await fetch(`${window.MATRIX_CONFIG?.API_BASE || ""}/api/crai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: state.craiHistory })
      });
      const data = await response.json();
      thinking.remove();
      if (!response.ok) throw new Error(data.error || "CRAI request failed");
      appendCrai("assistant", data.reply);
      state.craiHistory.push({ role: "assistant", content: data.reply });
    } catch (error) {
      thinking.remove();
      appendCrai("assistant", `Connection fault: ${error.message}`);
    }
  });

  function appendCrai(role, text) {
    const div = document.createElement("div");
    div.className = role === "user" ? "user-bubble" : "ai-bubble";
    div.textContent = text;
    $("#craiMessages").appendChild(div);
    scrollChat("#craiMessages");
  }

  // Modal
  $("#modalClose").addEventListener("click", hideModal);
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") hideModal(); });

  // Initial feed from server is supplied in bootstrap; retain it through a wrapper.
  const originalBootstrap = socket.listeners("bootstrap")[0];
  socket.off("bootstrap");
  socket.on("bootstrap", data => {
    originalBootstrap(data);
    renderFeed(data.statuses || []);
    renderStatuses(data.statuses || []);
  });
})();
