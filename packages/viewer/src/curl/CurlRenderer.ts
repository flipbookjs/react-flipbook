/**
 * Curl overlay rendering — draws the curl effect onto a canvas.
 *
 * MIT attribution: shadow rendering derived from StPageFlip by Nodlik
 * (https://github.com/Nodlik/StPageFlip), MIT License.
 */

import { type CurlResult, type Point } from './CurlCalculation';
import { curlAssert } from './types';

export interface PageBitmap {
    canvas: HTMLCanvasElement;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}

export interface CurlRenderInput {
    ctx: CanvasRenderingContext2D;
    curl: CurlResult;
    flippingPage: PageBitmap | null;
    bottomPage: PageBitmap | null;
    overlayWidth: number;
    overlayHeight: number;
    /** Single page width (not the full spread width) — used for shadow sizing */
    pageWidth: number;
    /** Single page height — used for shadow sizing */
    pageHeight: number;
    direction: 'next' | 'previous';
    pageOriginInOverlay: { x: number; y: number };
    /** Mirror curl geometry on x-axis for 'previous' direction in dual mode */
    mirrorX: boolean;
    /** Spine shadow width in CSS pixels. 0 = no spine (e.g. SinglePage mode). */
    spineWidth: number;
}

export const renderCurlFrame = (input: CurlRenderInput): void => {
    const { ctx, curl, flippingPage, bottomPage, overlayWidth, overlayHeight, pageWidth, pageHeight, pageOriginInOverlay, mirrorX, spineWidth } = input;

    curlAssert(
        overlayWidth > 0 && overlayHeight > 0,
        'renderCurlFrame',
        'overlay has zero dimensions',
        { overlayWidth, overlayHeight },
    );
    curlAssert(
        pageWidth > 0 && pageHeight > 0,
        'renderCurlFrame',
        'page has zero dimensions',
        { pageWidth, pageHeight },
    );
    curlAssert(
        pageWidth <= overlayWidth,
        'renderCurlFrame',
        'pageWidth exceeds overlayWidth — wrong value passed?',
        { pageWidth, overlayWidth },
    );

    if (flippingPage) {
        curlAssert(
            flippingPage.canvas.width > 0 && flippingPage.canvas.height > 0,
            'renderCurlFrame',
            'flippingPage canvas has zero dimensions',
            { canvasW: flippingPage.canvas.width, canvasH: flippingPage.canvas.height },
        );
    }
    if (bottomPage) {
        curlAssert(
            bottomPage.canvas.width > 0 && bottomPage.canvas.height > 0,
            'renderCurlFrame',
            'bottomPage canvas has zero dimensions',
            { canvasW: bottomPage.canvas.width, canvasH: bottomPage.canvas.height },
        );
    }

    const ox = pageOriginInOverlay.x;
    const oy = pageOriginInOverlay.y;

    // For 'previous' in dual mode, curl geometry x-axis must be mirrored:
    // curl x=0 (spine) → overlay x = ox, curl x=pageWidth (outer) → overlay x = ox - pageWidth
    // Transform: overlayX = ox - curlX  (mirror + offset)
    // For 'next': overlayX = curlX + ox  (offset only)
    const toOverlay = mirrorX
        ? (p: Point): Point => ({ x: ox - p.x, y: p.y + oy })
        : (p: Point): Point => ({ x: p.x + ox, y: p.y + oy });

    const bottomClip = curl.bottomClipArea.map(toOverlay);
    const flippingClip = curl.flippingClipArea.map(toOverlay);
    const flippingPos = toOverlay(curl.flippingPosition);

    ctx.clearRect(0, 0, overlayWidth, overlayHeight);

    // At low progress (e.g. drag start with pointer y-offset), the curl math
    // produces a near-180° angle with a wide clip triangle containing upside-down
    // page content ("peaks" artifact). Fade page content in based on progress so
    // the distorted early frames are invisible and content appears smoothly as
    // the geometry improves.
    const PAGE_FADE_END = 0.05;
    const pageOpacity = Math.min(curl.progress / PAGE_FADE_END, 1);
    const showShadows = curl.progress > 0.02;

    // 1. Bottom page (revealed behind the curl)
    if (bottomPage && pageOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = pageOpacity;
        clipToPolygon(ctx, bottomClip);
        ctx.drawImage(
            bottomPage.canvas,
            bottomPage.offsetX, bottomPage.offsetY,
            bottomPage.width, bottomPage.height,
        );
        ctx.restore();
    }

    // 1b. Near completion (progress >= 0.75), fill currentClipArea with
    // bottom page content so the canvas has no transparent pixels in the
    // page region. Prevents old DOM from bleeding through after committed curl.
    // 0.75 chosen because portrait pages cap at ~0.78 progress due to
    // limitPointToCircle constraints — SHADOW_FADE_END (0.85) is too high.
    if (bottomPage && curl.progress >= 0.75) {
        const currentClip = curl.currentClipArea.map(toOverlay);
        ctx.save();
        clipToPolygon(ctx, currentClip);
        ctx.drawImage(
            bottomPage.canvas,
            bottomPage.offsetX, bottomPage.offsetY,
            bottomPage.width, bottomPage.height,
        );
        ctx.restore();
    }

    // 2. Spine shadow — drawn BEFORE the flipping page so the curl renders on top
    if (spineWidth > 0) {
        ctx.save();
        if (mirrorX) {
            ctx.translate(ox, oy);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(ox, oy);
        }
        drawSpineShadow(ctx, spineWidth, pageHeight);
        ctx.restore();
    }

    // 3. Outer shadow — cast by the curling page onto the flat page below
    if (showShadows) {
        ctx.save();
        if (mirrorX) {
            ctx.translate(ox, oy);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(ox, oy);
        }
        drawOuterShadow(ctx, curl, pageWidth, pageHeight, mirrorX);
        ctx.restore();
    }

    // 4. Flipping page (rotated + clipped)
    if (flippingPage && pageOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = pageOpacity;
        clipToPolygon(ctx, flippingClip);
        ctx.translate(flippingPos.x, flippingPos.y);
        ctx.rotate(curl.angle);
        // Image extends from pivot in rotated space. For 'next' (no mirror),
        // the fold is to the right of the pivot: draw at (0, -h).
        // For 'previous' (mirror), the fold is to the left: draw at (-w, -h).
        const dx = mirrorX ? -flippingPage.width : 0;
        ctx.drawImage(
            flippingPage.canvas,
            dx, -flippingPage.height,
            flippingPage.width, flippingPage.height,
        );
        ctx.restore();
    }

    // 5. Inner shadow — on the fold crease of the curling page
    if (showShadows) {
        ctx.save();
        if (mirrorX) {
            ctx.translate(ox, oy);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(ox, oy);
        }
        drawInnerShadow(ctx, curl, pageWidth, pageHeight, mirrorX);
        ctx.restore();
    }

    // 6. Corner edge line — thin stroke around the curled-paper polygon. Provides
    // visual definition on solid-color pages (e.g. mostly-white) where the shadows
    // alone don't distinguish the curl from the page underneath. Drawn LAST so
    // it sits on top of everything else.
    if (showShadows && flippingClip.length > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(flippingClip[0].x, flippingClip[0].y);
        for (let i = 1; i < flippingClip.length; i++) {
            ctx.lineTo(flippingClip[i].x, flippingClip[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

};

const clipToPolygon = (ctx: CanvasRenderingContext2D, points: Point[]): void => {
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.clip();
};

// ---- Shadow rendering (ported from CanvasRender.ts) ----

/**
 * Inner + outer shadow opacity ramps up from 0 to full across this initial slice
 * of `curl.shadow.progress`, giving the curl an elegant soft entry instead of
 * appearing at full strength the moment the corner starts lifting. Real paper
 * just starting to fold casts almost no shadow — this curve matches that.
 */
const SHADOW_RAMP_IN_END = 0.2;

/** Shadows fade to zero by this progress value, preventing flash on canvas clear. */
const SHADOW_FADE_END = 0.85;

/**
 * Triangular opacity envelope: 0 → 1 over [0, SHADOW_RAMP_IN_END], stays at 1,
 * then 1 → 0 over [SHADOW_RAMP_IN_END, SHADOW_FADE_END]. Returns 0 outside [0, 1].
 */
const shadowProgressEnvelope = (progress: number): number => {
    const rampIn = Math.min(1, Math.max(0, progress / SHADOW_RAMP_IN_END));
    const fadeOut = Math.max(0, 1 - progress / SHADOW_FADE_END);
    return rampIn * fadeOut;
};

/**
 * As the curl corner crosses the page's vertical midpoint, the cast/inner shadow
 * direction flips. A hard switch at exactly midpoint looks jarring, so this helper
 * returns blend factors for the two directions over a transition zone around the
 * midpoint. Outside the zone only one direction is visible; inside, both are drawn
 * with complementary opacities (sum = 1) so the visual ink is roughly conserved.
 *
 * Position-driven (uses flippingPosition.x), not time-driven — the fade follows the
 * actual curl progress regardless of animation speed.
 *
 * Returns: { forward, backward } each in [0, 1]; forward + backward = 1 inside the
 * zone, with one being 0 outside it.
 */
const TRANSITION_ZONE_HALF_WIDTH = 0.1;  // ±10% of pageWidth around midpoint = 20% total span
const shadowDirectionBlend = (
    flippingX: number,
    pageWidth: number,
): { forward: number; backward: number } => {
    const midpoint = pageWidth / 2;
    const halfSpan = pageWidth * TRANSITION_ZONE_HALF_WIDTH;
    const transitionStart = midpoint - halfSpan;
    const transitionEnd = midpoint + halfSpan;
    if (flippingX <= transitionStart) return { forward: 1, backward: 0 };
    if (flippingX >= transitionEnd) return { forward: 0, backward: 1 };
    // Linear interpolation: at transitionStart → forward=1, at transitionEnd → forward=0
    const forward = (transitionEnd - flippingX) / (transitionEnd - transitionStart);
    return { forward, backward: 1 - forward };
};

export const drawSpineShadow = (
    ctx: CanvasRenderingContext2D,
    spineWidth: number,
    pageHeight: number,
): void => {
    ctx.save();

    // x=0 is the spine (context already translated to pageOrigin).
    // Center the gradient on the spine. No clip — our canvas spans
    // the full spread and the gradient fades to transparent at both edges.
    ctx.translate(-spineWidth / 2, 0);

    // Spine gradient — also used by CurlOverlay idle effect for the resting spine.
    const gradient = ctx.createLinearGradient(0, 0, spineWidth, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.01)');
    gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.03)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.06)');
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.03)');
    gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.01)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, spineWidth, pageHeight);

    ctx.restore();
};

