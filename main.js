require.config({
  paths: {
    vs: "https://unpkg.com/monaco-editor@0.45.0/min/vs"
  }
});

require(["vs/editor/editor.main"], function () {

  const editor = monaco.editor.create(
    document.getElementById("editor"),
    {
      value: "",
      language: "python",
      theme: "vs-dark",
      fontSize: 25, // Slightly larger for better readability
      lineHeight: 26,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 20, bottom: 20 }, // More breathing room
      automaticLayout: true,
      autoClosingBrackets: "never",
      autoClosingQuotes: "never",
      autoSurround: "never",
      // Use a clean monospace font stack
      fontFamily: "'Roboto Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontLigatures: true,
      cursorBlinking: "phase", // Smoother cursor blinking
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true
    }
  );

  const model = editor.getModel();
  const tabSize = editor.getOption(monaco.editor.EditorOption.tabSize) || 4;

  // --- QUESTION STREAMING LOGIC ---
  const QUESTION_TEXT = "Implement a Neural Network in python from scratch.";
  
  function streamQuestion() {
      const display = document.getElementById("question-display");
      let i = 0;
      const speed = 30; // Slightly slower for a more deliberate data stream feel

      function type() {
          if (i < QUESTION_TEXT.length) {
              display.textContent += QUESTION_TEXT.charAt(i);
              i++;
              
              let cursor = document.getElementById("cursor-caret");
              if(!cursor) {
                  cursor = document.createElement("span");
                  cursor.id = "cursor-caret";
                  cursor.className = "cursor";
                  display.appendChild(cursor);
              } else {
                  display.appendChild(cursor);
              }
              
              setTimeout(type, speed);
          }
      }
      // Small delay before starting the stream for dramatic effect
      setTimeout(type, 500);
  }

  streamQuestion();
  // -------------------------------

  class InlineGhost {
    constructor(editor) {
      this.editor = editor;
      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.nodes = [];
      this.indentText = "";
      
      const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);
      this.fontInfo = fontInfo;
      this.charWidth = fontInfo.typicalHalfwidthCharacterWidth;
      this.lineHeight = fontInfo.lineHeight;
    }

    stripComment(text) {
        if (!text) return "";
        if (text.trim().startsWith('#')) return "";
        return text.split('  # ')[0]; 
    }

    createNode() {
      const node = document.createElement("div");
      node.className = "ghost-text";
      node.style.position = "absolute";
      node.style.pointerEvents = "none";
      node.style.whiteSpace = "pre";
      node.style.fontFamily = this.fontInfo.fontFamily;
      node.style.fontSize = `${this.fontInfo.fontSize}px`;
      node.style.lineHeight = `${this.fontInfo.lineHeight}px`;
      node.style.zIndex = "10"; 
      this.editor.getDomNode().appendChild(node);
      return node;
    }

    computeIndent() {
      const lineText = model.getLineContent(this.lockedPosition.lineNumber);
      const leading = lineText.match(/^\s*/)?.[0] ?? "";
      const needsBlockIndent = lineText.trimEnd().endsWith(":");
      this.indentText = leading + (needsBlockIndent ? " ".repeat(tabSize) : "");
    }

    ensureLinesExist(count) {
      const insertAt = this.lockedPosition.lineNumber;
      const needed = count - 1;
      if (needed <= 0) return;
      model.applyEdits([{
          range: new monaco.Range(insertAt, model.getLineMaxColumn(insertAt), insertAt, model.getLineMaxColumn(insertAt)),
          text: "\n".repeat(needed),
          forceMoveMarkers: true
      }]);
    }

    append(newText) {
       if (!newText) return;
       const newLines = newText.replace(/\r/g, "").split("\n");
       this.lines = this.lines.concat(newLines);
       this.ensureLinesExist(this.lines.length);
       newLines.forEach(() => this.nodes.push(this.createNode()));
       this.updatePosition();
    }

    show(text) {
      this.hide(false);
      this.lines = text.replace(/\r/g, "").split("\n");
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.lockedPosition = this.editor.getPosition();
      this.anchorPosition = this.lockedPosition;
      this.computeIndent();
      this.ensureLinesExist(this.lines.length);
      this.editor.setPosition(this.lockedPosition);
      this.editor.focus();
      this.lines.forEach(() => this.nodes.push(this.createNode()));
      this.updatePosition();
    }

    hide(restoreCaret = true) {
      this.nodes.forEach(n => n.remove());
      this.nodes = [];
      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.indentText = "";
      if (window.ghostEnabled) window.ghostEnabled = false;
    }

    accept() {
      if (!this.anchorPosition) return;
      const rawRemainingLines = this.lines.slice(this.lineIndex);
      const cleanLines = rawRemainingLines.map(line => this.stripComment(line) || line);
      const fullCleanText = cleanLines.join("\n");
      const textToInsert = fullCleanText.slice(this.colConsumed);

      if (textToInsert) {
        this.editor.trigger('keyboard', 'type', { text: textToInsert });
      }
      this.hide();
    }

    updatePosition() {
      if (!this.anchorPosition) return;

      const cursorPosition = this.editor.getPosition();
      const cursorCoords = this.editor.getScrolledVisiblePosition(cursorPosition);
      const startOfLine = this.editor.getScrolledVisiblePosition({
        lineNumber: this.anchorPosition.lineNumber + this.lineIndex,
        column: 1
      });

      if (!cursorCoords || !startOfLine) return;

      this.nodes.forEach((node, i) => {
        if (i < this.lineIndex) {
          node.textContent = "";
          return;
        }

        const fullLineText = this.lines[i] ?? "";
        const codeOnly = this.stripComment(fullLineText);
        const isFullComment = fullLineText.trim().startsWith('#');
        
        if (i === this.lineIndex) {
            if (this.colConsumed >= codeOnly.length && !this.isMismatch && !isFullComment) {
                 node.textContent = ""; 
                 return;
            }
        }

        const visibleText = i === this.lineIndex ? fullLineText.slice(this.colConsumed) : fullLineText;

        // --- UPDATED COLORS FOR DARK MODE (MORE VIBRANT) ---
        if (this.isMismatch) {
            node.style.color = "#ff3333"; // Neon Red
            node.style.textDecoration = "line-through";
            node.style.opacity = "0.9";
             // Subtle red glow
             node.style.textShadow = "0 0 5px rgba(255, 51, 51, 0.5)";
            node.textContent = visibleText;
        } else {
            node.style.textDecoration = "none";
            node.style.opacity = "1.0";
             // Reset glow for normal text
             node.style.textShadow = "none";
            const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            if (isFullComment) {
                node.style.color = "#4ec9b0"; // VScode style green/teal
                node.textContent = visibleText;
            } else {
                const commentStartIndex = codeOnly.length;
                const relativeSplitIndex = commentStartIndex - (i === this.lineIndex ? this.colConsumed : 0);

                if (relativeSplitIndex >= visibleText.length) {
                     node.style.color = "#4ec9b0";
                    node.textContent = visibleText;
                } else if (relativeSplitIndex <= 0) {
                    // Suggested Code Color: Luminous Orange
                    node.style.color = "#ff9e45"; 
                    // Add back the glow for suggested code
                    node.style.textShadow = "0 0 8px rgba(255, 158, 69, 0.6)";
                    node.textContent = visibleText;
                } else {
                    const partCode = visibleText.slice(0, relativeSplitIndex);
                    const partComment = visibleText.slice(relativeSplitIndex);
                    // Code: Glowing Orange, Comment: Teal
                    node.innerHTML = `<span style="color: #ff9e45; text-shadow: 0 0 8px rgba(255, 158, 69, 0.6);">${esc(partCode)}</span><span style="color: #4ec9b0">${esc(partComment)}</span>`;
                }
            }
        }

        const topOffset = (i - this.lineIndex) * this.lineHeight;
        node.style.top = `${cursorCoords.top + topOffset}px`;

        if (i === this.lineIndex) {
           node.style.left = `${cursorCoords.left}px`;
        } else {
           const left = startOfLine.left; 
           node.style.left = `${left}px`;
        }
      });
    }

    onType() {
      if (!this.lines.length) return;

      const pos = this.editor.getPosition();
      const expectedLine = this.lockedPosition.lineNumber + this.lineIndex;

      if (pos.lineNumber > expectedLine) {
        this.lineIndex++;
        this.colConsumed = 0;
        this.isMismatch = false; 
        this.updatePosition();
        return;
      }

      const lineText = model.getLineContent(pos.lineNumber);
      const baseColumn = this.lineIndex === 0 ? this.lockedPosition.column - 1 : 0;
      const typed = lineText.slice(baseColumn, pos.column - 1);
      const ghostLine = this.lines[this.lineIndex] ?? "";
      const codePart = this.stripComment(ghostLine);

      if (codePart === "" && typed.length > 0) {
          this.isMismatch = true;
      } else {
          let i = 0;
          while (i < typed.length && i < codePart.length && typed[i] === codePart[i]) {
            i++;
          }
          this.colConsumed = i;
          this.isMismatch = typed.length > i;
      }

      this.updatePosition();
    }
  }

  const ghost = new InlineGhost(editor);
  window.ghostEnabled = false;

  function sliceCodeUpToCursor(text, cursor) {
    const lines = text.split('\n');
    const limitLineIndex = cursor.lineNumber - 1; 
    
    if (limitLineIndex < 0) return "";
    if (limitLineIndex >= lines.length) return text;
    
    const preLines = lines.slice(0, limitLineIndex);
    const currentLine = lines[limitLineIndex];
    const preCurrentLine = currentLine.slice(0, cursor.column - 1);
    
    preLines.push(preCurrentLine);
    return preLines.join('\n');
  }

  async function fetchGhostText(currentCode, currentCursor, mode) {
     const problem = document.getElementById("question-display").innerText; 
     
     const codeContext = sliceCodeUpToCursor(currentCode, currentCursor);

     try {
        const res = await fetch("http://localhost:3000/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problem,
            language: "python",
            code: codeContext,
            mode: mode
          })
        });
        const data = await res.json();
        let rawGhost = data.ghost || "";

        if (!rawGhost.trim()) return null;

        const contextLines = codeContext.split('\n');
        const lastInputLine = contextLines[contextLines.length - 1].trim();

        if (lastInputLine.length > 3 && rawGhost.trim().startsWith(lastInputLine)) {
            const cutIndex = rawGhost.indexOf(lastInputLine) + lastInputLine.length;
            rawGhost = rawGhost.slice(cutIndex).trimStart();
        }

        return rawGhost ? rawGhost : null;
     } catch (e) {
        return null;
     }
  }

  async function toggleGhost(mode = 'chunk') {
    if (window.ghostEnabled) {
      ghost.hide(true);
      window.ghostEnabled = false;
      return;
    }
    const text = await fetchGhostText(editor.getValue(), editor.getPosition(), mode);
    if (text) {
       ghost.show(text);
       window.ghostEnabled = true;
    }
  }

  async function extendGhost() {
     if (!window.ghostEnabled || !ghost.lines.length) return;
     const combinedCode = editor.getValue() + "\n" + ghost.lines.join("\n");
     const lines = combinedCode.split("\n");
     const projectedCursor = { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
     
     const nextPart = await fetchGhostText(combinedCode, projectedCursor, 'chunk');
     if (nextPart) ghost.append("\n" + nextPart);
  }

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => toggleGhost('chunk'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space, () => toggleGhost('full'));

  editor.addCommand(monaco.KeyCode.F8, extendGhost);

  editor.addCommand(monaco.KeyCode.Tab, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.accept();
    } else {
      editor.trigger('keyboard', 'tab', null);
    }
  });

  editor.addCommand(monaco.KeyCode.Escape, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.hide();
      window.ghostEnabled = false;
    }
  });

  editor.onDidChangeModelContent((e) => {
    if (window.ghostEnabled && ghost.anchorPosition && !e.isFlush) {
       ghost.onType();
    }
  });

  editor.onDidScrollChange(() => {
    if (window.ghostEnabled) ghost.updatePosition();
  });
});