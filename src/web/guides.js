/**
 * Learn's guides: short how-tos for the common tasks, each a title, a short
 * introduction, and numbered steps. Pure data and search: help.js draws
 * them. In the text, **Name** is a control on screen and `key` a key.
 */

const DOCS = 'https://github.com/ojarvin/mosfeteer/blob/main/docs/';

export const GUIDES = Object.freeze([
  {
    id: 'first-circuit',
    title: 'Draw a first circuit',
    intro: 'A drawing is made of parts joined by wires. Wires connect only at their ends and at junction dots, so two wires that cross stay apart.',
    steps: [
      'Click **New** in the toolbar, type a name for the design, and press `Enter` to save it.',
      'Press `i`, type part of a name such as **nmos** or **resistor**, and press `Enter`.',
      'Click on the drawing to place the part. Press `r` to rotate it before you click, and press `Esc` when you are done.',
      'Press `w`, click a pin, and click another pin to join them with a wire. You can also drag from a pin to start a wire.',
      'Insert a **supply**, a **ground**, and **input** and **output** ports in the same way, and wire them to the circuit.',
      'Press `l`, type a net name, and click a wire to name its net. Press `Esc` to stop.',
      'Press `Ctrl/Cmd+S` to save.',
    ],
    keywords: 'place insert part component wire connect pin net label name start begin new schematic',
    tutorial: 'ota',
  },
  {
    id: 'save-open',
    title: 'Save and open designs',
    intro: 'Each design is one .json file in the workspace folder. The file holds the drawing and everything saved with it, such as the notes, the timing diagram, and the save history.',
    steps: [
      'Type a name into the name field at the top left, and press `Enter` to save a new design.',
      'Press `Ctrl/Cmd+S` to save your changes. A dot after the name shows that there are unsaved changes.',
      'Press `Ctrl/Cmd+Shift+S` to save a copy under another name or in another folder.',
      'Open **More** in the toolbar and choose **Workspace folder…** to pick the folder that holds your designs. In the browser-only version, the item is **Open folder…**.',
      'Pick a design from the list beside the name, or press `Ctrl/Cmd+O` to open a file from any folder.',
      'Press `Shift+Y` to list the earlier saves. Click **Restore** on one to bring its drawing back.',
    ],
    keywords: 'file folder workspace json load history undo restore rename copy',
    doc: 'notes-and-history.md',
  },
  {
    id: 'sizes-values',
    title: 'Set transistor sizes and part values',
    intro: 'A transistor can carry a size, and a passive or a source can carry a value. You can show them on the drawing or list them in a parts table.',
    steps: [
      'Select a part. The side panel shows it under **Selection**; press `Shift+P` if the panel is hidden.',
      'Type a size such as **2u/180n x4** into the **Size** field, or a value such as **10k** into the **Value** field, and press `Enter`.',
      'Press `Shift+Z` to open the sizing window, which lists every part in one table. Type into its cells as you would in a spreadsheet.',
      'To show a size or a value on the drawing, right-click the part, choose **Sizing** or **Value**, and then choose **Below the name**.',
      'Click **Annotate** in the sizing window to put a parts table on the drawing.',
    ],
    keywords: 'width length w/l multiplier resistance capacitance sizing table spreadsheet',
  },
  {
    id: 'small-signal',
    title: 'Run a small-signal analysis',
    intro: 'The small-signal analysis derives the symbolic transfer function and impedances of a transistor circuit. Supplies and grounds already count as AC ground, so a drawing with rails needs nothing extra.',
    steps: [
      'Draw the circuit. Put an input port on the input and an output port on the output, or give both nets a name.',
      'Click **Analysis** in the toolbar, or press `Shift+S`. Choose **Circuit** at the top of the window if another mode is showing.',
      'Choose the **Input node** and the **Output node** from their lists, or click **Pick** beside a list and then click a wire.',
      'If a bias net should be AC ground, type its name into **AC grounds**.',
      'Click **Derive**. The equations appear on the **Equations** tab.',
      'Open **Options** to choose other transfer functions, noise, or model simplifications, and click **Derive** again.',
      'Click **Plots** to see the Bode plot. Under **Values**, set the numbers that the plot uses.',
    ],
    keywords: 'gain transfer function impedance bode frequency response pole zero noise ac mna symbolic equation derive',
    doc: 'symbolic-analysis.md',
  },
  {
    id: 'annotate',
    title: 'Put analysis results on the drawing',
    intro: 'A window never draws on the drawing by itself. **Annotate** adds equations, plots, and tables to the drawing, and it updates them in place when you press it again.',
    steps: [
      'Derive a result in the analysis window.',
      'Click **Annotate…** at the bottom of the window, and choose what to add, such as **Equations**, a Bode plot, or **Everything**.',
      'In the Plots window (`Shift+W`), click **Annotate** to add the plot that is on screen.',
      'Drag the figure to where you want it. When you annotate again later, the figure is updated and keeps its place.',
      'Choose **Arrange figures** in the **More** menu to move every figure back to its default place beside the circuit.',
    ],
    keywords: 'figure plot equation table annotate bode graph place drawing',
    doc: 'figures.md',
  },
  {
    id: 'signal-flow',
    title: 'Analyze a block diagram (signal flow)',
    intro: 'The signal-flow analysis finds the transfer functions of a block diagram. Each wire carries one signal, and blocks in s and in z meet only at a sampler or a DAC.',
    steps: [
      'Press `i` and insert the blocks: **Transfer function H(s)** or **H(z)**, **Gain**, and **Sum junction**.',
      'Wire the blocks together. Put an input port on each input and an output port on the output.',
      'Double-click a block to type its transfer function, such as **1/s**, or its gain.',
      'Right-click a sum junction and choose **Input polarity** to make one of its inputs negative.',
      'Press `Shift+S` and choose **Signal flow** at the top of the window.',
      'Pick the **Output**, set each source to **Input**, **Zero**, or **Constant**, and click **Derive**.',
      'Click **Plots** to see the responses.',
    ],
    keywords: 'block diagram signal flow loop delta sigma modulator ntf stf transfer function sampler quantizer gain sum integrator',
    tutorial: 'sdm',
    doc: 'signal-flow-analysis.md',
  },
  {
    id: 'phases',
    title: 'Give switches their phases',
    intro: 'A switch\'s label names its phase, the clock signal that closes it, and switches with the same phase open and close together. Phases, the timing diagram, and beats each work on their own, and each one helps the others.',
    steps: [
      'Select the switches that share a phase. Shift-click to add a switch to the selection.',
      'Right-click one of them, choose **Phase**, and then choose **New phase…**.',
      'Type the phase name, such as **$\\varphi_1$**, and press `Enter`.',
      'Put the other switches on their phase in the same way. A phase that is in use is listed in the **Phase** menu.',
      'Select a switch and press `s` to open or close every switch of its phase.',
    ],
    keywords: 'switch phase clock phi switched capacitor label open closed',
    tutorial: 'switched-cap',
    doc: 'beats.md',
  },
  {
    id: 'timing',
    title: 'Draw a timing diagram',
    intro: 'The timing diagram shows which phases are high in each time slot. The switched-capacitor analysis and **Make beats** read it as the clock, but a diagram also works without switches, for a clock or an enable of its own.',
    steps: [
      'Click **Timing** in the toolbar, or press `Shift+K`. The editor shows a row for each switch phase.',
      'Click a slot to make it high or low. Click **+** beside **Slots** to add a slot.',
      'Under **Non-overlap**, tick a pair of phases to keep a gap between them.',
      'To add a row that is not a switch phase, type its name into **Signals** and click the add button beside it.',
      'Click **Annotate** to draw the diagram under the drawing. From then on, every change redraws it in place.',
    ],
    keywords: 'timing diagram clock waveform wave slot non-overlap phase signal',
    tutorial: 'switched-cap',
    doc: 'beats.md',
  },
  {
    id: 'beats',
    title: 'Make beats and present them',
    intro: 'Beats are the steps of a figure that builds up during a talk. Each beat shows, dims, or hides parts and sets the switches. **Make beats** creates one beat for each clock state, with or without a timing diagram.',
    steps: [
      'Give the switches their phases.',
      'Click **Make beats** in the timing editor. If you have no timing diagram, choose **Make beats from phases** in the **More** menu instead.',
      'Press `Shift+B` to open the beats window, and click a beat to show it.',
      'Press `Alt+→` and `Alt+←` to step through the beats. Open switches are drawn open, and the parts that they cut off are dimmed.',
      'Press `+` to add a beat by hand. Select parts and press `h` to hide them from that beat on.',
      'Click **Present**, or press `Shift+F5`, to show the beats full screen.',
    ],
    keywords: 'beats slides presentation present talk step animation build',
    tutorial: 'switched-cap',
    doc: 'beats.md',
  },
  {
    id: 'switched-cap',
    title: 'Analyze a switched-capacitor circuit',
    intro: 'The switched-capacitor analysis finds the exact H(z) of a circuit of switches, capacitors, and op-amps. It reads the clock from the timing diagram, or from the beats when there is no diagram.',
    steps: [
      'Draw the circuit, and put ports on the input and the output.',
      'Give the switches their phases, and draw the clock in the timing diagram.',
      'Press `Shift+S`. The window opens in **Switched-cap** mode; if it does not, choose **Switched-cap** at the top.',
      'Check the **Input**, the **Output**, and **Read at**, and click **Derive**.',
      'Under **Noise**, tick **kT/C noise with each Derive** to add the switch noise.',
      'To give an op-amp a finite gain, right-click it and choose **Small-signal attributes → Opamp model**.',
    ],
    keywords: 'switched capacitor sc integrator h(z) z-domain charge ktc noise clock',
    tutorial: 'switched-cap',
    doc: 'switched-cap-analysis.md',
  },
  {
    id: 'logic',
    title: 'Analyze a logic circuit',
    intro: 'The logic analysis gives the truth table of a drawing of gates and each output as a minimized sum of products. With flip-flops or latches, it gives a state table instead.',
    steps: [
      'Draw the gates. Put input ports on the inputs and output ports on the outputs.',
      'Press `Shift+S`. A drawing of logic parts opens in **Logic** mode.',
      'Click **Derive** to see the truth table and the equations.',
      'Click **Annotate…** and choose **Table** or **Equations** to put them on the drawing.',
      'To go the other way, choose **Synthesis**, fill in a truth table, and click **Draw** to get the gates.',
    ],
    keywords: 'logic gate digital truth table boolean flip-flop latch state synthesis and or nand',
    doc: 'logic-analysis.md',
  },
  {
    id: 'export',
    title: 'Export a figure',
    intro: 'Export saves the drawing as SVG, PDF, or PNG, framed to what is drawn. A page guide sizes the text for a paper.',
    steps: [
      'Click **Export** in the toolbar, or press `Ctrl/Cmd+E`.',
      'Choose the folder and type a file name.',
      'Choose the formats you want: **SVG**, **PDF**, or **PNG**.',
      'Under **Page guide**, choose a size such as **IEEE single column**.',
      'Under **Content**, choose the whole drawing, only the selection, or one beat.',
      'Click **Export**.',
      'To paste the drawing into another app instead, press `Ctrl/Cmd+Shift+C`. It copies the selection, or the whole drawing, as an image.',
    ],
    keywords: 'export svg pdf png image picture paper figure copy clipboard ieee',
  },
  {
    id: 'link',
    title: 'Link a part to another design',
    intro: 'A part can link to another design, such as an op-amp symbol linked to its transistor schematic. The link only points to the design and adds no connections.',
    steps: [
      'Save both designs in the same workspace folder.',
      'Right-click the part, choose **Link to design**, and pick the design from the list.',
      'Select the part and press `o` to show the linked design beside the drawing.',
      'Press `Alt+↓` to open the linked design, and press `Alt+↑` to go back.',
    ],
    keywords: 'link hierarchy subcircuit linked design open dive',
    doc: 'hierarchy.md',
  },
  {
    id: 'atlas',
    title: 'Browse designs in the Atlas',
    intro: 'The Atlas shows every design of the workspace side by side at real size. Linked designs sit next to each other.',
    steps: [
      'Click **Atlas** in the toolbar, or press `Shift+Backspace`.',
      'Drag or scroll to move around, and press `f` to fit all designs.',
      'Press `/` and type to search every design for parts, nets, text, or #tags.',
      'Click a design to pick it. Double-click it, or press `Enter`, to open it.',
      'Press `Shift+Backspace` again to return to the drawing.',
    ],
    keywords: 'atlas workspace overview browse search find designs tags',
    doc: 'atlas.md',
  },
]);

/** A step or introduction as plain text: its markers dropped. */
export function plainGuideText(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

/** A text's runs: plain text, a control (**…**), or a key (`…`). */
export function guideRuns(text) {
  const runs = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) runs.push({ kind: 'text', text: text.slice(at, match.index) });
    runs.push(match[1] !== undefined ? { kind: 'control', text: match[1] } : { kind: 'key', text: match[2] });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ kind: 'text', text: text.slice(at) });
  return runs;
}

/** The link to a guide's deeper doc, if it has one. */
export function guideDocUrl(guide) {
  return guide.doc ? DOCS + guide.doc : null;
}

function searchable(guide) {
  return [guide.title, guide.intro, ...guide.steps, guide.keywords || ''].map(plainGuideText).join(' ').toLowerCase();
}

/** The guides matching every word of the query, those with all the words
 *  in their titles first; an empty query matches every guide, in order. */
export function searchGuides(query, guides = GUIDES) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...guides];
  const found = guides.filter((guide) => {
    const text = searchable(guide);
    return words.every((word) => text.includes(word));
  });
  const inTitle = (guide) => words.every((word) => guide.title.toLowerCase().includes(word));
  return [...found.filter(inTitle), ...found.filter((guide) => !inTitle(guide))];
}
