(() => {
  // ============================================================
  // 常量
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // 道路：4 车道，两侧留 30px 边
  const ROAD_LEFT = 30, ROAD_RIGHT = W - 30;
  const ROAD_W = ROAD_RIGHT - ROAD_LEFT;
  const LANE_COUNT = 4;
  const LANE_W = ROAD_W / LANE_COUNT;
  const LANE_X = (i) => ROAD_LEFT + LANE_W * (i + 0.5);  // 车道中心 x

  const CAR_W = LANE_W - 14;
  const CAR_H = 56;
  const PLAYER_Y = H - 100;

  const BASE_SPEED = 220;        // px/s
  const SPEED_GAIN = 12;         // 每 10 秒 +12
  const MAX_SPEED = 600;
  const COIN_VALUE = 20;
  const HP_MAX = 3;
  const BEST_KEY = "charlie-racer-highscore";

  // ============================================================
  // 状态
  // ============================================================
  let state, player, enemies, coins, particles, score, speed, hp, best;
  let time, spawnTimer, coinTimer;
  let stripeOffset;       // 道路黄线滚动偏移
  let invuln;             // 撞车后短暂无敌（秒）

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
  }
  function saveBest(s) {
    try { localStorage.setItem(BEST_KEY, String(s)); } catch (e) {}
  }

  function reset() {
    player = { lane: 1, x: LANE_X(1), targetX: LANE_X(1), boost: 0 };
    enemies = [];
    coins = [];
    particles = [];
    score = 0;
    speed = BASE_SPEED;
    hp = HP_MAX;
    time = 0;
    spawnTimer = 0;
    coinTimer = 1.0;       // 第一次金币 1 秒后出
    stripeOffset = 0;
    invuln = 0;
    best = loadBest();
    state = "ready";
    updateHud();
  }

  function start() {
    state = "playing";
    document.getElementById("overlay").classList.add("hidden");
  }

  function gameOver() {
    state = "over";
    const finalScore = Math.floor(score);
    const isNew = finalScore > best;
    if (isNew) { best = finalScore; saveBest(best); }
    const overlay = document.getElementById("overlay");
    const card = document.getElementById("overlayCard");
    card.classList.remove("lose");
    card.classList.add("lose");
    document.getElementById("overlayTitle").textContent = "💥 撞毁了";
    document.getElementById("overlayStats").innerHTML = `
      本局 <span class="big">${finalScore}</span>${isNew ? '<span class="new">新纪录！</span>' : ''}<br>
      最高 ${best}
    `;
    document.getElementById("startBtn").textContent = "再来一局";
    overlay.classList.remove("hidden");
    updateHud();
  }

  // ============================================================
  // HUD
  // ============================================================
  const hud = {
    score: document.getElementById("hudScore"),
    speed: document.getElementById("hudSpeed"),
    hp:    document.getElementById("hudHp"),
    best:  document.getElementById("hudBest"),
  };
  function updateHud() {
    hud.score.textContent = Math.floor(score);
    hud.speed.textContent = Math.floor(speed);
    hud.hp.textContent = "♥".repeat(hp) + "♡".repeat(HP_MAX - hp);
    hud.best.textContent = best;
  }

  // ============================================================
  // 输入
  // ============================================================
  function moveLane(dir) {
    if (state !== "playing") return;
    const newLane = Math.max(0, Math.min(LANE_COUNT - 1, player.lane + dir));
    if (newLane !== player.lane) {
      player.lane = newLane;
      player.targetX = LANE_X(newLane);
    }
  }

  function setBoost(b) {
    if (state !== "playing") return;
    player.boost = b;  // 1 = 加速, -1 = 减速, 0 = 正常
  }

  window.addEventListener("keydown", (e) => {
    if (state === "ready" && (e.code === "Space" || e.code === "Enter")) {
      start(); e.preventDefault(); return;
    }
    if (state !== "playing") return;
    switch (e.code) {
      case "ArrowLeft": case "KeyA": moveLane(-1); e.preventDefault(); break;
      case "ArrowRight": case "KeyD": moveLane(1); e.preventDefault(); break;
      case "ArrowUp": case "KeyW": setBoost(1); e.preventDefault(); break;
      case "ArrowDown": case "KeyS": setBoost(-1); e.preventDefault(); break;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ArrowDown" || e.code === "KeyS") {
      setBoost(0);
    }
  });

  // 触屏：滑动
  let touchStart = null;
  canvas.addEventListener("pointerdown", (e) => {
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    const dt = performance.now() - touchStart.t;
    touchStart = null;
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && dt < 250) {
      // 点击：左半屏 = 左切，右半屏 = 右切
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      if (state === "ready") return;  // ready 时点击不动作
      moveLane(px < 0.5 ? -1 : 1);
      return;
    }
    if (state !== "playing") return;
    if (Math.abs(dx) > Math.abs(dy)) {
      moveLane(dx > 0 ? 1 : -1);
    } else {
      // 向上滑加速短暂；这里简化：只切道，上下不通过滑动改速度
    }
  });

  document.getElementById("startBtn").addEventListener("click", () => {
    if (state === "over" || state === "ready") {
      reset();
      start();
    }
  });

  // ============================================================
  // 生成敌车 / 金币
  // ============================================================
  const ENEMY_COLORS = ["#ff5c5c", "#ff9a3c", "#c084ff", "#6bd6ff", "#6dd478"];

  function spawnEnemy() {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    // 避免在已有敌车正上方紧密生成（防止"无解"）
    const lastInLane = enemies.filter(e => e.lane === lane).sort((a, b) => a.y - b.y)[0];
    if (lastInLane && lastInLane.y < 80) return;
    enemies.push({
      lane,
      x: LANE_X(lane),
      y: -CAR_H,
      color: ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)],
      // 敌车自己也有点速度（相对地面慢于玩家），增加超车感
      relSpeed: -40 - Math.random() * 60,   // 相对玩家：玩家从其下方追上
    });
  }

  function spawnCoin() {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    coins.push({ lane, x: LANE_X(lane), y: -20, r: 10 });
  }

  // ============================================================
  // 主循环
  // ============================================================
  let lastTime = performance.now();
  let frameId = null;
  function loop(now) {
    if (document.hidden) {
      frameId = null;
      return;
    }
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    update(dt);
    draw();
    frameId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (frameId === null) frameId = requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      lastTime = performance.now();
      startLoop();
    }
  });

  function update(dt) {
    // 粒子永远更新
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state !== "playing") return;

    time += dt;
    invuln = Math.max(0, invuln - dt);

    // 速度递增
    const targetSpeed = Math.min(MAX_SPEED, BASE_SPEED + (time / 10) * SPEED_GAIN);
    let curSpeed = targetSpeed;
    if (player.boost === 1) curSpeed *= 1.5;
    else if (player.boost === -1) curSpeed *= 0.6;
    speed = curSpeed;

    // 玩家车横向动画（平滑滑到目标车道）
    const dx = player.targetX - player.x;
    if (Math.abs(dx) > 0.5) player.x += dx * Math.min(1, dt * 12);
    else player.x = player.targetX;

    // 道路黄线滚动
    stripeOffset = (stripeOffset + speed * dt) % 60;

    // 距离/分数
    score += speed * dt * 0.1;

    // 敌车移动（相对玩家）
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += (speed + e.relSpeed) * dt;
      if (e.y > H + CAR_H) enemies.splice(i, 1);
    }

    // 金币移动
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.y += speed * dt;
      if (c.y > H + 20) coins.splice(i, 1);
    }

    // 生成
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      // 难度递进：间隔从 1.4 缩到 0.5
      const baseGap = Math.max(0.5, 1.4 - time * 0.01);
      spawnTimer = baseGap * (0.7 + Math.random() * 0.6);
    }
    coinTimer -= dt;
    if (coinTimer <= 0) {
      spawnCoin();
      coinTimer = 1.5 + Math.random() * 1.5;
    }

    // 碰撞：玩家 vs 敌车
    if (invuln === 0) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (rectHit(player.x, PLAYER_Y, CAR_W, CAR_H, e.x, e.y, CAR_W, CAR_H)) {
          // 撞了
          enemies.splice(i, 1);
          hp--;
          invuln = 1.5;
          spawnHitParticles(e.x, e.y, "#ff5c5c");
          updateHud();
          if (hp <= 0) { gameOver(); return; }
          break;
        }
      }
    }

    // 碰撞：玩家 vs 金币
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (Math.abs(c.x - player.x) < CAR_W / 2 + c.r &&
          Math.abs(c.y - PLAYER_Y) < CAR_H / 2 + c.r) {
        coins.splice(i, 1);
        score += COIN_VALUE;
        spawnCoinParticles(c.x, c.y);
        updateHud();
      }
    }
  }

  function rectHit(x1, y1, w1, h1, x2, y2, w2, h2) {
    return Math.abs(x1 - x2) < (w1 + w2) / 2 - 4 &&  // 碰撞框收一点更宽容
           Math.abs(y1 - y2) < (h1 + h2) / 2 - 4;
  }

  function spawnHitParticles(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 160;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0.6 + Math.random() * 0.3,
        color: ["#ffd24a", "#ff5c5c", "#fff"][Math.floor(Math.random() * 3)],
        size: 2 + Math.random() * 3,
      });
    }
  }

  function spawnCoinParticles(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 80;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        life: 0.4 + Math.random() * 0.2,
        color: "#ffd24a",
        size: 2 + Math.random() * 2,
      });
    }
  }

  // ============================================================
  // 渲染
  // ============================================================
  function draw() {
    // 草地（路两侧）
    ctx.fillStyle = "#1a2740";
    ctx.fillRect(0, 0, W, H);
    // 路面
    ctx.fillStyle = "#2a2e3a";
    ctx.fillRect(ROAD_LEFT, 0, ROAD_W, H);
    // 路沿
    ctx.fillStyle = "#444";
    ctx.fillRect(ROAD_LEFT - 4, 0, 4, H);
    ctx.fillRect(ROAD_RIGHT, 0, 4, H);

    // 车道分隔黄虚线（3 条）
    ctx.fillStyle = "rgba(255, 210, 74, 0.65)";
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = ROAD_LEFT + LANE_W * i;
      for (let y = -60 + stripeOffset; y < H; y += 60) {
        ctx.fillRect(x - 2, y, 4, 30);
      }
    }

    // 路两侧灯柱（小亮点，让速度感更强）
    ctx.fillStyle = "rgba(255, 245, 180, 0.5)";
    for (let y = -100 + (stripeOffset * 1.2) % 100; y < H; y += 100) {
      ctx.fillRect(ROAD_LEFT - 14, y, 4, 4);
      ctx.fillRect(ROAD_RIGHT + 10, y, 4, 4);
    }

    // 金币
    for (const c of coins) {
      ctx.save();
      ctx.translate(c.x, c.y);
      const rot = performance.now() / 200;
      const scaleX = Math.cos(rot);
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(-c.r * Math.abs(scaleX), -c.r, c.r * 2 * Math.abs(scaleX), c.r * 2);
      ctx.fillStyle = "#a37b00";
      ctx.fillRect(-c.r * Math.abs(scaleX) + 3, -c.r + 3, c.r * 2 * Math.abs(scaleX) - 6, c.r * 2 - 6);
      ctx.fillStyle = "#ffd24a";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (Math.abs(scaleX) > 0.4) ctx.fillText("$", 0, 1);
      ctx.restore();
    }

    // 敌车
    for (const e of enemies) {
      drawCar(e.x, e.y, e.color, false);
    }

    // 玩家车（无敌时闪烁）
    if (state !== "ready" && (invuln === 0 || Math.floor(performance.now() / 80) % 2 === 0)) {
      drawCar(player.x, PLAYER_Y, "#6bd6ff", true);
    }

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawCar(cx, cy, color, isPlayer) {
    const x = cx - CAR_W / 2;
    const y = cy - CAR_H / 2;
    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x + 2, y + 4, CAR_W, CAR_H);
    // 主体
    ctx.fillStyle = color;
    ctx.fillRect(x, y, CAR_W, CAR_H);
    // 暗边
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x, y + CAR_H - 4, CAR_W, 4);
    ctx.fillRect(x, y, CAR_W, 3);
    // 挡风玻璃
    ctx.fillStyle = "rgba(20, 30, 50, 0.7)";
    if (isPlayer) {
      // 玩家车头朝上
      ctx.fillRect(x + 5, y + 8, CAR_W - 10, 16);
    } else {
      // 敌车头朝下
      ctx.fillRect(x + 5, y + CAR_H - 24, CAR_W - 10, 16);
    }
    // 车灯
    if (isPlayer) {
      ctx.fillStyle = "#fff5b3";
      ctx.fillRect(x + 4, y + 2, 6, 4);
      ctx.fillRect(x + CAR_W - 10, y + 2, 6, 4);
    } else {
      ctx.fillStyle = "#fff5b3";
      ctx.fillRect(x + 4, y + CAR_H - 6, 6, 4);
      ctx.fillRect(x + CAR_W - 10, y + CAR_H - 6, 6, 4);
    }
  }

  // ============================================================
  // 启动
  // ============================================================
  reset();
  startLoop();
})();
