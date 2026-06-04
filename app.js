/* ═══════════════════════════════════════════════════
   SOLARARC — Full-Scroll Cinematic Engine
   Scroll position drives BOTH animation AND content.
   Every scroll reveals new information.
   ═══════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── CONFIG ──
    const TOTAL_FRAMES = 192;
    const FRAME_PATH = 'frames_hq/frame-';
    const FRAME_EXT = '.jpg';
    // Coarse-pointer = touch/mobile device
    const MOBILE = window.matchMedia('(pointer: coarse)').matches;
    // Keyframe stride: load every Nth frame first so any scroll position
    // has a nearby frame available very quickly, then fill gaps.
    const PRELOAD_STRIDE = 24;

    // ── STATE ──
    const images = new Array(TOTAL_FRAMES);
    let canvas, ctx;
    let cW, cH; // canvas logical size
    let lastDrawnIndex = -1;
    let currentProgress = 0;
    let lastRafProgress = -1; // dirty-flag: skip DOM work when scroll hasn't moved
    let rafId = null;
    let counterAnimated = false;
    let mouseX = 0, mouseY = 0;

    // Cached DOM references — populated in init() before first RAF tick
    let scrollContainer, slideEls, canvasDim, progressFill, mainNav;

    // ── HELPERS ──
    function pad(n) {
        return String(n).padStart(3, '0');
    }

    function frameSrc(i) {
        return FRAME_PATH + pad(i + 1) + FRAME_EXT;
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    // ── CANVAS ──
    function initCanvas() {
        canvas = document.getElementById('hero-canvas');
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        sizeCanvas();
        window.addEventListener('resize', sizeCanvas);
    }

    function sizeCanvas() {
        // Cap DPR at 2 on mobile — 3× canvas on a 192-frame sequence is unnecessary memory pressure
        const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
        cW = window.innerWidth;
        cH = window.innerHeight;
        canvas.width = cW * dpr;
        canvas.height = cH * dpr;
        canvas.style.width = cW + 'px';
        canvas.style.height = cH + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Force redraw after resize
        lastDrawnIndex = -1;
        const idx = clamp(Math.round(currentProgress * (TOTAL_FRAMES - 1)), 0, TOTAL_FRAMES - 1);
        if (images[idx]) coverFitDraw(images[idx], idx);
    }

    // ── DRAW HELPERS ──
    // Extracted so nearest-frame fallback and normal draw share the same cover-fit logic
    function coverFitDraw(img, index) {
        const iR = img.naturalWidth / img.naturalHeight;
        const cR = cW / cH;
        let dw, dh, dx, dy;
        if (cR > iR) {
            dw = cW;
            dh = cW / iR;
            dx = 0;
            dy = (cH - dh) / 2;
        } else {
            dh = cH;
            dw = cH * iR;
            dx = (cW - dw) / 2;
            dy = 0;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
        lastDrawnIndex = index;
    }

    function drawImage(index) {
        const img = images[index];
        if (img) {
            if (index === lastDrawnIndex) return;
            coverFitDraw(img, index);
            return;
        }

        // Nearest-frame fallback: on fast scroll the target frame may not be
        // decoded yet. Rather than leaving the canvas blank, find the closest
        // loaded frame (searching both directions simultaneously) and show it.
        for (let d = 1; d < TOTAL_FRAMES; d++) {
            const before = index - d;
            const after  = index + d;
            if (before >= 0 && images[before]) {
                if (before === lastDrawnIndex) return;
                coverFitDraw(images[before], before);
                return;
            }
            if (after < TOTAL_FRAMES && images[after]) {
                if (after === lastDrawnIndex) return;
                coverFitDraw(images[after], after);
                return;
            }
        }
        // No frames loaded yet — canvas stays blank until first frame arrives
    }

    // ── FRAME LOADER ──
    function preloadAllFrames() {
        return new Promise(function (resolve) {
            let loaded = 0;
            let nextToQueue = 0;
            // Fewer concurrent requests on mobile to avoid saturating the connection
            const concurrency = MOBILE ? 4 : 8;

            // Build priority queue: keyframes every PRELOAD_STRIDE first, then fill gaps.
            // This ensures every ~PRELOAD_STRIDE frames there's a loaded frame to fall
            // back to, so the nearest-frame fallback never skips far even early in load.
            const keyframeSet = new Set();
            for (let i = 0; i < TOTAL_FRAMES; i += PRELOAD_STRIDE) keyframeSet.add(i);
            keyframeSet.add(TOTAL_FRAMES - 1); // always load the last frame early

            const queue = [];
            keyframeSet.forEach(function (i) { queue.push(i); });
            for (let i = 0; i < TOTAL_FRAMES; i++) {
                if (!keyframeSet.has(i)) queue.push(i);
            }

            function storeAndContinue(i, img) {
                images[i] = img;
                loaded++;
                if (i === 0 && lastDrawnIndex === -1) drawImage(0);
                if (loaded === TOTAL_FRAMES) {
                    resolve();
                } else {
                    loadNext();
                }
            }

            function loadNext() {
                if (nextToQueue >= TOTAL_FRAMES) return;
                const i = queue[nextToQueue++];
                const img = new Image();
                img.decoding = 'async';
                img.onload = function () {
                    // img.decode() ensures the image is fully decoded and GPU-ready
                    // before we store it. Prevents brief main-thread jank on first draw.
                    img.decode().then(
                        function () { storeAndContinue(i, img); },
                        function () { storeAndContinue(i, img); } // decode failed — use anyway
                    );
                };
                img.onerror = function () {
                    loaded++;
                    if (loaded === TOTAL_FRAMES) resolve();
                    else loadNext();
                };
                img.src = frameSrc(i);
            }

            for (let c = 0; c < concurrency; c++) loadNext();
        });
    }

    // ── SCROLL PROGRESS ──
    function getScrollProgress() {
        const rect = scrollContainer.getBoundingClientRect();
        const scrollable = scrollContainer.offsetHeight - window.innerHeight;
        if (scrollable <= 0) return 0;
        return clamp(-rect.top / scrollable, 0, 1);
    }

    // ── SLIDE VISIBILITY ──
    function updateSlides(progress) {
        let maxDim = 0;
        const isLandingPhase = progress < 0.13;

        slideEls.forEach(function (slide) {
            const enter = parseFloat(slide.dataset.enter);
            const peak  = parseFloat(slide.dataset.peak);
            const exit  = parseFloat(slide.dataset.exit);
            const isLanding = slide.classList.contains('slide-landing');

            let opacity = 0;

            if (progress >= enter && progress <= exit) {
                if (progress < peak) {
                    opacity = clamp((progress - enter) / (peak - enter), 0, 1);
                } else {
                    opacity = clamp(1 - (progress - peak) / (exit - peak), 0, 1);
                }
            }

            // Landing slide: always starts fully visible
            if (isLanding && progress <= 0) {
                opacity = 1;
            }

            const easedOpacity = opacity > 0 ? easeOutQuart(opacity) : 0;

            if (easedOpacity > 0.01) {
                slide.style.opacity = easedOpacity;
                slide.style.visibility = 'visible';
                slide.style.pointerEvents = easedOpacity > 0.5 ? 'auto' : 'none';

                // Subtle vertical parallax (not on landing slide — that uses mouse parallax)
                if (!isLanding) {
                    const translateY = (1 - opacity) * 30;
                    slide.style.transform = 'translateY(' + (progress < peak ? translateY : -translateY * 0.5) + 'px)';
                }
            } else {
                slide.style.opacity = 0;
                slide.style.visibility = 'hidden';
                slide.style.pointerEvents = 'none';
                if (!isLanding) {
                    slide.style.transform = 'translateY(40px)';
                }
            }

            // Track max dimming — use lighter dim for landing
            if (!isLanding && easedOpacity > maxDim) maxDim = easedOpacity;
        });

        // Dim the canvas for readability
        if (isLandingPhase) {
            canvasDim.style.background = 'rgba(0, 0, 0, 0.3)';
        } else {
            canvasDim.style.background = 'rgba(0, 0, 0, ' + (maxDim * 0.55) + ')';
        }
    }

    // ── COUNTER ANIMATION ──
    function animateCounters() {
        if (counterAnimated) return;
        counterAnimated = true;

        document.querySelectorAll('.impact-number[data-target]').forEach(function (el) {
            const target = parseFloat(el.dataset.target);
            const decimal = parseInt(el.dataset.decimal) || 0;
            const duration = 2200;
            const start = performance.now();

            function tick(now) {
                const t = clamp((now - start) / duration, 0, 1);
                const eased = easeOutQuart(t);
                const val = eased * target;
                el.textContent = decimal > 0 ? val.toFixed(decimal) : Math.round(val);
                if (t < 1) requestAnimationFrame(tick);
            }

            requestAnimationFrame(tick);
        });
    }

    // ── PROGRESS BAR ──
    function updateProgressBar(progress) {
        progressFill.style.width = (progress * 100) + '%';
    }

    // ── NAV STATE ──
    function updateNav(progress) {
        if (progress > 0.02) {
            mainNav.classList.add('scrolled');
        } else {
            mainNav.classList.remove('scrolled');
        }
    }

    // ── MAIN RENDER LOOP ──
    function onFrame() {
        const progress = getScrollProgress();
        currentProgress = progress;

        // Always update the canvas frame (drawImage has its own early-exit when unchanged)
        const frameIndex = clamp(Math.round(progress * (TOTAL_FRAMES - 1)), 0, TOTAL_FRAMES - 1);
        drawImage(frameIndex);

        // Only touch the DOM when scroll position has actually moved.
        // Saves querySelectorAll iteration + style mutations on every tick while idle.
        if (Math.abs(progress - lastRafProgress) > 0.00005) {
            updateSlides(progress);
            updateProgressBar(progress);
            updateNav(progress);
            if (progress >= 0.77 && progress <= 0.90) animateCounters();
            lastRafProgress = progress;
        }

        rafId = requestAnimationFrame(onFrame);
    }

    // ── NAV CLICK → SCROLL TO PROGRESS ──
    function setupNavClicks() {
        document.querySelectorAll('[data-scroll-to]').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();

                // Close mobile nav if open
                const navLinks = document.getElementById('nav-links');
                const toggle = document.getElementById('nav-toggle');
                if (navLinks.classList.contains('open')) {
                    navLinks.classList.remove('open');
                    toggle.classList.remove('active');
                    document.body.style.overflow = '';
                }

                const targetProgress = parseFloat(link.dataset.scrollTo);
                const scrollable = scrollContainer.offsetHeight - window.innerHeight;
                const targetScroll = targetProgress * scrollable;

                window.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth'
                });
            });
        });
    }

    // ── MOBILE NAV ──
    function setupMobileNav() {
        const toggle = document.getElementById('nav-toggle');
        const links = document.getElementById('nav-links');
        if (!toggle || !links) return;

        toggle.addEventListener('click', function () {
            toggle.classList.toggle('active');
            links.classList.toggle('open');
            document.body.style.overflow = links.classList.contains('open') ? 'hidden' : '';
        });
    }

    // ── MOUSE PARALLAX ──
    function setupMouseParallax() {
        // Touch-primary devices never fire mousemove — skip the forever RAF
        if (MOBILE) return;

        const parallaxTarget = document.getElementById('landing-parallax');
        if (!parallaxTarget) return;

        window.addEventListener('mousemove', function (e) {
            mouseX = (e.clientX / window.innerWidth - 0.5) * 2;  // -1 to 1
            mouseY = (e.clientY / window.innerHeight - 0.5) * 2; // -1 to 1
        }, { passive: true });

        function updateParallax() {
            if (currentProgress < 0.13) {
                const tx = mouseX * -8;
                const ty = mouseY * -5;
                parallaxTarget.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
            } else {
                parallaxTarget.style.transform = 'translate(0, 0)';
            }
            requestAnimationFrame(updateParallax);
        }
        requestAnimationFrame(updateParallax);
    }

    // ── ASSESSMENT MODAL ──
    var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby7HgfADyUei0ts-wLGI34zDDRkpofGXtXCuWwuwB_wujIePMbqsYqfp1sbVR4SNIFE/exec';

    function setupAssessmentModal() {
        var overlay = document.getElementById('assessment-modal');
        if (!overlay) return;
        var form = document.getElementById('assessment-form');
        var closeBtn = document.getElementById('modal-close');
        var submitBtn = document.getElementById('form-submit-btn');
        var statusEl = document.getElementById('form-status');
        var billInput = document.getElementById('f-bill');
        var billText = document.getElementById('f-bill-text');

        // Show filename when bill is selected
        if (billInput) {
            billInput.addEventListener('change', function () {
                billText.textContent = billInput.files.length
                    ? billInput.files[0].name
                    : 'Upload bill image or PDF';
            });
        }

        function openModal() {
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
            if (statusEl) { statusEl.textContent = ''; statusEl.className = 'form-status'; }
        }

        function closeModal() {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        }

        document.querySelectorAll('[data-open-modal="assessment"]').forEach(function (el) {
            el.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
        });

        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var payload = {
                name:        form.querySelector('[name=name]').value.trim(),
                designation: form.querySelector('[name=designation]').value.trim(),
                phone:       form.querySelector('[name=phone]').value.trim(),
                email:       form.querySelector('[name=email]').value.trim(),
                company:     form.querySelector('[name=company]').value.trim(),
                site:        form.querySelector('[name=site]').value.trim(),
                industry:    form.querySelector('[name=industry]').value,
                interest:    form.querySelector('[name=interest]').value.trim()
            };

            var file = billInput && billInput.files[0];

            function sendPayload(billData) {
                if (billData) payload.bill = billData;

                // If Apps Script not yet configured fall back to mailto
                if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'APPS_SCRIPT_URL_HERE') {
                    var subject = encodeURIComponent('Site Assessment Request — ' + (payload.company || payload.name));
                    var body = encodeURIComponent(
                        'Name: ' + payload.name + '\nDesignation: ' + payload.designation +
                        '\nPhone: ' + payload.phone + '\nEmail: ' + payload.email +
                        '\nCompany: ' + payload.company + '\nSite: ' + payload.site +
                        '\nIndustry: ' + payload.industry +
                        (payload.interest ? '\n\nInterest:\n' + payload.interest : '')
                    );
                    window.open('mailto:sales@urbangrids.in?subject=' + subject + '&body=' + body);
                    closeModal();
                    form.reset();
                    if (billText) billText.textContent = 'Upload bill image or PDF';
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Sending…';
                statusEl.textContent = '';

                // text/plain avoids CORS preflight — Apps Script handles OPTIONS poorly
                fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                })
                .then(function (res) { return res.text(); })
                .then(function (text) {
                    try { return JSON.parse(text); } catch(e) { return { status: 'success' }; }
                })
                .then(function (data) {
                    if (data.status === 'success') {
                        statusEl.textContent = 'Request sent! We\'ll be in touch within 2 business days.';
                        statusEl.className = 'form-status form-status-ok';
                        form.reset();
                        if (billText) billText.textContent = 'Upload bill image or PDF';
                        setTimeout(closeModal, 2800);
                    } else {
                        throw new Error(data.error || 'Unknown error');
                    }
                })
                .catch(function () {
                    statusEl.textContent = 'Something went wrong. Please WhatsApp us or email sales@urbangrids.in.';
                    statusEl.className = 'form-status form-status-err';
                })
                .finally(function () {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send Assessment Request';
                });
            }

            // Read bill file as base64 if provided
            if (file) {
                var reader = new FileReader();
                reader.onload = function (ev) {
                    var base64 = ev.target.result.split(',')[1];
                    sendPayload({ name: file.name, mimeType: file.type, data: base64 });
                };
                reader.readAsDataURL(file);
            } else {
                sendPayload(null);
            }
        });
    }

    // ── INIT ──
    function init() {
        // Cache DOM references before the first RAF tick fires —
        // avoids repeated getElementById/querySelectorAll at 60fps
        scrollContainer = document.getElementById('scroll-container');
        slideEls = Array.from(document.querySelectorAll('.slide'));
        canvasDim = document.getElementById('canvas-dim');
        progressFill = document.getElementById('progress-fill');
        mainNav = document.getElementById('main-nav');

        initCanvas();
        preloadAllFrames();
        setupNavClicks();
        setupMobileNav();
        setupMouseParallax();
        setupAssessmentModal();

        // Make landing slide visible immediately
        const landing = document.getElementById('slide-landing');
        if (landing) {
            landing.style.opacity = 1;
            landing.style.visibility = 'visible';
            landing.style.pointerEvents = 'auto';
        }

        // Start render loop
        rafId = requestAnimationFrame(onFrame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
