function createSimulation(config) {
  const state = {
    width: 920,
    height: 560,
    nChairs: (config && config.nChairs) || 12,
    chairRadius: (config && config.chairRadius) || 16,
    mouseSpeed: (config && config.mouseSpeed) || 190,
    teamSpeed: (config && config.teamSpeed) || 220,
    seed: (config && config.seed) || 20250813,
    running: true,

    chairs: [],
    players: [],
    status: 'playing',
    elapsed: 0,
    lastTs: null,
  }

  const EPSILON = 0.1 // safety margin (10%)

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
  const mul = (v, k) => ({ x: v.x * k, y: v.y * k })
  const norm = (v) => {
    const d = Math.hypot(v.x, v.y) || 1
    return { x: v.x / d, y: v.y / d }
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function makeChairsDense(n, w, h, seed, chairRadius) {
    const rng = mulberry32(seed)
    const margin = chairRadius + 6
    let minD = chairRadius * 2.35
    const chairs = []
    for (let i = 0; i < n; i++) {
      let placed = false,
        attempts = 0
      while (!placed && attempts < 4000) {
        attempts++
        const x = margin + rng() * (w - 2 * margin)
        const y = margin + rng() * (h - 2 * margin)
        const p = { x, y }
        if (chairs.every((c) => dist(c.pos, p) >= minD)) {
          chairs.push({ id: i, pos: p })
          placed = true
        }
        if (!placed && attempts % 800 === 0) minD *= 0.96
      }
      if (!placed) {
        const r = Math.min(w, h) * 0.35
        const cx = w / 2,
          cy = h / 2
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + rng() * 0.2
        chairs.push({
          id: i,
          pos: { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) },
        })
      }
    }
    return chairs
  }

  function reset() {
    state.chairs = makeChairsDense(
      state.nChairs,
      state.width,
      state.height,
      state.seed,
      state.chairRadius,
    )

    const rng = mulberry32(state.seed + 42)
    const emptyChairId = Math.floor(rng() * state.nChairs)
    state.elapsed = 0
    state.status = 'playing'
    state.lastTs = null

    const team = []
    let tIdx = 0
    for (let i = 0; i < state.nChairs; i++) {
      if (i === emptyChairId) continue
      team.push({
        id: `p-${tIdx++}`,
        pos: { ...state.chairs[i].pos },
        targetChairId: null,
        sittingOn: i,
      })
    }

    const emptyPos = state.chairs[emptyChairId].pos
    const ang = rng() * Math.PI * 2
    const far = Math.max(state.width, state.height) * 0.9 + 260
    const start = add(emptyPos, {
      x: Math.cos(ang) * far,
      y: Math.sin(ang) * far,
    })
    const mouse = {
      id: 'mouse',
      pos: start,
      targetChairId: null,
      sittingOn: null,
    }

    state.players = [mouse, ...team]
  }

  function step(dt) {
    if (state.status !== 'playing') return

    const occupiedChairs = new Set(
      state.players.filter((p) => p.sittingOn != null).map((p) => p.sittingOn),
    )
    const emptyChairs = state.chairs.filter((c) => !occupiedChairs.has(c.id))

    if (emptyChairs.length === 0) {
      state.status = 'team_won'
      return
    }

    const mouse = state.players.find((p) => p.id === 'mouse')
    if (mouse.sittingOn != null) return

    // choose vacancy minimizing mouse arrival time
    let target = null
    let bestMouseT = Infinity
    for (const c of emptyChairs) {
      const t = dist(mouse.pos, c.pos) / state.mouseSpeed
      if (t < bestMouseT) {
        bestMouseT = t
        target = c
      }
    }
    mouse.targetChairId = target.id

    const teamPlayers = state.players.filter((p) => p.id !== 'mouse')
    const movingDefenders = teamPlayers.filter((p) => p.targetChairId != null)

    // single-defender relay with margin
    if (movingDefenders.length === 0) {
      let defender = null
      let bestT = Infinity
      for (const p of teamPlayers) {
        if (p.sittingOn == null) continue
        const t = dist(p.pos, target.pos) / state.teamSpeed
        if (t < bestT) {
          bestT = t
          defender = p
        }
      }
      if (defender && bestT < bestMouseT * (1 - EPSILON)) {
        defender.targetChairId = target.id
        defender.sittingOn = null
      }
    }

    // move entities
    const chairLookup = new Map(state.chairs.map((c) => [c.id, c]))
    for (const p of state.players) {
      if (p.targetChairId == null) continue
      const targetPos = chairLookup.get(p.targetChairId).pos
      const speed = p.id === 'mouse' ? state.mouseSpeed : state.teamSpeed
      const stepLen = Math.min(speed * dt, dist(p.pos, targetPos))
      p.pos = add(p.pos, mul(norm(sub(targetPos, p.pos)), stepLen))
    }

    // arrivals with single-occupancy guarantee
    const reachEps = state.chairRadius * 0.5
    const arrivals = []
    for (const p of state.players) {
      if (p.targetChairId == null) continue
      const targetPos = chairLookup.get(p.targetChairId).pos
      const d = dist(p.pos, targetPos)
      if (d <= reachEps)
        arrivals.push({ player: p, d, isMouse: p.id === 'mouse' })
    }
    arrivals.sort(
      (a, b) => a.d - b.d || (a.isMouse === b.isMouse ? 0 : a.isMouse ? 1 : -1),
    )
    const dynamicOccupied = new Set(
      state.players.filter((p) => p.sittingOn != null).map((p) => p.sittingOn),
    )
    for (const { player: p } of arrivals) {
      const cid = p.targetChairId
      if (cid == null) continue
      if (dynamicOccupied.has(cid)) {
        p.targetChairId = null
        continue
      }
      if (p.id === 'mouse') {
        p.sittingOn = cid
        state.status = 'mouse_won'
        dynamicOccupied.add(cid)
        break
      }
      p.sittingOn = cid
      p.targetChairId = null
      dynamicOccupied.add(cid)
    }
  }

  reset()

  return {
    step,
    getState: () => state,
  }
}

// ES module export for browsers
export { createSimulation }

// CommonJS fallback for Node.js tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSimulation }
}