const drawOuterShadow = (
    ctx: CanvasRenderingContext2D,
    curl: CurlResult,
    pageWidth: number,
    pageHeight: number,
    mirrorX: boolean,
): void => {
    // Shadow width scales with progress. Opacity follows the envelope: ramps from
    // 0 at curl start (soft entry — real paper barely lifted casts no shadow),
    // reaches full strength after SHADOW_RAMP_IN_END, then fades to 0 by
    // SHADOW_FADE_END (so the canvas clears with no shadow flash).
    const shadowWidth = (pageWidth * 3 / 4) * curl.shadow.progress;
    const baseOpacity = shadowProgressEnvelope(curl.shadow.progress) * 0.3;
    if (shadowWidth <= 0 || baseOpacity <= 0) return;

    // Blend the two direction shadows across the midpoint transition zone — avoids
    // a hard switch when the curl corner crosses the page's vertical midline.
    const { forward, backward } = shadowDirectionBlend(curl.flippingPosition.x, pageWidth);
    const forwardOpacity = baseOpacity * forward;
    const backwardOpacity = baseOpacity * backward;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pageWidth, pageHeight);
    ctx.clip();

    ctx.translate(curl.shadow.pos.x, curl.shadow.pos.y);
    // scale(-1,1) reverses rotation direction, so negate for mirrorX
    const shadowRotation = Math.PI + curl.shadow.angle + Math.PI / 2;
    ctx.rotate(mirrorX ? -shadowRotation : shadowRotation);

    // Forward direction (dark → transparent, drawn at origin). Dominant past midpoint.
    if (forwardOpacity > 0) {
        ctx.save();
        ctx.translate(0, -100);
        const fg = ctx.createLinearGradient(0, 0, shadowWidth, 0);
        fg.addColorStop(0, `rgba(0, 0, 0, ${forwardOpacity})`);
        fg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, shadowWidth, pageHeight * 2);
        ctx.restore();
    }

    // Backward direction (transparent → dark, drawn at -shadowWidth). Dominant pre-midpoint.
    if (backwardOpacity > 0) {
        ctx.save();
        ctx.translate(-shadowWidth, -100);
        const bg = ctx.createLinearGradient(0, 0, shadowWidth, 0);
        bg.addColorStop(0, 'rgba(0, 0, 0, 0)');
        bg.addColorStop(1, `rgba(0, 0, 0, ${backwardOpacity})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, shadowWidth, pageHeight * 2);
        ctx.restore();
    }

    ctx.restore();
};

const drawInnerShadow = (
    ctx: CanvasRenderingContext2D,
    curl: CurlResult,
    pageWidth: number,
    pageHeight: number,
    mirrorX: boolean,
): void => {
    // Same envelope as drawOuterShadow — both shadows ramp up together at curl start.
    const shadowWidth = (pageWidth * 3 / 4) * curl.shadow.progress;
    const baseOpacity = shadowProgressEnvelope(curl.shadow.progress) * 0.3;
    if (shadowWidth <= 0 || baseOpacity <= 0) return;

    // Blend the two direction shadows across the midpoint transition zone (same
    // helper as drawOuterShadow so both shadows fade together as the curl crosses).
    const { forward, backward } = shadowDirectionBlend(curl.flippingPosition.x, pageWidth);
    const forwardOpacity = baseOpacity * forward;
    const backwardOpacity = baseOpacity * backward;

    const isw = (shadowWidth * 3) / 4;

    ctx.save();
    ctx.beginPath();

    // Clip to the flipping page area
    const flippingClip = curl.flippingClipArea;
    if (flippingClip.length > 0) {
        ctx.moveTo(flippingClip[0].x, flippingClip[0].y);
        for (let i = 1; i < flippingClip.length; i++) {
            ctx.lineTo(flippingClip[i].x, flippingClip[i].y);
        }
    }
    ctx.clip();

    ctx.translate(curl.shadow.pos.x, curl.shadow.pos.y);
    // scale(-1,1) reverses rotation direction, so negate for mirrorX
    const shadowRotation = Math.PI + curl.shadow.angle + Math.PI / 2;
    ctx.rotate(mirrorX ? -shadowRotation : shadowRotation);

    // The inner shadow uses a 4-stop gradient (dark-light-dark-transparent) to create
    // a "two-band" crease stripe. The 0.05 light-gap stop is also scaled by the fade
    // factor so when a direction is fully faded out, none of its stops bleed through.

    // Forward direction (drawn at -isw). Dominant past midpoint.
    if (forwardOpacity > 0) {
        ctx.save();
        ctx.translate(-isw, -100);
        const fg = ctx.createLinearGradient(0, 0, isw, 0);
        fg.addColorStop(1, `rgba(0, 0, 0, ${forwardOpacity})`);
        fg.addColorStop(0.9, `rgba(0, 0, 0, ${0.05 * forward})`);
        fg.addColorStop(0.7, `rgba(0, 0, 0, ${forwardOpacity})`);
        fg.addColorStop(0, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, isw, pageHeight * 2);
        ctx.restore();
    }

    // Backward direction (drawn at origin). Dominant pre-midpoint.
    if (backwardOpacity > 0) {
        ctx.save();
        ctx.translate(0, -100);
        const bg = ctx.createLinearGradient(0, 0, isw, 0);
        bg.addColorStop(0, `rgba(0, 0, 0, ${backwardOpacity})`);
        bg.addColorStop(0.1, `rgba(0, 0, 0, ${0.05 * backward})`);
        bg.addColorStop(0.3, `rgba(0, 0, 0, ${backwardOpacity})`);
        bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, isw, pageHeight * 2);
        ctx.restore();
    }

    ctx.restore();
};
