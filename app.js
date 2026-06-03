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

    // ── STATE ──
    const images = new Array(TOTAL_FRAMES);
    let canvas, ctx;
    let cW, cH; // canvas logical size
    let lastDrawnIndex = -1;
    let currentProgress = 0;
    let rafId = null;
    let counterAnimated = false;
    let mouseX = 0, mouseY = 0;

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
        // Use full device pixel ratio for maximum sharpness
        const dpr = window.devicePixelRatio || 1;
        cW = window.innerWidth;
        cH = window.innerHeight;
        canvas.width = cW * dpr;
        canvas.height = cH * dpr;
        canvas.style.width = cW + 'px';
        canvas.style.height = cH + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Force redraw
        lastDrawnIndex = -1;
        const idx = Math.round(currentProgress * (TOTAL_FRAMES - 1));
        if (images[idx]) drawImage(idx);
    }

    // ── FRAME LOADER ──
    // Priority: load ALL frames as fast as possible, 6 concurrent
    function preloadAllFrames() {
        return new Promise((resolve) => {
            let loaded = 0;
            let nextToQueue = 0;
            const concurrency = 8;

            function loadNext() {
                if (nextToQueue >= TOTAL_FRAMES) return;
                const i = nextToQueue++;
                const img = new Image();
                img.decoding = 'async';
                img.onload = function () {
                    images[i] = img;
                    loaded++;
                    // Draw first frame immediately
                    if (i === 0 && lastDrawnIndex === -1) {
                        drawImage(0);
                    }
                    if (loaded === TOTAL_FRAMES) {
                        resolve();
                    } else {
                        loadNext();
                    }
                };
                img.onerror = function () {
                    loaded++;
                    if (loaded === TOTAL_FRAMES) resolve();
                    else loadNext();
                };
                img.src = frameSrc(i);
            }

            // Kickoff concurrent loaders
            for (let c = 0; c < concurrency; c++) {
                loadNext();
            }
        });
    }

    // ── DRAW ──
    function drawImage(index) {
        if (index === lastDrawnIndex) return;
        const img = images[index];
        if (!img) return;

        // Cover-fit (like CSS object-fit: cover)
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

    // ── SCROLL PROGRESS ──
    function getScrollProgress() {
        const container = document.getElementById('scroll-container');
        const rect = container.getBoundingClientRect();
        const scrollable = container.offsetHeight - window.innerHeight;
        if (scrollable <= 0) return 0;
        return clamp(-rect.top / scrollable, 0, 1);
    }

    // ── SLIDE VISIBILITY ──
    function updateSlides(progress) {
        const slides = document.querySelectorAll('.slide');
        let maxDim = 0;
        const isLandingPhase = progress < 0.13;

        slides.forEach((slide) => {
            const enter = parseFloat(slide.dataset.enter);
            const peak = parseFloat(slide.dataset.peak);
            const exit = parseFloat(slide.dataset.exit);
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
        const dim = document.getElementById('canvas-dim');
        if (isLandingPhase) {
            // Light dim on landing for text readability
            dim.style.background = 'rgba(0, 0, 0, 0.3)';
        } else {
            dim.style.background = 'rgba(0, 0, 0, ' + (maxDim * 0.55) + ')';
        }
    }

    // ── COUNTER ANIMATION ──
    function animateCounters() {
        if (counterAnimated) return;
        counterAnimated = true;

        document.querySelectorAll('.impact-number[data-target]').forEach((el) => {
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
        const fill = document.getElementById('progress-fill');
        fill.style.width = (progress * 100) + '%';
    }

    // ── NAV STATE ──
    function updateNav(progress) {
        const nav = document.getElementById('main-nav');
        if (progress > 0.02) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    }

    // ── MAIN RENDER LOOP ──
    function onFrame() {
        const progress = getScrollProgress();
        currentProgress = progress;

        // Map progress to frame index
        const frameIndex = Math.round(progress * (TOTAL_FRAMES - 1));
        drawImage(clamp(frameIndex, 0, TOTAL_FRAMES - 1));

        // Update content slides
        updateSlides(progress);

        // Progress bar
        updateProgressBar(progress);

        // Nav
        updateNav(progress);

        // Trigger counter animation when impact slide is visible
        if (progress >= 0.75 && progress <= 0.88) {
            animateCounters();
        }

        rafId = requestAnimationFrame(onFrame);
    }

    // ── NAV CLICK → SCROLL TO PROGRESS ──
    function setupNavClicks() {
        document.querySelectorAll('[data-scroll-to]').forEach((link) => {
            link.addEventListener('click', (e) => {
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
                const container = document.getElementById('scroll-container');
                const scrollable = container.offsetHeight - window.innerHeight;
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

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            links.classList.toggle('open');
            document.body.style.overflow = links.classList.contains('open') ? 'hidden' : '';
        });
    }

    // ── MOUSE PARALLAX ──
    function setupMouseParallax() {
        const parallaxTarget = document.getElementById('landing-parallax');
        if (!parallaxTarget) return;

        window.addEventListener('mousemove', (e) => {
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

    // ── INIT ──
    function init() {
        initCanvas();
        preloadAllFrames();
        setupNavClicks();
        setupMobileNav();
        setupMouseParallax();

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
