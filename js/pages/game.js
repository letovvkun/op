const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const finalScoreEl = document.getElementById('final-score');
  const bestScoreMenuEl = document.getElementById('bestScoreMenu');
  const gameOverScreen = document.getElementById('game-over');
  const popup = document.getElementById('mugiwara-popup');
  const popupText = document.getElementById('mugiwara-text');
  const popupAvatar = document.getElementById('mugiwara-avatar');
  const scoreBoard = document.getElementById('scoreBoard');
  const startMenu = document.getElementById('start-menu');
  const uiLayer = document.getElementById('ui-layer');

  const BEST_SCORE_KEY = 'grandLineBestScore';
  let bestScore = 0;
  try {
    const savedBestScore = Number(localStorage.getItem(BEST_SCORE_KEY));
    bestScore = Number.isFinite(savedBestScore) && savedBestScore > 0 ? savedBestScore : 0;
  } catch (_) {
    // Лучший результат необязателен: игра должна работать и без Web Storage.
  }
  bestScoreMenuEl.textContent = bestScore.toLocaleString('ru-RU');

  let width, height;
  let isGameRunning = false;
  let isGameOver = false;
  let frames = 0;
  let lastTime = performance.now();
  let animationFrameId = null;

  let baseSpeed = 2.0;
  let gameSpeed = baseSpeed;
  let maxSpeed = 10;
  let acceleration = 0.0006;

  let score = 0;
  let nextMilestone = 1000;
  let oceanOffset = 0;
  let timeOfDay = 0;

  let spawnObsAcc = 0;
  let spawnColAcc = 0;
  let scoreAcc = 0;

  function scheduleLoop() {
    if (animationFrameId !== null) return;
    animationFrameId = requestAnimationFrame(loop);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    scheduleLoop();
  }
  window.addEventListener('resize', resize);
  resize();

  const player = {
    x: width / 2,
    y: height - 150,
    size: 24,
    targetX: width / 2,
    targetY: height - 150,
    tilt: 0,
    pushVx: 0,
    pushVy: 0
  };

  let obstacles = [];
  let collectibles = [];
  let particles = [];
  let birds = [];
  let stars = [];

  const quotes = [
    { emoji: '🍖', text: 'Шишиши! Мясо!! То есть... Белли!!' },
    { emoji: '⚔️', text: 'Отлично... Хватит на хорошее саке.' },
    { emoji: '🍊', text: 'МОИ ДЕНЕЖКИ!!! СОБИРАЙ ЕЩЁ! 😍' },
    { emoji: '🍳', text: 'Всё ради Нами-сан! 🌪️' },
    { emoji: '🤥', text: 'Ха! Я, Великий Усопп, собрал бы больше!' },
    { emoji: '🦌', text: 'Докторская сумка будет полной!' },
    { emoji: '💀', text: 'Йо-хо-хо! Глаза разбегаются... хотя их у меня нет!' },
    { emoji: '🤖', text: 'СУУУПЕРРРРР куш, бро!' }
  ];

  const keys = {};
  window.addEventListener('keydown', e => keys[e.key] = true);
  window.addEventListener('keyup', e => keys[e.key] = false);

  canvas.addEventListener('touchmove', e => {
    if (!isGameRunning || isGameOver || e.touches.length > 1) return;
    e.preventDefault();
    player.targetX = e.touches[0].clientX;
    player.targetY = e.touches[0].clientY - 60;
  }, { passive: false });

  canvas.addEventListener('mousemove', e => {
    if (isGameRunning && !isGameOver) {
      player.targetX = e.clientX;
      player.targetY = e.clientY;
    }
  });

  function lerpColor(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t)
    ];
  }

  function startGame(diff) {
    if (diff === 'easy') { baseSpeed = 1.6; maxSpeed = 8.5; acceleration = 0.00035; }
    else if (diff === 'medium') { baseSpeed = 2.6; maxSpeed = 13; acceleration = 0.00075; }
    else if (diff === 'hard') { baseSpeed = 3.6; maxSpeed = 18; acceleration = 0.0015; }

    startMenu.style.display = 'none';
    uiLayer.style.display = 'block';
    resetGame();
  }

  function goToMenu() {
    isGameRunning = false;
    gameOverScreen.style.display = 'none';
    uiLayer.style.display = 'none';
    startMenu.style.display = 'flex';
    bestScoreMenuEl.textContent = bestScore.toLocaleString('ru-RU');
    player.x = width / 2;
    player.y = height - 150;
    player.targetX = width / 2;
    player.targetY = height - 150;
    player.tilt = 0;
    player.pushVx = 0;
    player.pushVy = 0;
    scheduleLoop();
  }

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => startGame(btn.dataset.diff));
  });
  document.getElementById('restartBtn').addEventListener('click', resetGame);
  document.getElementById('menuBtn').addEventListener('click', goToMenu);

  function drawShip(x, y, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, -player.size * 2);
    ctx.quadraticCurveTo(-player.size * 1.5, -player.size, -player.size * 0.5, player.size);
    ctx.quadraticCurveTo(0, player.size * 1.5, player.size * 0.5, player.size);
    ctx.quadraticCurveTo(player.size * 1.5, -player.size, 0, -player.size * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 10;

    ctx.fillStyle = '#8B5A2B';
    ctx.beginPath();
    ctx.ellipse(0, 0, player.size, player.size * 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5C3A21';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#F8F9FA';
    ctx.beginPath();
    ctx.moveTo(0, -player.size * 1.2);
    ctx.quadraticCurveTo(player.size * 1.4, player.size * 0.8, 0, player.size * 1.6);
    ctx.quadraticCurveTo(-player.size * 1.4, player.size * 0.8, 0, -player.size * 1.2);
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, player.size * 0.2, player.size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(-player.size * 0.4, -player.size * 0.1);
    ctx.lineTo(player.size * 0.4, player.size * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(player.size * 0.4, -player.size * 0.1);
    ctx.lineTo(-player.size * 0.4, player.size * 0.5);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, -player.size * 2.2, player.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D2B48C';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-player.size * 0.4, -player.size * 2.2, player.size * 0.3, 0, Math.PI, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(player.size * 0.4, -player.size * 2.2, player.size * 0.3, 0, Math.PI, true);
    ctx.stroke();

    ctx.restore();
  }

  function drawWhirlpool(x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < Math.PI * 4; i += 0.12) {
      const r = (size * i) / (Math.PI * 4);
      ctx.lineTo(r * Math.cos(i), r * Math.sin(i));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 100, 255, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSeaKing(x, y, size) {
    ctx.save();
    ctx.translate(x, y);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#0a2e22';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;

    ctx.beginPath();
    ctx.moveTo(-size * 0.6, size * 0.8);
    ctx.quadraticCurveTo(-size * 0.8, -size * 0.5, 0, -size * 1.2);
    ctx.quadraticCurveTo(size * 0.8, -size * 0.5, size * 0.6, size * 0.8);
    ctx.fill();

    ctx.fillStyle = '#174a38';
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.2);
    ctx.lineTo(-size * 0.2, -size * 1.5);
    ctx.lineTo(0, -size * 0.9);
    ctx.fill();

    ctx.shadowColor = '#ff2a2a';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath();
    ctx.ellipse(-size * 0.25, -size * 0.5, size * 0.1, size * 0.15, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.25, -size * 0.5, size * 0.1, size * 0.15, -Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, -size * 0.1);
    ctx.lineTo(-size * 0.15, size * 0.3);
    ctx.lineTo(0, -size * 0.1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(size * 0.3, -size * 0.1);
    ctx.lineTo(size * 0.15, size * 0.3);
    ctx.lineTo(0, -size * 0.1);
    ctx.fill();

    ctx.restore();
  }

  function drawBarrel(x, y, size) {
    ctx.save();
    ctx.translate(x, y + Math.sin(frames * 0.05 + x) * 3);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#A0522D';
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#696969';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCoin(x, y, size) {
    ctx.save();
    ctx.translate(x, y + Math.sin(frames * 0.08 + x) * 4);
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 10 + Math.sin(frames * 0.1) * 5;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#DAA520';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = `900 ${size}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', 0, 1);
    ctx.restore();
  }

  function drawChest(x, y, size) {
    ctx.save();
    ctx.translate(x, y + Math.sin(frames * 0.06 + x) * 3);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#5C3A21';
    ctx.fillRect(-size, -size * 0.8, size * 2, size * 1.6);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(-size + 4, -size * 0.8, 6, size * 1.6);
    ctx.fillRect(size - 10, -size * 0.8, 6, size * 1.6);
    ctx.fillRect(-8, -4, 16, 12);
    ctx.restore();
  }

  function drawBird(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(0, 50, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const wingY = Math.sin(frames * 0.2 + b.x) * 10;
    ctx.beginPath();
    ctx.moveTo(-15, wingY);
    ctx.quadraticCurveTo(-7, -5, 0, 0);
    ctx.quadraticCurveTo(7, -5, 15, wingY);
    ctx.stroke();
    ctx.restore();
  }

  function spawnObstacle() {
    const rand = Math.random();
    let type = 'barrel', size = 22, hitbox = 20;
    if (rand > 0.85) { type = 'whirlpool'; size = 60; hitbox = 45; }
    else if (rand > 0.70) { type = 'seaking'; size = 45; hitbox = 35; }
    obstacles.push({
      x: Math.random() * (width - size * 2) + size,
      y: -100,
      size,
      type,
      hitbox,
      rot: 0
    });
  }

  function spawnCollectible() {
    const isChest = Math.random() > 0.9;
    collectibles.push({
      x: Math.random() * (width - 40) + 20,
      y: -100,
      size: isChest ? 22 : 14,
      type: isChest ? 'chest' : 'coin',
      value: isChest ? 250 : 25,
      hitbox: isChest ? 25 : 20
    });
  }

  function createSplash(x, y, color = 'rgba(255, 255, 255, 0.6)') {
    if (particles.length > 150) return;
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 1,
        life: 1,
        size: Math.random() * 5 + 3,
        color
      });
    }
  }

  function showPopup() {
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    popupAvatar.textContent = quote.emoji;
    popupText.textContent = quote.text;
    popup.classList.add('show');
    clearTimeout(popup._timer);
    popup._timer = setTimeout(() => popup.classList.remove('show'), 4200);
  }

  function update(dt) {
    if (!isGameRunning || isGameOver) return;

    if (gameSpeed < maxSpeed) gameSpeed += acceleration * dt;

    timeOfDay = (score % 4000) / 4000;
    if (timeOfDay > 0.4 && timeOfDay < 0.8 && stars.length < 80 && Math.random() > 0.85) {
      stars.push({ x: Math.random() * width, y: Math.random() * height, life: Math.random() });
    }

    const moveStep = 12 * dt;
    if (keys['ArrowLeft'] || keys['a'] || keys['A'] || keys['ф'] || keys['Ф']) player.targetX -= moveStep;
    if (keys['ArrowRight'] || keys['d'] || keys['D'] || keys['в'] || keys['В']) player.targetX += moveStep;
    if (keys['ArrowUp'] || keys['w'] || keys['W'] || keys['ц'] || keys['Ц']) player.targetY -= moveStep;
    if (keys['ArrowDown'] || keys['s'] || keys['S'] || keys['ы'] || keys['Ы']) player.targetY += moveStep;

    const minY = height * 0.65;
    const maxY = height - player.size * 2;

    player.targetX = Math.max(player.size, Math.min(width - player.size, player.targetX));
    player.targetY = Math.max(minY, Math.min(maxY, player.targetY));

    const dx = player.targetX - player.x;
    const dy = player.targetY - player.y;

    player.x += dx * 0.12 * dt + player.pushVx * dt;
    player.y += dy * 0.12 * dt + player.pushVy * dt;

    const damping = Math.pow(0.85, dt);
    player.pushVx *= damping;
    player.pushVy *= damping;

    player.tilt = (dx * 0.006) + (player.pushVx * 0.02);

    player.x = Math.max(player.size, Math.min(width - player.size, player.x));
    player.y = Math.max(minY - 30, Math.min(maxY + 30, player.y));

    if (Math.floor(frames) % 2 === 0) createSplash(player.x, player.y + player.size * 1.8);
    oceanOffset += gameSpeed * 0.5 * dt;

    scoreAcc += dt;
    if (scoreAcc >= 10) {
      score += Math.floor(gameSpeed);
      scoreEl.textContent = score.toLocaleString('ru-RU');
      scoreAcc -= 10;
    }

    if (score >= nextMilestone) {
      showPopup();
      nextMilestone += 1500;
    }

    const obstacleRate = Math.max(28, Math.floor(100 - gameSpeed * 3));
    spawnObsAcc += dt;
    if (spawnObsAcc >= obstacleRate) {
      spawnObstacle();
      spawnObsAcc = 0;
    }

    spawnColAcc += dt;
    if (spawnColAcc >= 40) {
      spawnCollectible();
      spawnColAcc = 0;
    }

    if (birds.length < 5 && Math.random() > 0.992) {
      birds.push({ x: Math.random() * width, y: -50, speed: Math.random() * 2 + 1 });
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.y += gameSpeed * dt;

      if (obs.type === 'whirlpool') {
        obs.rot += 0.05 * dt;
        const dist = Math.hypot(player.x - obs.x, player.y - obs.y);
        const effectRadius = obs.size * 2.5;

        if (dist < effectRadius && dist > 0) {
          const force = Math.pow((effectRadius - dist) / effectRadius, 2);
          const angle = Math.atan2(player.y - obs.y, player.x - obs.x);
          const tangent = angle + (Math.PI / 2);

          player.pushVx += (Math.cos(tangent) * force * 30 + Math.cos(angle) * force * 10) * dt;
          player.pushVy += (Math.sin(tangent) * force * 30 + Math.sin(angle) * force * 10) * dt;
        }
      } else {
        const dist = Math.hypot(player.x - obs.x, player.y - obs.y);
        if (dist < (player.size * 0.8 + obs.hitbox)) {
          gameOver();
          return;
        }
      }

      if (obs.y > height + 100) obstacles.splice(i, 1);
    }

    for (let i = collectibles.length - 1; i >= 0; i--) {
      const col = collectibles[i];
      col.y += gameSpeed * dt;
      const dist = Math.hypot(player.x - col.x, player.y - col.y);
      if (dist < (player.size + col.hitbox)) {
        score += col.value;
        scoreEl.textContent = score.toLocaleString('ru-RU');
        for (let j = 0; j < 4; j++) createSplash(col.x, col.y, '#FFD700');
        collectibles.splice(i, 1);
        continue;
      }
      if (col.y > height + 100) collectibles.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += (p.vy + gameSpeed * 0.3) * dt;
      p.size *= Math.pow(0.95, dt);
      p.life -= 0.03 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.y += gameSpeed * 0.5 * dt;
      b.x += b.speed * dt;
      if (b.y > height || b.x > width) birds.splice(i, 1);
    }

    frames += dt;
  }

  function loop(now) {
    animationFrameId = null;
    const rawDt = (now - lastTime) / 16.6667;
    lastTime = now;
    const dt = Math.min(rawDt, 3); // защита от скачков при сворачивании вкладки

    let cTop, cBot;
    if (timeOfDay < 0.25) {
      cTop = [10, 66, 115]; cBot = [5, 34, 61];
      scoreBoard.style.background = 'rgba(0,0,0,0.45)';
    } else if (timeOfDay < 0.4) {
      const t = (timeOfDay - 0.25) / 0.15;
      cTop = lerpColor([10, 66, 115], [255, 120, 80], t);
      cBot = lerpColor([5, 34, 61], [100, 20, 50], t);
    } else if (timeOfDay < 0.75) {
      const t = (timeOfDay - 0.4) / 0.35;
      cTop = lerpColor([255, 120, 80], [5, 15, 30], Math.min(1, t * 2));
      cBot = lerpColor([100, 20, 50], [2, 5, 15], Math.min(1, t * 2));
      scoreBoard.style.background = 'rgba(255,255,255,0.12)';
    } else {
      const t = (timeOfDay - 0.75) / 0.25;
      cTop = lerpColor([5, 15, 30], [10, 66, 115], t);
      cBot = lerpColor([2, 5, 15], [5, 34, 61], t);
    }

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgb(${cTop[0]},${cTop[1]},${cTop[2]})`);
    grad.addColorStop(1, `rgb(${cBot[0]},${cBot[1]},${cBot[2]})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    if (timeOfDay > 0.3 && timeOfDay < 0.8) {
      ctx.fillStyle = '#FFF';
      stars.forEach(s => {
        ctx.globalAlpha = Math.abs(Math.sin(frames * 0.05 + s.life * 10));
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 2;
    const waveSpacing = 90;
    for (let y = (oceanOffset % waveSpacing) - waveSpacing; y < height; y += waveSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= width; x += 50) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + oceanOffset * 0.03) * 20);
      }
      ctx.stroke();
    }

    particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    collectibles.forEach(col => {
      if (col.type === 'coin') drawCoin(col.x, col.y, col.size);
      else drawChest(col.x, col.y, col.size);
    });

    obstacles.forEach(obs => {
      if (obs.type === 'barrel') drawBarrel(obs.x, obs.y, obs.size);
      else if (obs.type === 'whirlpool') drawWhirlpool(obs.x, obs.y, obs.size, obs.rot);
      else drawSeaKing(obs.x, obs.y, obs.size);
    });

    birds.forEach(b => drawBird(b));
    drawShip(player.x, player.y, player.tilt);

    if (isGameRunning) {
      update(dt);
      if (isGameRunning) scheduleLoop();
    }
  }

  function gameOver() {
    isGameOver = true;
    isGameRunning = false;
    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
      } catch (_) {
        // Не прерываем игровой цикл, если хранилище недоступно.
      }
    }
    gameOverScreen.style.display = 'block';
    finalScoreEl.textContent = score.toLocaleString('ru-RU');
    canvas.style.transform = 'translate(14px, 14px)';
    setTimeout(() => canvas.style.transform = 'translate(-14px, -14px)', 50);
    setTimeout(() => canvas.style.transform = 'translate(9px, -9px)', 100);
    setTimeout(() => canvas.style.transform = 'translate(0, 0)', 150);
  }

  function resetGame() {
    score = 0;
    gameSpeed = baseSpeed;
    frames = 0;
    nextMilestone = 1000;
    oceanOffset = 0;
    spawnObsAcc = 0;
    spawnColAcc = 0;
    scoreAcc = 0;
    obstacles = [];
    collectibles = [];
    particles = [];
    birds = [];
    stars = [];
    player.x = width / 2;
    player.y = height - 150;
    player.targetX = width / 2;
    player.targetY = height - 150;
    player.tilt = 0;
    player.pushVx = 0;
    player.pushVy = 0;
    scoreEl.textContent = '0';
    gameOverScreen.style.display = 'none';
    popup.classList.remove('show');
    isGameOver = false;
    isGameRunning = true;
    scheduleLoop();
  }

  // Рисуем один статичный кадр для меню; дальнейший цикл запускается только в игре.
  scheduleLoop();
