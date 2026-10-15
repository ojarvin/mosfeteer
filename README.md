<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" width="104" alt="">
  </picture>
</p>

<h1 align="center">Mosfeteer</h1>

<p align="center">
  <b>Analog circuit design, from sketch to equation.</b><br>
  Draw textbook-quality schematics, walk through them step by step,<br>
  and derive their transfer functions.
</p>

<p align="center">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-3c873a?style=flat-square">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-4078ff?style=flat-square">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-8a93a3?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#analysis">Analysis</a> ·
  <a href="#keys-worth-knowing">Keys</a> ·
  <a href="#more">More</a>
</p>

<br>

<p align="center">
  <img src="docs/images/editor.webp" alt="A switched-capacitor integrator in the editor, split between the light and dark themes: its op-amp opens the linked folded-cascode OTA in a bubble, the beats window steps through the clock phases, and the timing diagram sits below.">
</p>

## What it does

|  |  |
| --- | --- |
| **Draw fast** | Press `i` and type to place a part, `w` to draw a wire. Moving a part bends only the wire legs that must change, so the layout stays as you drew it. |
| **Explain in steps** | Beats show, dim, and hide parts and flip switches over one drawing, driven by a timing diagram. |
| **Derive the math** | Symbolic Z<sub>in</sub>, Z<sub>out</sub>, A<sub>v</sub>, poles, zeros, and noise, each term traced back to its devices. |
| **Analyze block diagrams** | Draw a loop of gains, sums, H(s) and H(z) blocks, samplers, and quantizers, and get its exact transfer functions, plots, and a time-domain simulation. |
| **Tune it** | An optimizer searches the free coefficients for the best in-band noise, peaking, or pole Q that keeps your limits and signal swings. |
| **Work across designs** | Parts link to the circuits they stand for. Peek into them, dive in, or keep another design open in a reference window. |
| **Keep the story** | Notes in Markdown with math beside each design, mentioning its parts and nets. Every save is kept in the file; pin the one that works as a checkpoint and roll back to it later. |
| **Keep tools at hand** | A calculator that speaks engineering units, reference windows with another design beside this one, a design check, and a command line for every action. |
| **Share it** | SVG, PDF, and PNG export sized for papers, and a browser-only build that runs from a folder. |

<p align="center">
  <img src="docs/images/atlas.webp" alt="The Atlas: a workspace's designs laid out on one dark sheet. The folded-cascode OTA is picked and lifted on a card; beams of light run to it from the op-amps of three designs that use it, which lift beside it while the rest dim.">
  <br>
  <sub><b>The Atlas</b> lays out every design in your workspace on one sheet. Pick one and the designs it links to lift beside it, joined by beams. Search inside them, and open one with a click.</sub>
</p>

## Analysis

The analysis window (`Shift+S`) has two modes, picked by what is drawn.

**Small-signal** analysis solves a transistor circuit exactly and shows the result the way a textbook would: Z<sub>in</sub>, Z<sub>out</sub>, the gain, its poles and zeros, and input-referred noise, each term traced back to the devices it comes from. Pick the input and output on the drawing; ambiguous picks get a diagnostic, never a guess.

**Signal flow** works on block diagrams: gains, sum and multiply junctions, H(s) and H(z) blocks (MATLAB-style `tf(...)`, delays and DAC pulses included), samplers, and quantizers. Every source gets its exact transfer function to the output from one solve, so a delta-sigma modulator's STF and NTF come out together, with the common factors cancelled. Symbols such as `a_1` or `k` stay symbolic in the equations and get sliders for the plots.

The **Plots** window (`Shift+W`) shows the result as tabs: magnitude and phase, the step response, a root locus, the loop gain with its margins, the signal swing of every net against the input amplitude (where the loop overloads), and a time-domain simulation of the nets you pick. A diagram with a quantizer also shows its simulated output spectrum. The graph, the swing, and the waveforms can be annotated onto the drawing.

The **optimizer** searches the free coefficients for the best goal that keeps every limit. Goals and limits are specs on a transfer function over a band (in-band noise, peak, lowest point), pole specs (the highest Q, the largest radius), relations between coefficients (`c_1 >= c_2`), and a swing test that simulates the loop with a sine and keeps chosen nets under their limits. Lee's rule for a modulator is one line: the NTF's peak below 3.5 dB.

Alongside: a **calculator** (`Shift+E`) that reads `1/(2pi*10k*1n)` and `20*log(ans)`, **reference windows** (`Shift+V`) that keep another design in view, **notes** (`n`) where `@M1` points at a part, a **history** (More → History…) of the last ten saves and the checkpoints you pin, and a **design check** (`x`) for unconnected pins, overlapping nets and labels, and other slips.

## Quick start

All you need is [Node.js](https://nodejs.org/) 18 or newer.

```sh
git clone https://github.com/ojarvin/mosfeteer.git
cd mosfeteer
node launch.mjs
```

The editor opens in its own window and quits when you close it.

- **Windows:** double-click `Mosfeteer.cmd`.
- **Linux or macOS:** `node launch.mjs --install` adds Mosfeteer to the application menu.
- **No Node?** Open [`browser-only/index.html`](browser-only/index.html) directly. Make one folder for all your designs and open it there (**Open folder…**): in Chrome or Edge new designs save straight into it, and the Atlas shows them all each visit. Firefox and Safari can read the folder, but save by downloading a copy.

## Keys worth knowing

| | |
| --- | --- |
| `i` · `w` | insert a part · draw a wire |
| `Shift+B` · `Shift+K` | beats · timing diagram |
| `Shift+S` · `Shift+W` | analysis · plots |
| `Shift+E` · `x` | calculator · design check |
| `Shift+V` · `n` | reference windows · notes |
| `Shift+Backspace` | the Atlas |
| `?` | everything else: keys, tutorial, symbols, tips |

## More

<details>
<summary><b>Documents</b></summary>

<br>

Each schematic is one `.json` file, easy to keep in git or send to someone. New designs go to a workspace folder, `~/Documents/Schematics` by default. An open design with no unsaved changes reloads when its file changes on disk, for example after a `git pull`. **Export** (`Ctrl/Cmd+E`) frames the drawing tightly. Pick a page guide (IEEE single or double column) and the text lands at the paper's figure size.

</details>

<details>
<summary><b>Scripting</b></summary>

<br>

The editor, the CLI, and the HTTP API share one command language:

```sh
npm run cli -- amp "add nmos M1 --at 120 120"   # edits <workspace>/amp.json
```

</details>

<details>
<summary><b>Development</b></summary>

<br>

```sh
npm run serve   # dev server with auto-restart at http://127.0.0.1:47280/
npm test
```

- [`docs/model.md`](docs/model.md) · [`docs/editor.md`](docs/editor.md): the symbol specification and model rules, and editor behavior
- [`docs/atlas.md`](docs/atlas.md) · [`docs/hierarchy.md`](docs/hierarchy.md) · [`docs/beats.md`](docs/beats.md): the Atlas, linked designs, and beats
- [`docs/symbolic-analysis.md`](docs/symbolic-analysis.md) · [`docs/topological-small-signal.md`](docs/topological-small-signal.md): small-signal analysis and how its equations are formed
- [`docs/signal-flow-analysis.md`](docs/signal-flow-analysis.md): signal-flow analysis, the swing simulation, and the optimizer

</details>

## License

[MIT](LICENSE). The vendored Latin Modern Math font in `src/web/fonts/` keeps its own [GUST Font License](src/web/fonts/GUST-FONT-LICENSE.txt).
