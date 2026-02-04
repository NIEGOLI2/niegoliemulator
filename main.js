(function () {
    const romInput = document.getElementById('rom-input');
    const btnLoadRom = document.getElementById('btn-load-rom');
    const localRomSelect = document.getElementById('local-rom-select');
    const coreSelect = document.getElementById('core-select');
    const btnPause = document.getElementById('btn-pause');
    const btnReset = document.getElementById('btn-reset');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnSettings = document.getElementById('btn-settings');
    const overlay = document.getElementById('emulator-overlay');
    const dropHint = document.getElementById('drop-hint');

    // Removed local "Project Files" ROM selector and its population logic.

    const corruptionByteCount = document.getElementById('corrupt-byte-count');
    const corruptionMode = document.getElementById('corrupt-mode');
    const corruptionTarget = document.getElementById('corrupt-target');
    const btnCorrupt = document.getElementById('btn-corrupt');
    const btnCorruptX2 = document.getElementById('btn-corrupt-x2');

    // Active corruption controls
    const corruptActiveToggle = document.getElementById('corrupt-active-toggle');
    const corruptSecondsInput = document.getElementById('corrupt-seconds');
    const corruptButtonsRow = document.getElementById('corrupt-buttons-row');

    // Active corruption state
    let activeCorruptInterval = null;
    let activeCorruptRemaining = 0;

    function setCorruptButtonsVisibility(visible) {
        if (!corruptButtonsRow) return;
        corruptButtonsRow.style.display = visible ? 'flex' : 'none';
    }

    function startActiveCorruption() {
        const seconds = parseFloat(corruptSecondsInput.value) || 1;
        // Hide manual buttons when active
        setCorruptButtonsVisibility(false);

        // Clear any existing interval
        stopActiveCorruption();

        // Set timer to call corruption every N seconds
        activeCorruptRemaining = seconds;
        activeCorruptInterval = setInterval(() => {
            // Perform one corruption tick
            try {
                const mode = corruptionMode.value || 'bitflip';
                const target = corruptionTarget ? (corruptionTarget.value || 'ram') : 'ram';
                const raw = corruptionByteCount.value;
                let count = parseInt(raw, 10);
                if (!Number.isFinite(count) || count <= 0) count = 1;
                if (window.MemoryCorruptor) {
                    window.MemoryCorruptor.corrupt(mode, count, target);
                }
            } catch (e) {
                console.warn('Active corruption tick failed:', e);
            }
            // reset remaining (not strictly needed since interval repeats)
            activeCorruptRemaining = seconds;
        }, seconds * 1000);
    }

    function stopActiveCorruption() {
        if (activeCorruptInterval) {
            clearInterval(activeCorruptInterval);
            activeCorruptInterval = null;
        }
        // Show manual buttons again
        setCorruptButtonsVisibility(true);
    }

    // Toggle handler
    if (corruptActiveToggle) {
        corruptActiveToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                startActiveCorruption();
            } else {
                stopActiveCorruption();
            }
        });
    }





    let isPaused = false;
    let currentCore = null;

    // Map system selection values to core package names
    const CORE_PACKAGE_MAP = {
        "": "@emulatorjs/emulatorjs",
        "n64": "@emulatorjs/core-mupen64plus_next",
        "gb": "@emulatorjs/core-gambatte",
        "gba": "@emulatorjs/core-mgba",
        "nds": "@emulatorjs/core-desmume2015",
        "nes": "@emulatorjs/core-fceumm",
        "snes": "@emulatorjs/core-snes9x",
        "psx": "@emulatorjs/core-mednafen_psx_hw",
        "vb": "@emulatorjs/core-beetle_vb",
        "segaMD": "@emulatorjs/core-genesis_plus_gx",
        "segaMS": "@emulatorjs/core-smsplus",
        "segaCD": "@emulatorjs/core-picodrive",
        "lynx": "@emulatorjs/core-handy",
        "sega32x": "@emulatorjs/core-genesis_plus_gx",
        "jaguar": "@emulatorjs/core-virtualjaguar",
        "segaGG": "@emulatorjs/core-genesis_plus_gx",
        "segaSaturn": "@emulatorjs/core-yabause",
        "atari7800": "@emulatorjs/core-a5200",
        "atari2600": "@emulatorjs/core-stella2014",
        "pce": "@emulatorjs/core-mednafen_pce",
        "pcfx": "@emulatorjs/core-mednafen_pcfx",
        "ngp": "@emulatorjs/core-mednafen_ngp",
        "ws": "@emulatorjs/core-mednafen_wswan",
        "coleco": "@emulatorjs/core-gearcoleco",
        "vice_x64": "@emulatorjs/core-vice_x64",
        "vice_x64sc": "@emulatorjs/core-vice_x64sc",
        "vice_x128": "@emulatorjs/core-vice_x128",
        "vice_xpet": "@emulatorjs/core-vice_xpet",
        "vice_xplus4": "@emulatorjs/core-vice_xplus4",
        "vice_xvic": "@emulatorjs/core-vice_xvic",
        "mame2003": "@emulatorjs/core-mame2003",
        "mame2003_plus": "@emulatorjs/core-mame2003_plus",
        "fbalpha2012_cps1": "@emulatorjs/core-fbalpha2012_cps1",
        "fbalpha2012_cps2": "@emulatorjs/core-fbalpha2012_cps2",
        "prosystem": "@emulatorjs/core-prosystem",
        "opera": "@emulatorjs/core-opera",
        "melonds": "@emulatorjs/core-melonds",
        "desmume": "@emulatorjs/core-desmume",
        "pc": "@emulatorjs/emulatorjs",
        "ppsspp": "@emulatorjs/core-ppsspp",
        "fbneo": "@emulatorjs/core-fbneo",
        "puae": "@emulatorjs/core-puae",
        "fuse": "@emulatorjs/core-fuse",
        "cap32": "@emulatorjs/core-cap32",
        "crocods": "@emulatorjs/core-crocods",
        "prboom": "@emulatorjs/core-prboom"
    };

    // --- Core detection logic borrowed from emulatorjs.html ---
    // Returns a specific core id when recognized, otherwise returns null so the UI can request manual selection.
    async function detectCoreFromExt(ext) {
        ext = (ext || '').toLowerCase();

        if (["fds", "nes", "unif", "unf"].includes(ext))
            return "nes";

        if (["smc", "fig", "sfc", "gd3", "gd7", "dx2", "bsx", "swc"].includes(ext))
            return "snes";

        if (["z64", "n64"].includes(ext))
            return "n64";

        if (["pce"].includes(ext))
            return "pce";

        if (["ngp", "ngc"].includes(ext))
            return "ngp";

        if (["ws", "wsc"].includes(ext))
            return "ws";

        if (["col", "cv"].includes(ext))
            return "coleco";

        if (["d64"].includes(ext))
            return "vice_x64sc";

        if (["md", "sg", "smd", "gen"].includes(ext))
            return "segaMD";

        if (["nds", "gba", "gb"].includes(ext))
            return ext;

        // If extension isn't in a recognized list, return null to prompt manual selection when AUTO CORE is in use.
        return null;
    }

    // --- Main loader that mirrors emulatorjs.html's run(upload) behavior ---
    async function runWithFile(file) {
        if (!file) return;

        // Clean up previous EmulatorJS instance if any
        if (window.EJS_emulator) {
            try {
                if (typeof window.EJS_emulator.exit === 'function') {
                    window.EJS_emulator.exit();
                } else if (typeof window.EJS_emulator.callEvent === 'function') {
                    window.EJS_emulator.callEvent('exit');
                }
            } catch (e) {
                // ignore teardown errors
            }
            // Best-effort cleanup of global references
            delete window.EJS_emulator;
            delete window.Module;
        }

        // Create an URL / nameParts for the ROM file (support both File objects and in-project path strings)
        let url;
        let nameParts;
        // Determine a safe display name for the file (works for strings and File objects)
        const displayName = (typeof file === "string") ? file.split("/").pop() : (file && file.name ? file.name : "unknown");

        if (typeof file === "string") {
            // Use a relative path string to project file
            url = file;
            nameParts = displayName.split(".");
        } else {
            // File-like object (from <input> or drag/drop)
            url = file;
            nameParts = displayName.split(".");
        }
        const ext = (nameParts.pop() || "").toLowerCase();

        // Use explicitly chosen core if provided, otherwise auto-detect
        let core = currentCore;
        if (!core) {
            core = await detectCoreFromExt(ext);
        }

        // If we are in AUTO CORE (no explicit selection) and the detection returned null (unrecognized)
        // prompt the user with a modal to pick a core manually before continuing.
        if (!currentCore && !core) {
            try {
                core = await promptUserForCore();
                // If user cancelled selection, abort
                if (!core) {
                    console.log("User cancelled manual core selection.");
                    return;
                }
            } catch (e) {
                console.warn("Manual core selection failed or was cancelled:", e);
                return;
            }
        }

        // Expose mapped core package for loader/installer (if needed by other scripts)
        try {
            window.EJS_corePackage = CORE_PACKAGE_MAP[core] || CORE_PACKAGE_MAP[""] || "@emulatorjs/emulatorjs";
            console.log("Selected core:", core, "-> package:", window.EJS_corePackage);
        } catch (e) {
            window.EJS_corePackage = "@emulatorjs/emulatorjs";
        }

        // Prepare EmulatorJS container inside our layout
        const emuRoot = document.getElementById('emulator');
        if (!emuRoot) return;
        emuRoot.innerHTML = '';

        const sub = document.createElement('div');
        sub.id = 'game';
        emuRoot.appendChild(sub);

        // Configure EmulatorJS globals like emulatorjs.html does
        window.EJS_player = "#game";
        // Use our safe displayName here
        window.EJS_gameName = nameParts.join(".") || displayName;
        window.EJS_biosUrl = "";
        window.EJS_gameUrl = url;
        window.EJS_core = core;
        window.EJS_pathtodata = "./";
        window.EJS_startOnLoaded = true;
        window.EJS_DEBUG_XX = false;
        window.EJS_disableDatabases = true;
        // Enable threads when the selected core requires them, otherwise enable only if SAB is available.
        const THREAD_REQUIRED_CORES = new Set([
            'ppsspp',
            'dosbox_pure',
            'ppsspp-core', // aliases if used elsewhere
            'ppsspp' // ensure ppsspp present
        ]);

        // Default: enable threads if SharedArrayBuffer is available.
        let threadsAvailable = (typeof SharedArrayBuffer !== 'undefined');

        // If core explicitly requires threads, enable them even if SharedArrayBuffer is not present,
        // but warn so integrators know to serve proper cross-origin headers for full support.
        if (THREAD_REQUIRED_CORES.has(window.EJS_core)) {
            if (!threadsAvailable) {
                console.warn(`Selected core "${window.EJS_core}" requires threads but SharedArrayBuffer is not exposed. Threads will be enabled; however the browser may block SharedArrayBuffer without proper cross-origin isolation headers (see https://stackoverflow.com/a/68630724).`);
            }
            window.EJS_threads = true;
        } else {
            window.EJS_threads = threadsAvailable;
        }

        // Virtual gamepad uses EmulatorJS defaults; UI toggle is currently cosmetic.

        // Load or reload loader.js
        const existingLoader = document.querySelector('script[data-ejs-loader]');
        if (existingLoader) {
            existingLoader.remove();
        }

        const script = document.createElement("script");
        script.src = "loader.js";
        script.setAttribute('data-ejs-loader', 'true');
        document.body.appendChild(script);

        // Update drop hint label safely
        if (dropHint) {
            dropHint.textContent = displayName.toUpperCase();
            dropHint.style.opacity = '0.6';
        }

        // Let the corruption wrapper re-attach once the canvas appears
        if (window.T4Corrupt) {
            setTimeout(() => window.T4Corrupt.pokeCanvas(), 500);
        }
    }

    // Show a modal core picker and return a Promise resolved with the chosen core id (or null if cancelled).
    function promptUserForCore() {
        return new Promise((resolve) => {
            // Build modal overlay
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.background = 'rgba(0,0,0,0.75)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '99999';

            const box = document.createElement('div');
            box.style.background = 'linear-gradient(180deg,#0b0e12,#0a0d11)';
            box.style.border = '1px solid #1f2730';
            box.style.padding = '18px';
            box.style.borderRadius = '10px';
            box.style.width = '320px';
            box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6)';
            box.style.color = '#e6f7ef';
            box.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
            box.style.textAlign = 'left';

            const title = document.createElement('div');
            title.textContent = 'Unrecognized ROM — pick a core';
            title.style.fontWeight = '700';
            title.style.marginBottom = '8px';
            title.style.fontSize = '14px';

            const hint = document.createElement('div');
            hint.textContent = 'The file extension did not give a clear core. Select the core to use:';
            hint.style.fontSize = '12px';
            hint.style.color = '#bcd9c7';
            hint.style.marginBottom = '12px';

            const select = document.createElement('select');
            select.style.width = '100%';
            select.style.padding = '8px';
            select.style.borderRadius = '8px';
            // Use a high-contrast light background + dark text for the dropdown so options are readable
            select.style.background = '#e6f7ef';
            select.style.color = '#04110a';
            select.style.border = '1px solid #23303a';
            // Ensure native dropdown arrow remains visible on some platforms
            select.style.appearance = 'menulist';
            select.style.webkitAppearance = 'menulist';

            // Populate select with entries from coreSelect (reuse options)
            // Add a placeholder
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- Choose Core --';
            select.appendChild(placeholder);

            const optNodes = coreSelect ? Array.from(coreSelect.options) : [];
            optNodes.forEach((opt) => {
                // skip the AUTO CORE label (empty value) to avoid no-op
                if (!opt.value) return;
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.textContent || opt.value;
                select.appendChild(o);
            });

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '8px';
            btnRow.style.marginTop = '14px';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.background = 'transparent';
            cancelBtn.style.border = '1px solid #334146';
            cancelBtn.style.color = '#cddfd4';
            cancelBtn.style.padding = '8px 12px';
            cancelBtn.style.borderRadius = '8px';
            cancelBtn.style.cursor = 'pointer';

            const okBtn = document.createElement('button');
            okBtn.textContent = 'Load';
            okBtn.style.background = 'linear-gradient(90deg,#45ffb0,#2bd39a)';
            okBtn.style.border = 'none';
            okBtn.style.color = '#04110a';
            okBtn.style.padding = '8px 12px';
            okBtn.style.borderRadius = '8px';
            okBtn.style.cursor = 'pointer';
            okBtn.disabled = true;
            okBtn.style.opacity = '0.6';

            select.addEventListener('change', () => {
                if (select.value) {
                    okBtn.disabled = false;
                    okBtn.style.opacity = '1';
                } else {
                    okBtn.disabled = true;
                    okBtn.style.opacity = '0.6';
                }
            });

            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });

            okBtn.addEventListener('click', () => {
                const chosen = select.value || null;
                document.body.removeChild(overlay);
                resolve(chosen);
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);

            box.appendChild(title);
            box.appendChild(hint);
            box.appendChild(select);
            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // Focus the select for keyboard users
            setTimeout(() => select.focus(), 50);
        });
    }

    // UI bindings
    btnLoadRom.addEventListener('click', () => {
        romInput.click();
    });

    romInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
            runWithFile(file);
        }
        romInput.value = '';
    });

    coreSelect.addEventListener('change', (e) => {
        currentCore = e.target.value || null;
        // Note: core will be used next time you load a ROM
    });

    // Settings button: open modal to choose EmulatorJS version
    if (btnSettings) {
        btnSettings.addEventListener('click', () => {
            // build overlay
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.zIndex = '100000';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.background = 'rgba(0,0,0,0.6)';

            const box = document.createElement('div');
            box.style.background = '#0b0e12';
            box.style.border = '1px solid #1f2730';
            box.style.padding = '16px';
            box.style.borderRadius = '10px';
            box.style.width = '360px';
            box.style.color = '#e6f3ea';
            box.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
            box.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';

            const title = document.createElement('div');
            title.textContent = 'Settings';
            title.style.fontWeight = '700';
            title.style.marginBottom = '8px';
            title.style.fontSize = '15px';

            const label = document.createElement('div');
            label.textContent = 'EmulatorJS Version';
            label.style.fontSize = '12px';
            label.style.color = '#bcd9c7';
            label.style.marginBottom = '8px';

            const select = document.createElement('select');
            select.id = 'version-select';
            select.style.width = '100%';
            select.style.padding = '8px';
            select.style.borderRadius = '8px';
            select.style.border = '1px solid #23303a';
            select.style.background = '#e6f7ef';
            select.style.color = '#04110a';
            select.innerHTML = `
                <option value="stable/">stable (4.2.3)</option>
                <option value="latest/">latest</option>
                <option value="nightly/">nightly</option>
                <option value="" id="custom-version" disabled>custom</option>
                <option value="0.4.26/">0.4.26</option>
                <option value="3.1.5/">3.1.5</option>
                <option value="4.0.1/">4.0.1</option>
                <option value="4.0.2/">4.0.2</option>
                <option value="4.0.3/">4.0.3</option>
                <option value="4.0.4/">4.0.4</option>
                <option value="4.0.5/">4.0.5</option>
                <option value="4.0.6/">4.0.6</option>
                <option value="4.0.7/">4.0.7</option>
                <option value="4.0.8/">4.0.8</option>
                <option value="4.0.9/">4.0.9</option>
                <option value="4.0.10/">4.0.10</option>
                <option value="4.0.11/">4.0.11</option>
                <option value="4.0.12/">4.0.12</option>
                <option value="4.1.1/">4.1.1</option>
                <option value="4.2.0/">4.2.0</option>
                <option value="4.2.1/">4.2.1</option>
                <option value="4.2.2/">4.2.2</option>
            `;

            // restore previous selection if stored
            try {
                const stored = localStorage.getItem('EJS_version');
                if (stored) select.value = stored;
            } catch (e) {}

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'flex-end';
            row.style.gap = '8px';
            row.style.marginTop = '14px';

            const cancel = document.createElement('button');
            cancel.textContent = 'Cancel';
            cancel.style.background = 'transparent';
            cancel.style.border = '1px solid #334146';
            cancel.style.color = '#cddfd4';
            cancel.style.padding = '8px 12px';
            cancel.style.borderRadius = '8px';
            cancel.style.cursor = 'pointer';

            const save = document.createElement('button');
            save.textContent = 'Save';
            save.style.background = 'linear-gradient(90deg,#45ffb0,#2bd39a)';
            save.style.border = 'none';
            save.style.color = '#04110a';
            save.style.padding = '8px 12px';
            save.style.borderRadius = '8px';
            save.style.cursor = 'pointer';

            cancel.addEventListener('click', () => {
                document.body.removeChild(overlay);
            });

            save.addEventListener('click', () => {
                const val = select.value;
                try {
                    localStorage.setItem('EJS_version', val);
                } catch (e) {}
                // expose selection globally so other scripts/integrations can read it
                window.EJS_selectedVersion = val;
                // show a small transient feedback
                const fb = document.createElement('div');
                fb.textContent = 'Saved: ' + val;
                fb.style.position = 'fixed';
                fb.style.bottom = '20px';
                fb.style.left = '50%';
                fb.style.transform = 'translateX(-50%)';
                fb.style.background = 'rgba(0,0,0,0.8)';
                fb.style.color = '#e6f7ea';
                fb.style.padding = '8px 12px';
                fb.style.borderRadius = '8px';
                fb.style.zIndex = '100001';
                document.body.appendChild(fb);
                setTimeout(() => fb.remove(), 1500);

                document.body.removeChild(overlay);
            });

            row.appendChild(cancel);
            row.appendChild(save);

            box.appendChild(title);
            box.appendChild(label);
            box.appendChild(select);
            box.appendChild(row);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // focus
            setTimeout(() => select.focus(), 50);
        });
    }

    // Drag & drop
    ['dragenter', 'dragover'].forEach((evt) => {
        window.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (overlay) {
                overlay.style.background =
                    'radial-gradient(circle at top, rgba(69,255,176,0.08), rgba(0,0,0,0.7))';
            }
        });
    });

    ['dragleave', 'drop'].forEach((evt) => {
        window.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (overlay) overlay.style.background = 'transparent';
        });
    });

    window.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (!dt || !dt.files || !dt.files.length) return;
        runWithFile(dt.files[0]);
    });

    // Pause / resume using EmulatorJS instance if present
    btnPause.addEventListener('click', () => {
        if (!window.EJS_emulator) return;

        try {
            const gm = window.EJS_emulator.gameManager;
            // Prefer the GameManager toggleMainLoop API which reliably pauses/resumes the emulation loop.
            if (gm && typeof gm.toggleMainLoop === 'function') {
                if (!isPaused) {
                    try { gm.toggleMainLoop(0); } catch (e) { console.warn('gm.toggleMainLoop pause failed:', e); }
                    btnPause.textContent = 'RESUME';
                } else {
                    try { gm.toggleMainLoop(1); } catch (e) { console.warn('gm.toggleMainLoop resume failed:', e); }
                    btnPause.textContent = 'PAUSE';
                }
                isPaused = !isPaused;
                return;
            }

            // Fallback: use any exposed pause/resume or toggleMainLoop directly on the emulator object.
            if (!isPaused) {
                if (typeof window.EJS_emulator.pause === 'function') {
                    window.EJS_emulator.pause();
                } else if (typeof window.EJS_emulator.toggleMainLoop === 'function') {
                    window.EJS_emulator.toggleMainLoop(0);
                }
                btnPause.textContent = 'RESUME';
            } else {
                if (typeof window.EJS_emulator.resume === 'function') {
                    window.EJS_emulator.resume();
                } else if (typeof window.EJS_emulator.toggleMainLoop === 'function') {
                    window.EJS_emulator.toggleMainLoop(1);
                }
                btnPause.textContent = 'PAUSE';
            }
            isPaused = !isPaused;
        } catch (e) {
            console.warn('Pause/Resume handler error:', e);
        }
    });

    btnReset.addEventListener('click', () => {
        // Try to ask the emulator to reset first (soft reset)
        try {
            if (window.EJS_emulator && typeof window.EJS_emulator.reset === 'function') {
                window.EJS_emulator.reset();
            }
        } catch (e) {
            // ignore emulator reset errors
        }

        // If memory or WASM state was corrupted, a full reload restores the original module and memory.
        try {
            // reload the page to restore default data and clear corrupted WASM HEAP
            window.location.reload();
        } catch (e) {
            // ignore reload errors
        }
    });

    btnFullscreen.addEventListener('click', () => {
        const shell = document.getElementById('emulator-shell');
        if (!shell) return;

        if (!document.fullscreenElement) {
            shell.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });

    // Corruption controls: mutate emulator memory on demand
    btnCorrupt.addEventListener('click', () => {
        // If active corruption is running, ignore manual clicks
        if (corruptActiveToggle && corruptActiveToggle.checked) return;
        if (!window.MemoryCorruptor) return;

        const mode = corruptionMode.value || 'bitflip';
        const target = corruptionTarget ? (corruptionTarget.value || 'ram') : 'ram';
        const raw = corruptionByteCount.value;
        let count = parseInt(raw, 10);

        if (!Number.isFinite(count) || count <= 0) {
            count = 1;
            corruptionByteCount.value = String(count);
        }

        // Perform one-shot corruption; MemoryCorruptor enforces its own safety caps
        window.MemoryCorruptor.corrupt(mode, count, target);
    });

    // Corrupt X2: perform the chosen corruption twice in succession
    if (btnCorruptX2) {
        btnCorruptX2.addEventListener('click', async () => {
            // Ignore when active corruption is running
            if (corruptActiveToggle && corruptActiveToggle.checked) return;
            if (!window.MemoryCorruptor) return;

            const mode = corruptionMode.value || 'bitflip';
            const target = corruptionTarget ? (corruptionTarget.value || 'ram') : 'ram';
            const raw = corruptionByteCount.value;
            let count = parseInt(raw, 10);

            if (!Number.isFinite(count) || count <= 0) {
                count = 1;
                corruptionByteCount.value = String(count);
            }

            try {
                if (target === 'cpu') {
                    // For CPU target, perform two in-memory state mutations without restarting,
                    // then perform a single restart + load to avoid double restarts.
                    const state1 = window.MemoryCorruptor.corrupt(mode, count, target, { suppressRestart: true });
                    // Apply second mutation to same state if available (some implementations return mutated state)
                    const state2 = window.MemoryCorruptor.corrupt(mode, count, target, { suppressRestart: true }) || state1;

                    // If a game manager exists, perform a single restart and load the mutated state
                    const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
                    if (gm && typeof gm.restart === 'function' && typeof gm.loadState === 'function') {
                        try {
                            gm.restart();
                        } catch (e) {
                            console.warn('Failed to restart core for Corrupt X2:', e);
                        }
                        setTimeout(() => {
                            try {
                                if (state2) gm.loadState(state2);
                            } catch (e) {
                                console.warn('Failed to load corrupted CPU state for Corrupt X2:', e);
                            }
                        }, 50);
                    } else {
                        // Fallback: if no game manager, call corrupt without suppression twice (best-effort)
                        window.MemoryCorruptor.corrupt(mode, count, target);
                        setTimeout(() => window.MemoryCorruptor.corrupt(mode, count, target), 50);
                    }
                } else {
                    // Non-CPU targets: two quick invocations (live targets usually safe)
                    window.MemoryCorruptor.corrupt(mode, count, target);
                    setTimeout(() => {
                        try {
                            window.MemoryCorruptor.corrupt(mode, count, target);
                        } catch (e) {
                            console.warn("Second corruption failed:", e);
                        }
                    }, 50);
                }
            } catch (e) {
                console.warn("Corrupt X2 failed:", e);
            }
        });
    }

    // Wire mobile-topbar corruption buttons (these are visible only on mobile via CSS)
    const mobileBtnCorrupt = document.getElementById('mobile-btn-corrupt');
    const mobileBtnCorruptX2 = document.getElementById('mobile-btn-corrupt-x2');
    const mobileCorruptByteCount = document.getElementById('mobile-corrupt-byte-count');

    if (mobileBtnCorrupt) {
        mobileBtnCorrupt.addEventListener('click', () => {
            // delegate to existing handler logic
            btnCorrupt.click();
        });
    }
    if (mobileBtnCorruptX2) {
        mobileBtnCorruptX2.addEventListener('click', () => {
            // delegate to existing handler logic
            if (btnCorruptX2) btnCorruptX2.click();
        });
    }

    // Mobile Corrupter Options button and modal wiring
    const mobileOptionsBtn = document.getElementById('mobile-btn-options');
    const mobileModal = document.getElementById('mobile-corrupt-modal');
    const mobileClose = document.getElementById('mobile-corrupt-close');
    const mobileCancel = document.getElementById('mobile-corrupt-cancel');
    const mobileSave = document.getElementById('mobile-corrupt-save');

    // modal fields
    const mobileByteAmount = document.getElementById('mobile-byte-amount');
    const mobileMode = document.getElementById('mobile-corrupt-mode');
    const mobileTarget = document.getElementById('mobile-corrupt-target');
    const mobileActiveToggle = document.getElementById('mobile-corrupt-active-toggle');
    const mobileSeconds = document.getElementById('mobile-corrupt-seconds');

    // open modal: populate with current desktop values
    if (mobileOptionsBtn) {
        mobileOptionsBtn.addEventListener('click', () => {
            if (!mobileModal) return;
            // populate values from desktop controls if present
            try { mobileByteAmount.value = corruptionByteCount ? corruptionByteCount.value : mobileByteAmount.value; } catch (e) {}
            try { mobileMode.value = corruptionMode ? corruptionMode.value : mobileMode.value; } catch (e) {}
            try { mobileTarget.value = corruptionTarget ? corruptionTarget.value : mobileTarget.value; } catch (e) {}
            try { mobileActiveToggle.checked = corruptActiveToggle ? corruptActiveToggle.checked : mobileActiveToggle.checked; } catch (e) {}
            try { mobileSeconds.value = corruptSecondsInput ? corruptSecondsInput.value : mobileSeconds.value; } catch (e) {}

            mobileModal.style.display = 'flex';
        });
    }

    // close handlers
    if (mobileClose) mobileClose.addEventListener('click', () => mobileModal.style.display = 'none');
    if (mobileCancel) mobileCancel.addEventListener('click', () => mobileModal.style.display = 'none');

    // Apply: sync modal values back to desktop controls so existing handlers work
    if (mobileSave) {
        mobileSave.addEventListener('click', () => {
            try {
                if (corruptionByteCount) corruptionByteCount.value = mobileByteAmount.value;
            } catch (e) {}
            try {
                if (corruptionMode) corruptionMode.value = mobileMode.value;
            } catch (e) {}
            try {
                if (corruptionTarget) corruptionTarget.value = mobileTarget.value;
            } catch (e) {}
            try {
                if (corruptActiveToggle) {
                    corruptActiveToggle.checked = mobileActiveToggle.checked;
                    // trigger change so active corruption starts/stops
                    corruptActiveToggle.dispatchEvent(new Event('change'));
                }
            } catch (e) {}
            try {
                if (corruptSecondsInput) corruptSecondsInput.value = mobileSeconds.value;
            } catch (e) {}

            // close modal
            if (mobileModal) mobileModal.style.display = 'none';
        });
    }

    // Keep mobile "CORRUPT" actions using desktop logic (they read desktop controls)
    // nothing else to change here.



    // Touch-friendly hint: disable text selection
    document.body.style.userSelect = 'none';
})();