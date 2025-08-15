import { createSimulation } from './simulation.mjs'

;(async function () {
  const $ = (id) => document.getElementById(id)
  const canvas = $('stage')
  const ctx = canvas.getContext('2d')

  let sim

  function reset() {
    const config = {
      nChairs: parseInt($('nChairs').value, 10),
      mouseSpeed: parseInt($('mouseSpeed').value, 10),
      teamSpeed: parseInt($('teamSpeed').value, 10),
      chairRadius: parseInt($('chairRadius').value, 10),
      seed: parseInt($('seed').value, 10),
    }
    sim = createSimulation(config)
  }

  // UI bindings
  $('btn-toggle').onclick = () => {
    const state = sim.getState()
    state.running = !state.running
    $('btn-toggle').textContent = state.running ? 'Пауза' : 'Старт'
  }
  $('btn-restart').onclick = () => {
    const state = sim.getState()
    state.seed += 1
    $('seed').value = state.seed
    reset()
  }
  $('btn-reroll').onclick = () => {
    const state = sim.getState()
    state.seed += 1
    $('seed').value = state.seed
    reset()
  }

  $('nChairs').oninput = (e) => {
    $('nChairsVal').textContent = e.target.value
    reset()
  }
  $('mouseSpeed').oninput = (e) => {
    const state = sim.getState()
    state.mouseSpeed = parseInt(e.target.value, 10)
    $('mouseSpeedVal').textContent = state.mouseSpeed + ' px/s'
  }
  $('teamSpeed').oninput = (e) => {
    const state = sim.getState()
    state.teamSpeed = parseInt(e.target.value, 10)
    $('teamSpeedVal').textContent = state.teamSpeed + ' px/s'
  }
  $('chairRadius').oninput = (e) => {
    $('chairRadiusVal').textContent = e.target.value + ' px'
    reset()
  }
  $('seed').onchange = (e) => {
    reset()
  }

  function draw() {
    const state = sim.getState()
    const w = canvas.width,
      h = canvas.height
    const ctx2 = ctx
    ctx2.clearRect(0, 0, w, h)

    ctx2.fillStyle = '#fafafa'
    ctx2.fillRect(0, 0, w, h)

    const occupiedChairs = new Set(
      state.players.filter((p) => p.sittingOn != null).map((p) => p.sittingOn),
    )

    for (const c of state.chairs) {
      const isEmpty = !occupiedChairs.has(c.id)
      ctx2.beginPath()
      ctx2.arc(c.pos.x, c.pos.y, state.chairRadius, 0, Math.PI * 2)
      ctx2.fillStyle = isEmpty ? '#fde68a' : '#e5e7eb'
      ctx2.fill()
      ctx2.lineWidth = 2
      ctx2.strokeStyle = isEmpty ? '#d97706' : '#9ca3af'
      ctx2.stroke()
    }

    for (const p of state.players) {
      const isMouse = p.id === 'mouse'
      const r = isMouse ? state.chairRadius * 0.75 : state.chairRadius * 0.6
      ctx2.beginPath()
      ctx2.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2)
      ctx2.fillStyle = isMouse ? '#ef4444' : '#0ea5e9'
      ctx2.fill()
      ctx2.lineWidth = 2
      ctx2.strokeStyle = isMouse ? '#be123c' : '#075985'
      ctx2.stroke()
    }
  }

  function loop(ts) {
    const state = sim.getState()
    if (state.lastTs == null) state.lastTs = ts
    const dt = Math.min((ts - state.lastTs) / 1000, 0.05)
    state.lastTs = ts

    if (state.running) {
      state.elapsed += dt
      sim.step(dt)
    }
    draw()
    $('elapsed').textContent = state.elapsed.toFixed(1)
    $('status').textContent = state.status

    requestAnimationFrame(loop)
  }

  reset()
  requestAnimationFrame(loop)
})()
