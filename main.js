require.config({
  paths: {
    vs: "https://unpkg.com/monaco-editor@0.45.0/min/vs"
  }
});

require(["vs/editor/editor.main"], function () {

  // --- 1. EDITOR CONFIGURATION ---
  const editor = monaco.editor.create(
    document.getElementById("editor"),
    {
      value: "",
      language: "python",
      theme: "vs-dark",
      fontSize: 17, 
      lineHeight: 26,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 20, bottom: 20 },
      automaticLayout: true,
      autoClosingBrackets: "never",
      autoClosingQuotes: "never",
      autoSurround: "never",
      fontFamily: "'Roboto Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontLigatures: true,
      cursorBlinking: "phase", 
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true
    }
  );

  const model = editor.getModel();
  const tabSize = editor.getOption(monaco.editor.EditorOption.tabSize) || 4;

  // --- 2. QUESTION STREAMING LOGIC ---
  const QUESTION_TEXT = "Implement a Neural Network in python from scratch.";
  
  function streamQuestion() {
      const display = document.getElementById("question-display");
      if (!display) return;
      
      let i = 0;
      const speed = 30; 

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
      setTimeout(type, 500);
  }

  streamQuestion();

  // --- 3. CACHE STORE ---
  // originCode: The editor content exactly when the ghost text was generated.
  // fullGhostText: The generated ghost text (including instructions).
  let activeCache = {
      originCode: null,   
      fullGhostText: null 
  };

  // --- 4. INLINE GHOST CLASS ---
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
        // IMPORTANT: Clear cache on full accept because we used it up
        activeCache = { originCode: null, fullGhostText: null };
      }
      this.hide();
    }

    // --- SYNTAX HIGHLIGHTER ---
    highlightPython(code) {
        const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        let html = esc(code);

        html = html.replace(/("[^"]*"|'[^']*')/g, '<span class="ghost-string">$1</span>');

        const keywords = ["def", "class", "return", "import", "from", "if", "else", "elif", "for", "while", "try", "except", "with", "as", "pass", "lambda", "is", "in", "not", "and", "or", "None", "True", "False"];
        keywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b(?![^<]*>)`, 'g');
            html = html.replace(regex, `<span class="ghost-keyword">${kw}</span>`);
        });

        html = html.replace(/(\w+)(?=\()/g, '<span class="ghost-function">$1</span>');
        html = html.replace(/\b(\d+)\b(?![^<]*>) /g, '<span class="ghost-number">$1</span>');

        return html;
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
        const visibleText = i === this.lineIndex ? fullLineText.slice(this.colConsumed) : fullLineText;
        const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        if (this.isMismatch) {
            node.style.color = "#ff3333"; 
            node.style.textDecoration = "line-through";
            node.style.opacity = "0.9";
            node.textContent = visibleText;
        } else {
            node.style.textDecoration = "none";
            node.style.opacity = "1.0";
            
            if (visibleText.includes("# [INSTRUCTION]")) {
                const parts = visibleText.split("# [INSTRUCTION]");
                const codePart = parts[0];
                const instructionPart = "# [INSTRUCTION]" + parts.slice(1).join("# [INSTRUCTION]");
                
                node.innerHTML = this.highlightPython(codePart) + `<span class="ghost-instruction">${esc(instructionPart)}</span>`;
            } 
            else if (visibleText.includes("#")) {
                const commentIndex = visibleText.indexOf("#");
                const codePart = visibleText.substring(0, commentIndex);
                const commentPart = visibleText.substring(commentIndex);
                node.innerHTML = this.highlightPython(codePart) + `<span class="ghost-comment">${esc(commentPart)}</span>`;
            } 
            else {
                node.innerHTML = this.highlightPython(visibleText);
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

  // --- 5. HELPER FUNCTIONS ---

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

  function removeOverlap(inputCode, ghostText) {
      if (!ghostText) return "";
      const inputLines = inputCode.split('\n');
      const lastInputLine = inputLines[inputLines.length - 1]; 
      
      if (lastInputLine.length > 0 && ghostText.startsWith(lastInputLine)) {
          return ghostText.slice(lastInputLine.length);
      }
      const lastTrimmed = lastInputLine.trim();
      if (lastTrimmed.length > 3) {
          const matchIndex = ghostText.indexOf(lastTrimmed);
          if (matchIndex >= 0 && matchIndex < lastInputLine.length + 5) {
               return ghostText.slice(matchIndex + lastTrimmed.length);
          }
      }
      return ghostText;
  }

  async function fetchGhostText(currentCode, currentCursor, mode) {
     const problem = document.getElementById("question-display").innerText; 
     const codeContext = sliceCodeUpToCursor(currentCode, currentCursor);

     // INJECT INSTRUCTION PROMPT
     let augmentedProblem = problem;
     const INSTRUCTION_PROMPT = 
        "\n[SYSTEM]: Generate the next logical chunk of python code. " +
        "CRITICAL: End your response with a python comment on a new line " +
        "starting with '# [INSTRUCTION]: ' that explains exactly what step the user should implement next.";

     augmentedProblem += INSTRUCTION_PROMPT;

     try {
        const res = await fetch("http://localhost:3000/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problem: augmentedProblem, 
            language: "python",
            code: codeContext,
            mode: mode 
          })
        });
        const data = await res.json();
        let rawGhost = data.ghost || "";

        if (!rawGhost) return null;

        const cleanGhost = removeOverlap(codeContext, rawGhost);
        return cleanGhost ? cleanGhost : null;
     } catch (e) {
        return null;
     }
  }

  // --- 6. CORE ACTIONS ---

  // ACTION 1: TRIGGER / GENERATE (Ctrl + Space)
  async function generateSingleBlock() {
    if (window.ghostEnabled) return; 

    const currentPos = editor.getPosition();
    const fullCurrentCode = editor.getValue();
    const codeContext = sliceCodeUpToCursor(fullCurrentCode, currentPos);

    // Cache Check
    if (activeCache.originCode && activeCache.fullGhostText) {
         if (codeContext.startsWith(activeCache.originCode)) {
             const userProgress = codeContext.slice(activeCache.originCode.length);
             const normProgress = userProgress.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
             const normGhost = activeCache.fullGhostText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

             if (normGhost.startsWith(normProgress)) {
                 const remainingGhost = activeCache.fullGhostText.slice(userProgress.length);
                 if (remainingGhost.length > 0) {
                     console.log("⚡ Cache Hit: Generating from cache");
                     ghost.show(remainingGhost);
                     window.ghostEnabled = true;
                     return;
                 }
             }
         }
    }

    // Cache Miss -> Fetch
    // NOTE: We do NOT clear activeCache here immediately. 
    // We only overwrite it if the fetch succeeds.
    const text = await fetchGhostText(editor.getValue(), editor.getPosition(), 'chunk');
    
    if (text) {
       console.log("⚡ API Fetch Success. Updating Cache.");
       activeCache = { originCode: codeContext, fullGhostText: text };
       ghost.show(text);
       window.ghostEnabled = true;
    }
  }

  // ACTION 2: TOGGLE VISIBILITY (Ctrl + Shift + X)
  async function toggleGhostVisibility() {
    if (window.ghostEnabled) {
      // HIDE
      ghost.hide(true);
      window.ghostEnabled = false;
    } else {
      // SHOW (CACHE STRATEGY)
      const currentPos = editor.getPosition();
      const fullCurrentCode = editor.getValue();
      const codeContext = sliceCodeUpToCursor(fullCurrentCode, currentPos);

      // 1. Try Cache First
      if (activeCache.originCode && activeCache.fullGhostText) {
         const cleanContext = codeContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
         const cleanOrigin = activeCache.originCode.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

         if (cleanContext.startsWith(cleanOrigin)) {
             const userProgress = cleanContext.slice(cleanOrigin.length);
             const cleanGhost = activeCache.fullGhostText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

             if (cleanGhost.startsWith(userProgress)) {
                 const remainingGhost = activeCache.fullGhostText.slice(userProgress.length);
                 
                 // Show whatever is remaining
                 ghost.show(remainingGhost);
                 window.ghostEnabled = true;
                 return;
             }
         }
      } 
      
      // 2. Fallback: If cache fails, trigger generation (act like Ctrl+Space)
      console.log("⚠️ Toggle: Cache miss/mismatch. Falling back to Generation.");
      await generateSingleBlock();
    }
  }

  // ACTION 3: NEXT STEP (Ctrl + DownArrow)
  async function triggerNextStep() {
    const currentGhostLines = window.ghostEnabled ? [...ghost.lines] : [];
    
    let combinedCode = editor.getValue();
    if (currentGhostLines.length > 0) {
        combinedCode += "\n" + currentGhostLines.join("\n");
    }

    const lines = combinedCode.split("\n");
    const projectedCursor = { 
        lineNumber: lines.length, 
        column: lines[lines.length - 1].length + 1 
    };

    const newStepText = await fetchGhostText(combinedCode, projectedCursor, 'step');
    
    if (newStepText) {
        let finalGhostText = "";
        
        if (currentGhostLines.length > 0) {
            finalGhostText = currentGhostLines.join("\n") + "\n" + newStepText;
        } else {
            finalGhostText = newStepText;
        }

        // UPDATE CACHE:
        // We must update 'activeCache' with the NEW full text so toggling works
        const currentPos = editor.getPosition();
        const currentContext = sliceCodeUpToCursor(editor.getValue(), currentPos);
        
        console.log("⚡ Extended. Updating Cache.");
        activeCache = { originCode: currentContext, fullGhostText: finalGhostText };

        ghost.show(finalGhostText);
        window.ghostEnabled = true;
    }
  }

  // --- 7. KEYBINDINGS ---

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, generateSingleBlock);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyX, toggleGhostVisibility);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.DownArrow, triggerNextStep);

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