/**
 * Memory corrupter for EmulatorJS.
 * Mutates the underlying WASM HEAP so it works on every system and actually changes gameplay.
 *
 * This is intentionally dangerous: it can crash games or the core.
 */
(function () {
    function getModule() {
        if (window.EJS_emulator && window.EJS_emulator.Module) {
            return window.EJS_emulator.Module;
        }
        // Some builds may expose Module globally
        if (window.Module && window.Module.HEAPU8) {
            return window.Module;
        }
        return null;
    }

    function getGameManager() {
        if (window.EJS_emulator && window.EJS_emulator.gameManager) {
            return window.EJS_emulator.gameManager;
        }
        return null;
    }

    function getHeap() {
        // Return the emulator module (may be wrapped in different ways)
        const mod = getModule();
        if (!mod) return null;

        // If the core exposes HEAPU8, prefer to build a fresh Uint8Array view
        // from the underlying memory.buffer each time we need to mutate RAM.
        try {
            if (mod.HEAPU8 && mod.HEAPU8.buffer) {
                return {
                    mod: mod,
                    freshView: () => new Uint8Array(mod.HEAPU8.buffer)
                };
            }
        } catch (e) {
            // Fall through to try direct buffer access
        }

        // Fallback: if Module.memory exists (emscripten), create a view from its buffer
        if (mod.memory && mod.memory.buffer) {
            return {
                mod: mod,
                freshView: () => new Uint8Array(mod.memory.buffer)
            };
        }

        return null;
    }

    function getSafeCount(requested, heapLength) {
        let n = Number(requested);
        if (!Number.isFinite(n) || n <= 0) n = 1;
        // Hard safety cap: at most 0.5% of memory per press, but at least 1 byte.
        const maxBytes = Math.max(1, Math.floor(heapLength * 0.005));
        if (n > maxBytes) n = maxBytes;
        return n;
    }

    function randInt(max) {
        return (Math.random() * max) | 0;
    }

    // --- Corruption modes operating on HEAPU8 directly ---

    function mode_bitflip(heap, count) {
        const len = heap.length;
        for (let i = 0; i < count; i++) {
            const idx = randInt(len);
            const bit = 1 << randInt(8);
            heap[idx] = heap[idx] ^ bit;
        }
    }

    function mode_byteswap(heap, count) {
        const len = heap.length;
        for (let i = 0; i < count; i++) {
            const a = randInt(len);
            const b = randInt(len);
            const tmp = heap[a];
            heap[a] = heap[b];
            heap[b] = tmp;
        }
    }

    function mode_checkerboard(heap, count) {
        const len = heap.length;
        const start = randInt(Math.max(1, len - count));
        for (let i = 0; i < count; i++) {
            const idx = start + i;
            heap[idx] = (i & 1) ? 0x00 : 0xFF;
        }
    }

    function mode_texturevomit(heap, count) {
        const len = heap.length;
        for (let i = 0; i < count; i++) {
            const idx = randInt(len);
            heap[idx] = randInt(256);
        }
    }

    function mode_everybyte(heap, count) {
        const len = heap.length;
        const start = randInt(Math.max(1, len - count));
        const delta = (randInt(15) + 1) * (Math.random() < 0.5 ? 1 : -1);
        for (let i = 0; i < count; i++) {
            const idx = start + i;
            heap[idx] = (heap[idx] + delta) & 0xFF;
        }
    }

    function mode_worldlevel(heap, count) {
        const len = heap.length;
        // Bias towards first quarter of memory (often core state / level data)
        const regionLen = Math.floor(len * 0.25) || len;
        const start = randInt(Math.max(1, regionLen - count));
        for (let i = 0; i < count; i++) {
            const idx = start + i;
            const val = heap[idx];
            // Nudge bytes toward extreme values to cause strong structural changes
            heap[idx] = (val < 0x80 ? val + randInt(64) : val - randInt(64)) & 0xFF;
        }
    }

    function mode_xor(heap, count) {
        const len = heap.length;
        const mask = randInt(256);
        for (let i = 0; i < count; i++) {
            const idx = randInt(len);
            heap[idx] = heap[idx] ^ mask;
        }
    }

    function mode_clusterbytes(heap, count) {
        const len = heap.length;
        const clusterSize = Math.max(8, Math.floor(count / 4));
        const center = randInt(len);
        const start = Math.max(0, center - Math.floor(clusterSize / 2));
        const end = Math.min(len, start + clusterSize);
        for (let i = start; i < end; i++) {
            const bit = 1 << randInt(8);
            heap[i] = heap[i] ^ bit;
        }
        // If user requested more than clusterSize, sprinkle remaining bytes
        let remaining = count - (end - start);
        while (remaining-- > 0) {
            const idx = randInt(len);
            heap[idx] = randInt(256);
        }
    }

    function mode_statchanger(heap, count) {
        const len = heap.length;
        // Target early memory; many systems keep player stats / flags here
        const regionLen = Math.min(len, 0x10000);
        const start = randInt(Math.max(1, regionLen - count));
        for (let i = 0; i < count; i++) {
            const idx = start + i;
            // Flip a couple of low bits
            const bitMask = (1 << randInt(3)) | (1 << randInt(3));
            heap[idx] = heap[idx] ^ bitMask;
        }
    }

    function mode_bytesoundswap(heap, count) {
        const len = heap.length;

        // Prefer operating on 16-bit samples when available to more strongly affect audio streams:
        // We'll attempt to treat a middle region as audio buffer and mutate 16-bit samples in-place.
        const midStart = Math.floor(len * 0.35);
        const midLen = Math.max(Math.floor(len * 0.3), 64);
        // Ensure we don't walk off the end
        const regionStart = Math.max(0, midStart);
        const regionEnd = Math.min(len, regionStart + midLen);

        // Choose a starting index within this probable audio region
        let start = regionStart + randInt(Math.max(1, Math.min(count, regionEnd - regionStart)));
        if (start % 2 !== 0) start = Math.max(regionStart, start - 1); // align to 16-bit

        // If we can access the Module HEAP as 16-bit, operate on samples to create stronger audible effects.
        const mod = getModule();
        const can16 = !!(mod && mod.HEAP16 && mod.HEAP16.length);

        let mutated = 0;
        let tries = 0;
        while (mutated < count && tries < count * 3) {
            tries++;
            const idx16 = start + ((mutated * 2) % Math.max(2, regionEnd - start));
            if (idx16 + 1 >= len) break;

            if (can16) {
                // Interpret as signed 16-bit sample and perform operations:
                // - invert sign occasionally
                // - apply bit-rotate to low/high bytes
                // - apply random amplitude boost/clamp
                const byteIndex = idx16; // HEAPU8 index for the low byte
                // Read 16-bit little-endian sample
                const low = heap[byteIndex];
                const high = heap[byteIndex + 1];
                let sample = (high << 8) | low;
                if (sample & 0x8000) sample = sample - 0x10000; // signed

                // Choose mutation type
                const t = randInt(4);
                if (t === 0) {
                    // invert sign
                    sample = -sample;
                } else if (t === 1) {
                    // rotate nibbles within low/high bytes to garble waveform
                    const newLow = ((low & 0x0F) << 4) | ((low & 0xF0) >> 4);
                    const newHigh = ((high & 0x0F) << 4) | ((high & 0xF0) >> 4);
                    sample = (newHigh << 8) | newLow;
                    if (sample & 0x8000) sample = sample - 0x10000;
                } else if (t === 2) {
                    // amplitude jitter
                    const factor = 1 + ((randInt(31) - 15) / 128); // +- ~11%
                    sample = Math.max(-32768, Math.min(32767, Math.trunc(sample * factor)));
                } else {
                    // occasional silence / clipping glitch
                    sample = (randInt(3) === 0) ? 0 : sample ^ (1 << randInt(15));
                }

                // Write back as little-endian 16-bit
                const out = (sample < 0) ? (sample + 0x10000) : sample;
                heap[byteIndex] = out & 0xFF;
                heap[byteIndex + 1] = (out >> 8) & 0xFF;

                mutated++;
            } else {
                // Fallback to byte-granular mutation if 16-bit view isn't present:
                // Target nearby bytes and perform nibble swaps / small XOR masks to create audible artifacts.
                const idx = idx16;
                const v = heap[idx];
                // Swap high/low nibble and XOR with a small mask
                const mutatedByte = (((v & 0x0F) << 4) | ((v & 0xF0) >> 4)) ^ (randInt(0x1F));
                heap[idx] = mutatedByte & 0xFF;
                // also perturb adjacent byte to disturb stereo/adjacent-sample data
                if (idx + 1 < len) {
                    heap[idx + 1] = (heap[idx + 1] ^ (1 << randInt(8))) & 0xFF;
                }
                mutated++;
            }
        }

        // If user requested more mutations than we did, sprinkle random garbage in region to amplify audio corruption.
        let remaining = Math.max(0, count - mutated);
        while (remaining-- > 0) {
            const idx = regionStart + randInt(Math.max(1, regionEnd - regionStart));
            heap[idx] = (heap[idx] ^ (1 << randInt(8))) & 0xFF;
        }
    }

    // --- Audio-specific modes (operate primarily inside expected audio regions) ---

    function mode_audioglitch(heap, count) {
        const len = heap.length;
        const midStart = Math.floor(len * 0.3);
        const midLen = Math.max(Math.floor(len * 0.4), 128);
        const start = regionClamp(randInt(midLen) + midStart, 0, len - 1);
        const end = Math.min(len, start + Math.max(32, Math.floor(count * 2)));
        // Apply short bursts of amplitude flips and short silences to create glitchy audio artifacts
        for (let i = start; i < end && count > 0; i += 2) {
            const low = heap[i];
            const high = heap[i + 1] || 0;
            let sample = (high << 8) | low;
            if (sample & 0x8000) sample = sample - 0x10000;
            const t = randInt(3);
            if (t === 0) sample = -sample; // invert phase
            else if (t === 1) sample = 0; // silence
            else sample = sample ^ (1 << randInt(12)); // light noise
            const out = (sample < 0) ? (sample + 0x10000) : sample;
            heap[i] = out & 0xFF;
            if (i + 1 < len) heap[i + 1] = (out >> 8) & 0xFF;
            count--;
        }
        // sprinkle micro-scrambles
        while (count-- > 0) {
            const idx = regionClamp(midStart + randInt(midLen), 0, len - 1);
            heap[idx] = randInt(256);
        }
    }

    function mode_audioinject(buf, count) {
        const len = buf.length;
        if (len === 0) return;
        const midStart = Math.floor(len * 0.35);
        const midLen = Math.max(Math.floor(len * 0.3), 64);
        const start = regionClamp(midStart + randInt(Math.max(1, midLen - count)), 0, len - 1);
        const end = Math.min(len, start + Math.max(8, count));
        // Insert "bursts" by rotating small sample runs and overwriting with amplitude-biased randoms
        const rotateBy = Math.max(1, (count % 5));
        for (let r = 0; r < rotateBy; r++) {
            for (let i = start; i + rotateBy < end; i += rotateBy) {
                buf[i] = buf[i + rotateBy];
            }
            // last positions get randomized
            if (end - rotateBy >= start) {
                buf[end - 1] = randInt(256);
            }
        }
        for (let i = start; i < end; i += 2) {
            // bias toward loud clipping occasionally
            if (Math.random() < 0.12) {
                buf[i] = 0xFF;
                if (i + 1 < len) buf[i + 1] = 0x7F;
            } else {
                buf[i] = (randInt(256) ^ (buf[i] >> (randInt(3) + 1))) & 0xFF;
            }
        }
        let remaining = Math.max(0, count - (end - start));
        while (remaining-- > 0) {
            const idx = randInt(len);
            buf[idx] = randInt(256);
        }
    }

    function regionClamp(v, a, b) {
        if (v < a) return a;
        if (v > b) return b;
        return v;
    }

    /**
     * Inject random bytes into the buffer to increase size-like disruption (for RAM/CPU-state).
     * When operating on RAM (HEAPU8), we will overwrite a contiguous region with injected bytes
     * and, where possible, perform a small "shift" to emulate insertion by rotating a chunk.
     *
     * This mode aims to emulate "inserting" noise bytes into data structures, which often
     * destabilizes parsing and runtime structures more aggressively than simple flips.
     */
    function mode_byteinject(buf, count) {
        const len = buf.length;
        if (len === 0) return;

        // Choose region - bias towards middle of buffer for stronger effects
        const start = Math.max(0, Math.floor(len * 0.25) + randInt(Math.max(1, Math.floor(len * 0.5) - count)));
        const end = Math.min(len, start + count);

        // If buffer is a HEAPU8 like view, perform a small rotate of the region to emulate insertion
        // then overwrite the first 'count' bytes in region with random values.
        // This avoids changing the array length (can't in-place) but simulates insertion semantics.
        // Rotate by a few bytes to shift nearby data.
        const rotateBy = Math.max(1, (count % 7));
        for (let i = 0; i < rotateBy; i++) {
            const tmp = buf[start + i];
            for (let j = start + i; j + rotateBy < end; j += rotateBy) {
                buf[j] = buf[j + rotateBy];
            }
            const lastIndex = start + Math.max(0, end - start - (i + 1));
            buf[lastIndex] = tmp;
        }

        // Overwrite region with injected random bytes
        for (let i = start; i < end; i++) {
            // mix randomized byte with small bias from original to create varying disruption
            const original = buf[i];
            const injected = (randInt(256) ^ (original >> (randInt(3) + 1))) & 0xFF;
            buf[i] = injected;
        }

        // If user requested more than region size, sprinkle random bytes elsewhere
        let remaining = Math.max(0, count - (end - start));
        while (remaining-- > 0) {
            const idx = randInt(len);
            buf[idx] = randInt(256);
        }
    }

    const MODE_IMPL = {
        bitflip: mode_bitflip,
        byteswap: mode_byteswap,
        checkerboard: mode_checkerboard,
        texturevomit: mode_texturevomit,
        everybyte: mode_everybyte,
        worldlevel: mode_worldlevel,
        xor: mode_xor,
        clusterbytes: mode_clusterbytes,
        statchanger: mode_statchanger,
        bytesoundswap: mode_bytesoundswap,
        byteinject: mode_byteinject,
        // audio-specific modes
        audioglitch: mode_audioglitch,
        audioinject: mode_audioinject
    };

    function corruptRam(mode, requestedCount) {
        // Prefer using emulator save/load flow if available (restart semantics), otherwise fall back to live heap mutation.
        const gm = getGameManager();
        if (gm && typeof gm.getState === 'function' && typeof gm.loadState === 'function') {
            // Use same pattern as CPU: snapshot state, mutate, restart, reload
            let state;
            try {
                state = gm.getState();
            } catch (e) {
                console.warn('Failed to read state for RAM-targeted corruption (fallback to live):', e);
            }
            if (state && state.length) {
                const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
                const count = getSafeCount(requestedCount, state.length);
                try {
                    impl(state, count);
                } catch (e) {
                    console.warn('RAM state mutation error:', e);
                }
                try {
                    if (typeof gm.restart === 'function') {
                        gm.restart();
                    }
                } catch (e) {
                    console.warn('Failed to restart core after RAM corruption:', e);
                }
                setTimeout(() => {
                    try {
                        gm.loadState(state);
                    } catch (e) {
                        console.warn('Failed to load corrupted RAM state:', e);
                    }
                }, 50);
                return;
            }
        }

        // Fallback: operate on live HEAPU8 directly
        // Acquire module and ensure we operate on the live, current linear memory buffer.
        const heapAccessor = getHeap();
        if (!heapAccessor) return;

        const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
        const mod = heapAccessor.mod;

        // Try to obtain a live Uint8Array view of the Module memory buffer.
        let liveView = null;
        try {
            if (mod && mod.HEAPU8 && mod.HEAPU8.buffer) {
                // Recreate a fresh view backed by the current buffer so it's safe after Grow operations.
                liveView = new Uint8Array(mod.HEAPU8.buffer);
            } else if (mod && mod.memory && mod.memory.buffer) {
                liveView = new Uint8Array(mod.memory.buffer);
            } else {
                // Last-resort: use provided freshView helper
                liveView = heapAccessor.freshView();
            }
        } catch (e) {
            console.warn('Failed to obtain live HEAP view:', e);
            try {
                liveView = heapAccessor.freshView();
            } catch (ee) {
                console.warn('Failed to create fallback HEAP view:', ee);
                return;
            }
        }

        if (!liveView || !liveView.length) return;

        const count = getSafeCount(requestedCount, liveView.length);

        try {
            // Operate directly on the live view so modifications affect the running emulator immediately.
            impl(liveView, count);

            // If Module.HEAPU8 exists and is a different Uint8Array object (but same buffer), ensure it reflects changes.
            try {
                if (mod && mod.HEAPU8 && mod.HEAPU8.buffer === liveView.buffer && mod.HEAPU8 !== liveView) {
                    // Copy back into Module.HEAPU8 (object identity may differ)
                    mod.HEAPU8.set(liveView);
                }
                // If mod.HEAPU8 is the same object we mutated, nothing else needed.
            } catch (e) {
                // Non-fatal: mutations are already on the underlying buffer; just warn.
                console.warn('Failed to sync mutated buffer to Module.HEAPU8 object:', e);
            }
        } catch (e) {
            console.warn('RAM corruption error:', e);
        }
    }

    /**
     * Corrupt audio-specific regions in the emulated heap.
     *
     * This attempts to bias operations towards likely audio buffers (mid/upper mid areas),
     * and provides dedicated audio modes that are less suitable for generic RAM/CPU mutation.
     */
    function corruptAudio(mode, requestedCount) {
        // Prefer restart-style flow via gameManager state when possible, to mirror CPU behavior.
        const gm = getGameManager();
        if (gm && typeof gm.getState === 'function' && typeof gm.loadState === 'function') {
            let state;
            try {
                state = gm.getState();
            } catch (e) {
                console.warn('Failed to read state for AUDIO-targeted corruption (fallback to live):', e);
            }
            if (state && state.length) {
                // Use audio-specific impls where available; else fallback to bytesoundswap
                const audioModes = {
                    audioglitch: mode_audioglitch,
                    audioinject: mode_audioinject,
                    bytesoundswap: mode_bytesoundswap,
                    texturevomit: mode_texturevomit
                };
                const impl = audioModes[mode] || audioModes.bytesoundswap;
                const count = getSafeCount(requestedCount, state.length);
                try {
                    impl(state, count);
                } catch (e) {
                    console.warn('AUDIO state mutation error:', e);
                }
                try {
                    if (typeof gm.restart === 'function') {
                        gm.restart();
                    }
                } catch (e) {
                    console.warn('Failed to restart core after AUDIO corruption:', e);
                }
                setTimeout(() => {
                    try {
                        gm.loadState(state);
                    } catch (e) {
                        console.warn('Failed to load corrupted AUDIO state:', e);
                    }
                }, 50);
                return;
            }
        }

        // Fallback: operate on live HEAPU8 directly
        const heapAccessor = getHeap();
        if (!heapAccessor) return;

        const mod = heapAccessor.mod;
        let liveView = null;
        try {
            if (mod && mod.HEAPU8 && mod.HEAPU8.buffer) {
                liveView = new Uint8Array(mod.HEAPU8.buffer);
            } else if (mod && mod.memory && mod.memory.buffer) {
                liveView = new Uint8Array(mod.memory.buffer);
            } else {
                liveView = heapAccessor.freshView();
            }
        } catch (e) {
            console.warn('Failed to obtain live HEAP view for audio corruption:', e);
            try {
                liveView = heapAccessor.freshView();
            } catch (ee) {
                console.warn('Failed to create fallback HEAP view for audio:', ee);
                return;
            }
        }

        if (!liveView || !liveView.length) return;

        const count = getSafeCount(requestedCount, liveView.length);

        // For audio target use audio-specific implementations when available, else fallback to bytesoundswap
        const audioModes = {
            audioglitch: mode_audioglitch,
            audioinject: mode_audioinject,
            bytesoundswap: mode_bytesoundswap,
            texturevomit: mode_texturevomit
        };

        const impl = audioModes[mode] || audioModes.bytesoundswap;

        try {
            impl(liveView, count);

            try {
                if (mod && mod.HEAPU8 && mod.HEAPU8.buffer === liveView.buffer && mod.HEAPU8 !== liveView) {
                    mod.HEAPU8.set(liveView);
                }
            } catch (e) {
                console.warn('Failed to sync mutated audio buffer to Module.HEAPU8 object:', e);
            }
        } catch (e) {
            console.warn('Audio corruption error:', e);
        }
    }

    function corruptCpu(mode, requestedCount, options) {
        options = options || {};
        const gm = getGameManager();
        if (!gm || typeof gm.getState !== 'function' || typeof gm.loadState !== 'function') return;

        let state;
        try {
            state = gm.getState();
        } catch (e) {
            console.warn('Failed to read CPU state:', e);
            return;
        }
        if (!state || !state.length) return;

        const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
        const count = getSafeCount(requestedCount, state.length);

        try {
            impl(state, count);
        } catch (e) {
            console.warn('CPU state corruption error:', e);
        }

        // If caller requested suppression of automatic restart/load, return mutated state
        if (options.suppressRestart) {
            return state;
        }

        // Otherwise apply corrupted CPU/RAM snapshot: restart core, then load corrupted state.
        try {
            if (typeof gm.restart === 'function') {
                gm.restart();
            }
        } catch (e) {
            console.warn('Failed to restart core after CPU corruption:', e);
        }

        setTimeout(() => {
            try {
                gm.loadState(state);
            } catch (e) {
                console.warn('Failed to load corrupted CPU state:', e);
            }
        }, 50);
    }

    /**
     * Corrupt the ROM file present inside the emulated FS (if available).
     * - Looks for common ROM filenames in the root of the FS.
     * - Skips the first 'bootSafe' bytes to avoid totally breaking bootloader region.
     * - Treats the ROM as an array of "lines" (lineSize bytes) and corrupts 'count' randomly chosen lines.
     * - Writes the mutated ROM back to FS and forces a restart so the core loads the mutated ROM.
     */
    async function corruptRom(mode, requestedCount) {
        const gm = getGameManager();
        if (!gm || !gm.FS) {
            console.warn('No game manager FS available for ROM corruption.');
            return;
        }

        // Attempt to find candidate ROM files in root of FS
        let files = [];
        try {
            files = gm.FS.readdir('/').filter(f => f && f.indexOf('.') !== 0);
        } catch (e) {
            // some builds may use rootless layout; try top-level listing via Module FS root
            try {
                files = gm.FS.readdir('/');
            } catch (ee) {
                console.warn('Failed to list FS root for ROM corruption:', ee);
                return;
            }
        }

        if (!files || !files.length) {
            console.warn('No files in FS to target for ROM corruption.');
            return;
        }

        // Common ROM extensions to look for, prefer the first match
        const ROM_EXTS = ['sfc','smc','nes','gen','bin','iso','z64','n64','gba','gg','md','gb','gbc','v64','cue','img','iso','nds','pbp'];
        let candidate = null;
        for (const f of files) {
            const ext = (f.split('.').pop() || '').toLowerCase();
            if (ROM_EXTS.includes(ext)) {
                candidate = f;
                break;
            }
        }
        if (!candidate) {
            // fallback: pick the largest file in root (likely the ROM)
            let largest = { name: null, size: 0 };
            for (const f of files) {
                try {
                    const stat = gm.FS.stat('/' + f);
                    if (stat && stat.size > largest.size) {
                        largest = { name: f, size: stat.size };
                    }
                } catch (e) {}
            }
            candidate = largest.name;
        }

        if (!candidate) {
            console.warn('No candidate ROM file found for ROM corruption.');
            return;
        }

        let content;
        try {
            content = gm.FS.readFile('/' + candidate);
        } catch (e) {
            console.warn('Failed to read ROM file from FS:', e);
            return;
        }

        if (!content || !content.length) {
            console.warn('ROM file empty or unreadable:', candidate);
            return;
        }

        // Interpret requestedCount as number of lines to corrupt (lines = lineSize bytes)
        const lineSize = 16; // treat "lines" as 16-byte rows
        const totalLines = Math.max(1, Math.floor(content.length / lineSize));

        // Safety: avoid mutating the first few lines (boot/headers). Skip first 'bootSafeLines'.
        const bootSafeLines = Math.max(2, Math.floor(Math.min(1024, content.length) / lineSize)); // skip ~ up to first 1KB
        const availableLines = Math.max(1, totalLines - bootSafeLines);
        const count = Math.min(getSafeCount(requestedCount, availableLines), availableLines);

        // Build a set of unique random line indices within the safe range
        const chosen = new Set();
        while (chosen.size < count) {
            const idx = bootSafeLines + randInt(availableLines);
            chosen.add(idx);
        }

        // Select an implementation for mutating a contiguous byte region (reuse MODE_IMPL where possible)
        const impl = MODE_IMPL[mode] || MODE_IMPL.byteinject;

        // For ROM mutations we will build a temporary Uint8Array view and mutate the selected lines
        try {
            const buf = content; // Emscripten FS returns Uint8Array
            // Mutate each chosen line using the selected impl on the slice view
            chosen.forEach((lineIdx) => {
                const start = lineIdx * lineSize;
                const end = Math.min(buf.length, start + lineSize);
                const slice = buf.subarray(start, end);
                try {
                    // Use impl to mutate the small slice; some impls expect larger buffers but still work.
                    impl(slice, Math.max(1, Math.min(slice.length, Math.floor(lineSize / 2))));
                } catch (e) {
                    // Fallback: simple byte scramble if impl fails
                    for (let i = 0; i < slice.length; i++) {
                        slice[i] = (slice[i] ^ (1 << randInt(8))) & 0xFF;
                    }
                }
            });

            // Write mutated ROM back to FS
            try {
                // overwrite the file
                gm.FS.unlink('/' + candidate);
            } catch (e) {}
            try {
                gm.FS.writeFile('/' + candidate, buf);
            } catch (e) {
                console.warn('Failed to write mutated ROM back to FS:', e);
            }

            // Force a hard restart so the core reloads ROM from disk (this is the intended "hard restart" behavior)
            try {
                if (typeof gm.restart === 'function') {
                    gm.restart();
                } else {
                    // Best-effort fallback: reload page if no restart available
                    setTimeout(() => window.location.reload(), 100);
                }
            } catch (e) {
                console.warn('Failed to restart after ROM corruption:', e);
                setTimeout(() => window.location.reload(), 100);
            }
        } catch (e) {
            console.warn('ROM corruption failed:', e);
        }
    }

    // --- CPU / RAM / AUDIO corruption functions as before ---

    function corruptRam(mode, requestedCount) {
        // Prefer using emulator save/load flow if available (restart semantics), otherwise fall back to live heap mutation.
        const gm = getGameManager();
        if (gm && typeof gm.getState === 'function' && typeof gm.loadState === 'function') {
            // Use same pattern as CPU: snapshot state, mutate, restart, reload
            let state;
            try {
                state = gm.getState();
            } catch (e) {
                console.warn('Failed to read state for RAM-targeted corruption (fallback to live):', e);
            }
            if (state && state.length) {
                const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
                const count = getSafeCount(requestedCount, state.length);
                try {
                    impl(state, count);
                } catch (e) {
                    console.warn('RAM state mutation error:', e);
                }
                try {
                    if (typeof gm.restart === 'function') {
                        gm.restart();
                    }
                } catch (e) {
                    console.warn('Failed to restart core after RAM corruption:', e);
                }
                setTimeout(() => {
                    try {
                        gm.loadState(state);
                    } catch (e) {
                        console.warn('Failed to load corrupted RAM state:', e);
                    }
                }, 50);
                return;
            }
        }

        // Fallback: operate on live HEAPU8 directly
        // Acquire module and ensure we operate on the live, current linear memory buffer.
        const heapAccessor = getHeap();
        if (!heapAccessor) return;

        const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
        const mod = heapAccessor.mod;

        // Try to obtain a live Uint8Array view of the Module memory buffer.
        let liveView = null;
        try {
            if (mod && mod.HEAPU8 && mod.HEAPU8.buffer) {
                // Recreate a fresh view backed by the current buffer so it's safe after Grow operations.
                liveView = new Uint8Array(mod.HEAPU8.buffer);
            } else if (mod && mod.memory && mod.memory.buffer) {
                liveView = new Uint8Array(mod.memory.buffer);
            } else {
                // Last-resort: use provided freshView helper
                liveView = heapAccessor.freshView();
            }
        } catch (e) {
            console.warn('Failed to obtain live HEAP view:', e);
            try {
                liveView = heapAccessor.freshView();
            } catch (ee) {
                console.warn('Failed to create fallback HEAP view:', ee);
                return;
            }
        }

        if (!liveView || !liveView.length) return;

        const count = getSafeCount(requestedCount, liveView.length);

        try {
            // Operate directly on the live view so modifications affect the running emulator immediately.
            impl(liveView, count);

            // If Module.HEAPU8 exists and is a different Uint8Array object (but same buffer), ensure it reflects changes.
            try {
                if (mod && mod.HEAPU8 && mod.HEAPU8.buffer === liveView.buffer && mod.HEAPU8 !== liveView) {
                    // Copy back into Module.HEAPU8 (object identity may differ)
                    mod.HEAPU8.set(liveView);
                }
                // If mod.HEAPU8 is the same object we mutated, nothing else needed.
            } catch (e) {
                // Non-fatal: mutations are already on the underlying buffer; just warn.
                console.warn('Failed to sync mutated buffer to Module.HEAPU8 object:', e);
            }
        } catch (e) {
            console.warn('RAM corruption error:', e);
        }
    }

    /**
     * Corrupt audio-specific regions in the emulated heap.
     *
     * This attempts to bias operations towards likely audio buffers (mid/upper mid areas),
     * and provides dedicated audio modes that are less suitable for generic RAM/CPU mutation.
     */
    function corruptAudio(mode, requestedCount) {
        // Prefer restart-style flow via gameManager state when possible, to mirror CPU behavior.
        const gm = getGameManager();
        if (gm && typeof gm.getState === 'function' && typeof gm.loadState === 'function') {
            let state;
            try {
                state = gm.getState();
            } catch (e) {
                console.warn('Failed to read state for AUDIO-targeted corruption (fallback to live):', e);
            }
            if (state && state.length) {
                // Use audio-specific impls where available; else fallback to bytesoundswap
                const audioModes = {
                    audioglitch: mode_audioglitch,
                    audioinject: mode_audioinject,
                    bytesoundswap: mode_bytesoundswap,
                    texturevomit: mode_texturevomit
                };
                const impl = audioModes[mode] || audioModes.bytesoundswap;
                const count = getSafeCount(requestedCount, state.length);
                try {
                    impl(state, count);
                } catch (e) {
                    console.warn('AUDIO state mutation error:', e);
                }
                try {
                    if (typeof gm.restart === 'function') {
                        gm.restart();
                    }
                } catch (e) {
                    console.warn('Failed to restart core after AUDIO corruption:', e);
                }
                setTimeout(() => {
                    try {
                        gm.loadState(state);
                    } catch (e) {
                        console.warn('Failed to load corrupted AUDIO state:', e);
                    }
                }, 50);
                return;
            }
        }

        // Fallback: operate on live HEAPU8 directly
        const heapAccessor = getHeap();
        if (!heapAccessor) return;

        const mod = heapAccessor.mod;
        let liveView = null;
        try {
            if (mod && mod.HEAPU8 && mod.HEAPU8.buffer) {
                liveView = new Uint8Array(mod.HEAPU8.buffer);
            } else if (mod && mod.memory && mod.memory.buffer) {
                liveView = new Uint8Array(mod.memory.buffer);
            } else {
                liveView = heapAccessor.freshView();
            }
        } catch (e) {
            console.warn('Failed to obtain live HEAP view for audio corruption:', e);
            try {
                liveView = heapAccessor.freshView();
            } catch (ee) {
                console.warn('Failed to create fallback HEAP view for audio:', ee);
                return;
            }
        }

        if (!liveView || !liveView.length) return;

        const count = getSafeCount(requestedCount, liveView.length);

        // For audio target use audio-specific implementations when available, else fallback to bytesoundswap
        const audioModes = {
            audioglitch: mode_audioglitch,
            audioinject: mode_audioinject,
            bytesoundswap: mode_bytesoundswap,
            texturevomit: mode_texturevomit
        };

        const impl = audioModes[mode] || audioModes.bytesoundswap;

        try {
            impl(liveView, count);

            try {
                if (mod && mod.HEAPU8 && mod.HEAPU8.buffer === liveView.buffer && mod.HEAPU8 !== liveView) {
                    mod.HEAPU8.set(liveView);
                }
            } catch (e) {
                console.warn('Failed to sync mutated audio buffer to Module.HEAPU8 object:', e);
            }
        } catch (e) {
            console.warn('Audio corruption error:', e);
        }
    }

    function corruptCpu(mode, requestedCount, options) {
        options = options || {};
        const gm = getGameManager();
        if (!gm || typeof gm.getState !== 'function' || typeof gm.loadState !== 'function') return;

        let state;
        try {
            state = gm.getState();
        } catch (e) {
            console.warn('Failed to read CPU state:', e);
            return;
        }
        if (!state || !state.length) return;

        const impl = MODE_IMPL[mode] || MODE_IMPL.bitflip;
        const count = getSafeCount(requestedCount, state.length);

        try {
            impl(state, count);
        } catch (e) {
            console.warn('CPU state corruption error:', e);
        }

        // If caller requested suppression of automatic restart/load, return mutated state
        if (options.suppressRestart) {
            return state;
        }

        // Otherwise apply corrupted CPU/RAM snapshot: restart core, then load corrupted state.
        try {
            if (typeof gm.restart === 'function') {
                gm.restart();
            }
        } catch (e) {
            console.warn('Failed to restart core after CPU corruption:', e);
        }

        setTimeout(() => {
            try {
                gm.loadState(state);
            } catch (e) {
                console.warn('Failed to load corrupted CPU state:', e);
            }
        }, 50);
    }

    function corrupt(mode, requestedCount, target, options) {
        options = options || {};
        const tgt = (target || 'ram').toLowerCase();
        if (tgt === 'cpu') {
            return corruptCpu(mode, requestedCount, options);
        } else if (tgt === 'audio') {
            // audio target uses distinct modes and operates live
            return corruptAudio(mode, requestedCount, options);
        } else if (tgt === 'rom' || tgt === 'romfile' || tgt === 'rom (on-disk)') {
            // ROM target forces a hard restart and mutates the ROM bytes on-disk inside the FS.
            return corruptRom(mode, requestedCount);
        } else {
            return corruptRam(mode, requestedCount, options);
        }
    }

    // Public API
    window.MemoryCorruptor = {
        corrupt
    };
})();