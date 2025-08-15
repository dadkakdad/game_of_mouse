// Simulation Test Harness (ESM)
import { createSimulation } from './simulation.mjs'

function runTest(config) {
  const sim = createSimulation(config)
  const state = sim.getState()

  const maxTime = 120 // 2 minutes
  const dt = 0.016 // 60 FPS

  while (state.elapsed < maxTime && state.status === 'playing') {
    sim.step(dt)
    state.elapsed += dt
  }

  return {
    status: state.status,
    time: state.elapsed,
  }
}

function runBatch() {
  console.log('Running batch simulation...')
  const results = []
  for (let i = 0; i < 10; i++) {
    const config = {
      seed: 20250813 + i,
    }
    const result = runTest(config)
    results.push(result)
    console.log(
      `- Seed ${config.seed}: ${result.status} at ${result.time.toFixed(1)}s`,
    )
  }

  const avgTime = results.reduce((acc, r) => acc + r.time, 0) / results.length
  const winRate =
    results.filter((r) => r.status === 'team_won').length / results.length

  console.log(`\nAverage game time: ${avgTime.toFixed(1)}s`)
  console.log(`Team win rate: ${winRate * 100}%`)
}

runBatch()
