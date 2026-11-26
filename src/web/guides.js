/**
 * Learn's guides: short how-tos for the common tasks and the tool windows,
 * each a title, a short introduction, numbered steps, and optionally
 * reference sections -- a table (`rows`: [syntax, meaning], the syntax
 * shown as typed) or a list (`items`) -- and related guides (`related`).
 * Each tool window's ? opens its guide (floating-window.js `help`). Pure
 * data and search: help.js draws them. In the text, **Name** is a control
 * on screen, ``text`` something to type, and `key` a key. The tests hold
 * each guide to the program: its controls are in the editor's source, its
 * keys in the keymap, and its syntax tables render or calculate.
 */

const DOCS = 'https://github.com/ojarvin/mosfeteer/blob/main/docs/';

export const GUIDES = Object.freeze([
  {
    id: 'first-circuit',
    title: 'Draw a first circuit',
    intro: 'A drawing is made of parts joined by wires. Wires connect only at their ends and at junction dots, so two wires that cross stay apart.',
    steps: [
      'Click **New** in the toolbar, type a name for the design, and press `Enter` to save it.',
      'Press `i`, type part of a name such as ``nmos`` or ``resistor``, and press `Enter`.',
      'Click on the drawing to place the part. Press `r` to rotate it before you click, and press `Esc` when you are done.',
      'Press `w`, click a pin, and click another pin to join them with a wire. You can also drag from a pin to start a wire.',
      'Insert a ``supply``, a ``ground``, and ``input`` and ``output`` ports in the same way, and wire them to the circuit.',
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
      'Type a size such as ``2u/180n x4`` into the **Size** field, or a value such as ``10k`` into the **Value** field, and press `Enter`.',
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
      'Double-click a block to type its transfer function, such as ``1/s``, or its gain.',
      'Right-click a sum junction and choose **Input polarity** to make one of its inputs negative.',
      'Press `Shift+S` and choose **Signal flow** at the top of the window.',
      'Pick the **Output**, set each source to **Input**, **Zero**, or **Constant**, and click **Derive**.',
      'Click **Plots** to see the responses.',
    ],
    keywords: 'block diagram signal flow loop delta sigma modulator ntf stf transfer function sampler quantizer gain sum integrator downsampler upsampler decimation interpolation multirate',
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
      'Type the phase name, such as ``$\\varphi_1$``, and press `Enter`.',
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
  {
    id: 'notes',
    title: 'Write notes',
    intro: 'Each design keeps notes in Markdown, saved in its file. They can mention parts and nets, link other designs, and hold math, and they are the text of the design\'s report.',
    steps: [
      'Press `Shift+N`, or click **Notes** in the toolbar.',
      'Click **Edit**, or double-click the notes, to write. Press `Esc` to see them rendered.',
      'Type ``@`` to list the parts and nets, or ``[[`` to list the other designs, and press `Enter` to put one in.',
      'Paste a picture, such as a screenshot, into the notes to keep it with the design.',
      'Click **Copy** to put the notes on the clipboard as plain Markdown.',
    ],
    sections: [
      {
        title: 'Text',
        rows: [
          ['# Title', 'A heading. ## and ### start sections under it.'],
          ['Author: Ada Lovelace', 'Who wrote the notes, on the line under the # title. Separate several names with commas.'],
          ['**bold**  *italic*  ~~struck~~', 'Bold, italic, and struck-through text.'],
          ['`code`', 'Code, shown as typed. Three backticks on lines of their own fence a block.'],
          ['- item   1. item', 'A list. Indent a line by two spaces to make a sublist.'],
          ['- [ ] task   - [x] done', 'A task list.'],
          ['> text', 'A quote.'],
          ['| a | b |\n|---|---|\n| 1 | 2 |', 'A table: a header row, a line of dashes, then one row a line.'],
          ['---', 'A rule across the page.'],
          ['[text](https://...)', 'A link to a web page.'],
          ['$V_{out} = g_m R$', 'Math in a line, written in TeX as the labels are.'],
          ['$$ ... $$', 'Math on a line of its own.'],
        ],
      },
      {
        title: 'References',
        rows: [
          ['@M1   @V_{out}', 'A part or net of the design. Hover it to light it up on the drawing, and click it to select it.'],
          ['@{a long name}', 'A part or net whose name has spaces.'],
          ['[[amp]]', 'A link to the design amp. Click it to open amp.'],
          ['![](picture:1)', 'A pasted picture. Text in the brackets is its caption.'],
        ],
      },
      {
        title: 'Keys while writing',
        rows: [
          ['Tab   Shift+Tab', 'Indent or outdent the selected lines.'],
          ['Esc   Ctrl/Cmd+Enter', 'Stop writing and show the notes rendered.'],
        ],
      },
      {
        title: 'Good to know',
        items: [
          'Math is TeX, as in the labels. The **Math** tab of Learn lists what it takes.',
          'Renaming a part or a net renames its mentions. A mention of something that does not exist is struck through.',
          'Each pause in typing is one undo step.',
          'Notes are never drawn or exported with the figure.',
        ],
      },
    ],
    related: ['report'],
    keywords: 'notes markdown text write mention link math tex picture screenshot syntax',
    doc: 'notes-and-history.md',
  },
  {
    id: 'report',
    title: 'Make a report',
    intro: 'A report is the notes set as a printable page with numbered figures from the drawing. A design can include other designs\' notes as sections, so a block diagram and its blocks make one document.',
    steps: [
      'In empty notes, click **Outline** to start from a heading, a contents list, and a figure for each part of the drawing.',
      'Put a figure on a line of its own, such as ``![[circuit|The amplifier.]]``. Type ``![[`` to list what can be shown.',
      'Put a design\'s name on a line of its own, such as ``![[amp]]``, to include its notes as a section.',
      'Click **Report…** in the notes window, or choose **Report** in the export dialog, to write the PDF and the HTML.',
    ],
    sections: [
      {
        title: 'Figures and references',
        rows: [
          ['![[circuit|Caption.]]', 'The drawing without the figures that the tools annotated. The caption is optional.'],
          ['![[drawing]]', 'The whole drawing.'],
          ['![[beat 2]]', 'The circuit as beat 2 shows it, with the timing diagram when one is drawn.'],
          ['![[F2]]   ![[timing]]', 'One annotated figure, such as a plot, an equation table, or the timing diagram.'],
          ['[[#F2]]', 'Reads "Fig. N" and links to that figure.'],
          ['[^https://...|Title]', 'A citation, numbered [1], [2], ... and listed under References at the end.'],
          ['[^doi:10.1000/xyz]', 'A citation by DOI.'],
          ['[TOC]', 'The contents, with the headings numbered.'],
        ],
      },
      {
        title: 'Designs inside designs',
        items: [
          'A line ``![[amp]]`` puts amp\'s notes there as a section. Its headings go one level below the heading the line stands under.',
          'The section\'s figures continue the report\'s numbering, and its citations join the one References list.',
          'Each design is in the report once, where it is first included. Including it again reads "See amp" with a link to that section.',
          'An included design can include others in turn, so sections nest as deep as the designs do.',
          'A design with no notes shows its circuit. Notes that place no figure get the whole drawing at the top.',
          'An included design whose author line names someone else shows that author under its heading.',
          'Renaming a design updates the lines that include it.',
        ],
      },
      {
        title: 'Size and layout',
        items: [
          'The report is set like a LaTeX article: the title and the authors centered at the top, numbered sections, and justified paragraphs.',
          'Figures are drawn at the page guide\'s width, so their text is the guide\'s size. Without a guide, the A4 width is used.',
          'A caption that fits on one line is centered. A longer one is set as a justified paragraph.',
          'Learn → Tutorial → **Report example** opens a finished report to look at.',
        ],
      },
    ],
    related: ['notes', 'export'],
    keywords: 'report pdf html document figure caption citation reference toc contents section embed include nested outline',
    doc: 'notes-and-history.md',
  },
  {
    id: 'history',
    title: 'Go back to an earlier save',
    intro: 'Each design\'s file keeps the drawing as it was at its last ten saves. Pin one as a checkpoint to keep it for good.',
    steps: [
      'Press `Shift+Y`, or choose **History** in the **More** menu.',
      'Click **View** on an entry to see it beside the drawing.',
      'Click **Restore** to bring that drawing back. Undo takes it back again.',
      'Click **⋯** on an entry and choose **Pin as checkpoint** to keep it under a name.',
      'Click **Checkpoint…** to pin the drawing as it is now.',
    ],
    sections: [
      {
        title: 'Good to know',
        items: [
          'Only a Save adds an entry. Restoring an entry adds none, because the entry already holds that drawing.',
          'The entry the file holds now is marked **current version**.',
          'If another program, such as an AI agent, changed the file, the drawing from before that change is marked **before outside edit**. Restore it to undo the change.',
          'The history travels with the file. **Remove save points** clears it, but checkpoints stay.',
        ],
      },
    ],
    related: ['save-open'],
    keywords: 'history save point checkpoint restore undo version earlier revert pin',
    doc: 'notes-and-history.md',
  },
  {
    id: 'calculator',
    title: 'Use the calculator',
    intro: 'The calculator works out one line at a time, with SI suffixes and named values. Its results are saved with the design.',
    steps: [
      'Press `Shift+E` to show the calculator.',
      'Type a line such as ``20*log(123)`` or ``1/(2pi*10k*1n)`` and press `Enter`.',
      'Type ``R = 10k`` to give a value a name, and use the name in later lines.',
      'Press `Up` and `Down` to step through earlier lines. Click a result to put its value in the line.',
      'Type ``clear``, or click **Clear**, to empty the results and forget the names.',
    ],
    sections: [
      {
        title: 'What it reads',
        rows: [
          ['4.7k  10u  2p  1.5meg', 'SI suffixes: f p n u m k meg M G T.'],
          ['+ - * / ^', 'Arithmetic. ^ is a power, and 2pi or 3(4+5) multiply.'],
          ['5%   10 % 3', 'A percent after a number, a remainder between two.'],
          ['log  ln  log2  exp  sqrt', 'Logarithms and roots: log is base 10, and ln is natural.'],
          ['sin  cos  atan2  sinh', 'Trigonometric functions, in radians.'],
          ['db(x)  undb(x)', 'Decibels: 20 log10 |x|, and back.'],
          ['min  max  abs  round  hypot', 'And floor, ceil, sign, and n!.'],
          ['pi  e  ans', 'Constants, and ans for the last result.'],
        ],
      },
    ],
    keywords: 'calculator calculate arithmetic math number si unit formula db',
  },
  {
    id: 'plots',
    title: 'Look into plots',
    intro: 'The Plots window shows the analysis results as graphs: Bode plots for a circuit, and responses, steps, and swings for a block diagram. Every plot can be zoomed and read.',
    steps: [
      'Click **Derive** in the analysis window, or press `Shift+W` to show the Plots window.',
      'Drag to pan. Right-drag a box to zoom to it, and right-click to zoom back out one step.',
      'Hold the pointer over a curve to read its value.',
      'Double-click, or click **Fit**, to see the whole plot again.',
      'Click **Annotate** to put the plot on the drawing.',
    ],
    sections: [
      {
        title: 'Zoom keys',
        rows: [
          ['Ctrl/Cmd+wheel', 'Zoom about the pointer. Add Shift for x only, or Alt for y only.'],
          ['Right-drag flat', 'A flat box zooms along x only, and a tall one along y only.'],
        ],
      },
      {
        title: 'Good to know',
        items: [
          'For a circuit, the numbers a Bode plot uses are under **Values** in the analysis window.',
          'Right-click a plot on the drawing and choose **Plot settings…**, or double-click it, to add traces from files, show or hide curves, and place markers.',
        ],
      },
    ],
    related: ['small-signal', 'signal-flow', 'annotate'],
    keywords: 'plot graph bode zoom pan fit curve read value marker axis',
    doc: 'figures.md',
  },
  {
    id: 'data-plot',
    title: 'Plot data from a file',
    intro: 'A data plot draws columns of a text file, such as a simulation export, on the drawing. The design keeps the traces, so the file is read only once.',
    steps: [
      'Choose **Data plot…** in the **More** menu and pick a CSV or text file.',
      'Check how the file reads: the separator, the decimal sign, and **Rows before the data** are guessed, and you can change each.',
      'Under **Y columns**, tick the columns to plot.',
      'Set each axis\'s name and **Scale**, and each trace\'s name and color.',
      'Click **Apply** to draw the plot. Later, double-click the plot to open these settings again.',
    ],
    sections: [
      {
        title: 'Good to know',
        items: [
          '**Add file…** adds a second file\'s traces to the same plot. **Replace file…** puts new traces in place of the old ones.',
          '**Markers** put numbered points on a trace, with their readings.',
          'The plot keeps the zoom that is shown when you apply.',
        ],
      },
    ],
    related: ['plots'],
    keywords: 'data plot csv file column import simulation trace marker',
    doc: 'figures.md',
  },
  {
    id: 'optimize',
    title: 'Optimize coefficients',
    intro: 'The optimizer searches a block diagram\'s free coefficients for the best result that keeps every limit, such as the least in-band noise of a modulator with a bounded NTF peak.',
    steps: [
      'Derive the block diagram in the analysis window in **Signal flow** mode.',
      'Under **Optimize coefficients**, mark each coefficient **Free** or **Fixed**, and give a range where it needs one.',
      'Click **Add spec** to add a goal or a limit, such as the NTF peak below 3.5 dB.',
      'Type relations the coefficients must keep under **Constraints**, and set up the swing test if the signals must stay in range.',
      'Click **Run**. The run window shows where it started in gray and the best so far in color.',
      'When the run is done, click **Apply** to use the best coefficients, or **Revert** to go back.',
    ],
    sections: [
      {
        title: 'Good to know',
        items: [
          'Closing the run window leaves the run going. Its progress shows in the analysis window.',
          'Tick **Make the free coefficients fractions m/n** to have the run give simple fractions.',
        ],
      },
    ],
    related: ['signal-flow'],
    keywords: 'optimize optimizer coefficient search spec goal limit constraint swing modulator ntf',
    doc: 'signal-flow-analysis.md',
  },
  {
    id: 'reference',
    title: 'Show another design beside the drawing',
    intro: 'A reference window shows another design of the workspace, or a picture, next to the one you edit. It is for looking only, and it follows the other design\'s file as that is saved.',
    steps: [
      'Press `Shift+V` to show the reference windows, and pick a design from the list in the window\'s title.',
      'Scroll or pinch to zoom and drag to pan. Right-drag a box to zoom to it.',
      'Click the swap button to open that design in the editor, which moves the current one into the window.',
      'To show a picture, such as a datasheet figure, paste it while the pointer is over the window.',
      'Click the copy button to put what the window shows on the clipboard as a picture.',
    ],
    sections: [
      {
        title: 'Good to know',
        items: [
          'The windows each design shows are saved with that design.',
          'Select a part that links to a design and press `o` to show the linked design in a window.',
        ],
      },
    ],
    related: ['link'],
    keywords: 'reference window another design side by side picture datasheet compare',
    doc: 'hierarchy.md',
  },
]);

const RUN = /\*\*(.+?)\*\*|``(.+?)``|`(.+?)`/g;

/** A step or introduction as plain text: its markers dropped. */
export function plainGuideText(text) {
  return text.replace(RUN, (_, control, typed, key) => control ?? typed ?? key);
}

/** A text's runs: plain text, a control (**…**), something to type
 *  (``…``), or a key (`…`). */
export function guideRuns(text) {
  const runs = [];
  let at = 0;
  for (const match of text.matchAll(RUN)) {
    if (match.index > at) runs.push({ kind: 'text', text: text.slice(at, match.index) });
    runs.push(match[1] !== undefined ? { kind: 'control', text: match[1] } : match[2] !== undefined ? { kind: 'typed', text: match[2] } : { kind: 'key', text: match[3] });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ kind: 'text', text: text.slice(at) });
  return runs;
}

/** The link to a guide's deeper doc, if it has one. */
export function guideDocUrl(guide) {
  return guide.doc ? DOCS + guide.doc : null;
}

/** A guide's reference sections as text: titles, table cells, items. */
function sectionTexts(guide) {
  return (guide.sections || []).flatMap((section) => [section.title, ...(section.rows || []).flat(), ...(section.items || [])]);
}

function searchable(guide) {
  return [guide.title, guide.intro, ...guide.steps, ...sectionTexts(guide), guide.keywords || ''].map(plainGuideText).join(' ').toLowerCase();
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
