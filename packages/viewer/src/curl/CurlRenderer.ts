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

/** Shadows fade to zero by this progress value, preventing flash on canvas clear. */
const SHADOW_FADE_END = 0.85;

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
    // Shadow width scales with progress. Opacity fades to zero by SHADOW_FADE_END,
    // so no shadow is visible when the canvas clears at animation completion.
    const shadowWidth = (pageWidth * 3 / 4) * curl.shadow.progress;
    const opacity = Math.max(0, 1 - curl.shadow.progress / SHADOW_FADE_END) * 0.3;
    if (shadowWidth <= 0 || opacity <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pageWidth, pageHeight);
    ctx.clip();

    ctx.translate(curl.shadow.pos.x, curl.shadow.pos.y);
    // scale(-1,1) reverses rotation direction, so negate for mirrorX
    const shadowRotation = Math.PI + curl.shadow.angle + Math.PI / 2;
    ctx.rotate(mirrorX ? -shadowRotation : shadowRotation);

    const gradient = ctx.createLinearGradient(0, 0, shadowWidth, 0);

    if (curl.flippingPosition.x < pageWidth / 2) {
        // Forward direction shadow
        ctx.translate(0, -100);
        gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
        // Backward direction shadow
        ctx.translate(-shadowWidth, -100);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, `rgba(0, 0, 0, ${opacity})`);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, shadowWidth, pageHeight * 2);

    ctx.restore();
};

const drawInnerShadow = (
    ctx: CanvasRenderingContext2D,
    curl: CurlResult,
    pageWidth: number,
    pageHeight: number,
    mirrorX: boolean,
): void => {
    // Shadow width scales with progress. Opacity fades to zero by SHADOW_FADE_END,
    // so no shadow is visible when the canvas clears at animation completion.
    const shadowWidth = (pageWidth * 3 / 4) * curl.shadow.progress;
    const opacity = Math.max(0, 1 - curl.shadow.progress / SHADOW_FADE_END) * 0.3;
    if (shadowWidth <= 0 || opacity <= 0) return;

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

    const gradient = ctx.createLinearGradient(0, 0, isw, 0);

    if (curl.flippingPosition.x < pageWidth / 2) {
        // Forward
        ctx.translate(-isw, -100);
        gradient.addColorStop(1, `rgba(0, 0, 0, ${opacity})`);
        gradient.addColorStop(0.9, 'rgba(0, 0, 0, 0.05)');
        gradient.addColorStop(0.7, `rgba(0, 0, 0, ${opacity})`);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    } else {
        // Backward
        ctx.translate(0, -100);
        gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
        gradient.addColorStop(0.1, 'rgba(0, 0, 0, 0.05)');
        gradient.addColorStop(0.3, `rgba(0, 0, 0, ${opacity})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, isw, pageHeight * 2);

    ctx.restore();
};
