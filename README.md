# Mouse & Chairs — Local Simulation

A self-contained simulation of the "Mouse and Chairs" game using **Canvas + Vanilla JS**. This project includes a visual simulation in the browser as well as a headless test harness for strategy optimization.

## How to run

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/game_of_mouse.git
   cd game_of_mouse
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local server:
   ```bash
   npm start
   ```
4. Open your browser and navigate to `http://127.0.0.1:8080` to see the simulation.

## Development

This project uses [Prettier](https://prettier.io/) for code formatting.

### File Structure

- `index.html`: The main entry point for the visual simulation.
- `style.css`: Styles for the simulation page.
- `script.js`: Handles UI logic, canvas rendering, and user input.
- `simulation.mjs`: Core simulation logic, including game state, physics, and AI strategies. This is a module to allow for headless testing.
- `test.mjs`: A simple headless test runner for evaluating strategies.
- `search.mjs`: A brute-force parameter search script to find optimal strategy configurations.

### Scripts

- `npm start`: Starts a local development server.
- `npm run format`: Formats all `.js` and `.css` files.
- `node test.mjs`: Runs a single batch of simulations with the current default tuning.
- `node search.mjs`: Runs a brute-force search to find optimal strategy parameters.

## Contributing

Contributions are welcome! If you have ideas for new strategies or improvements, feel free to open an issue or submit a pull request.